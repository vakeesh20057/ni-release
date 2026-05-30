/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ITM/SWO Tracing Service
 *
 * Enables Instrumentation Trace Macrocell (ITM) output over SWD Serial Wire Output (SWO).
 * ITM is a Cortex-M feature (M3/M4/M7/M33/M55) that allows printf-style logging
 * without using a UART peripheral — data flows over the SWD debug connector.
 *
 * Trace types:
 *   - Stimulus port 0: printf-style text (ITM_SendChar)
 *   - Stimulus ports 1-31: custom data streams
 *   - DWT cycle counter: CPU cycle count for profiling
 *   - Exception trace: interrupt entry/exit with IRQ number
 *   - PC sampling: statistical profiling of hot-path functions
 *
 * Backend: OpenOCD (monitor tpiu config) or J-Link (monitor SWO StartCapture)
 */

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export type ITMFrameType = 'stimulus' | 'exception' | 'pc-sample' | 'dwt-counter' | 'overflow';

export interface IITMFrame {
	port: number;                   // 0-31 for stimulus; -1 for DWT/exception
	data: string;                   // decoded string (port 0) or hex for others
	rawValue: number;               // raw 32-bit value
	timestamp: number;              // Date.now()
	type: ITMFrameType;
	exceptionNumber?: number;       // for exception frames
	exceptionAction?: 'entry' | 'exit' | 'return';
	cycleCount?: number;            // for DWT counter frames
}

export interface IITMConfig {
	cpuFreqHz: number;              // CPU frequency for SWO baud calculation
	swoFreqHz: number;              // SWO bit rate (typically cpuFreqHz / integer divisor)
	stimulusMask: number;           // bitmask of ports to enable (default 0xFFFFFFFF = all)
	enableDWT: boolean;             // enable DWT cycle counter
	enableExceptionTrace: boolean;  // enable exception trace
	enablePCSampling: boolean;      // enable PC sampling
}

export const DEFAULT_ITM_CONFIG: IITMConfig = {
	cpuFreqHz: 168000000,
	swoFreqHz: 2000000,
	stimulusMask: 0xFFFFFFFF,
	enableDWT: true,
	enableExceptionTrace: true,
	enablePCSampling: false,
};

export interface IITMStatus {
	active: boolean;
	config?: IITMConfig;
	framesReceived: number;
	overflowCount: number;
	error?: string;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const IITMService = createDecorator<IITMService>('itmService');

export interface IITMService {
	readonly _serviceBrand: undefined;

	readonly onITMFrame: Event<IITMFrame>;
	readonly onError: Event<string>;

	/** Start ITM tracing. Configures TPIU/ITM registers via GDB and begins streaming. */
	startITM(config?: Partial<IITMConfig>): Promise<void>;

	/** Stop ITM tracing. */
	stopITM(): Promise<void>;

	/** Get current status and statistics. */
	getStatus(): IITMStatus;

	/** Get buffered frames for a specific port. */
	readPort(port: number): IITMFrame[];

	/** Get all buffered text from port 0 (printf output). */
	getTextOutput(): string;

	/** Get PC samples for profiling (requires enablePCSampling). */
	getPCSamples(): Map<number, number>;

	/** Get exception timeline (requires enableExceptionTrace). */
	getExceptionTimeline(): IITMFrame[];
}


// ─── Implementation ───────────────────────────────────────────────────────────

class ITMServiceImpl extends Disposable implements IITMService {
	readonly _serviceBrand: undefined;

	private readonly _onITMFrame = this._register(new Emitter<IITMFrame>());
	readonly onITMFrame: Event<IITMFrame> = this._onITMFrame.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private _status: IITMStatus = { active: false, framesReceived: 0, overflowCount: 0 };
	private _portBuffers: Map<number, IITMFrame[]> = new Map();
	private _textOutput: string[] = [];
	private _pcSamples: Map<number, number> = new Map();
	private _exceptionTimeline: IITMFrame[] = [];
	private _swoProcess: ReturnType<typeof import('child_process').spawn> | null = null;

	async startITM(configOverride?: Partial<IITMConfig>): Promise<void> {
		const config: IITMConfig = { ...DEFAULT_ITM_CONFIG, ...configOverride };

		// Try OpenOCD approach first (more portable)
		const openocdAvailable = await this._checkOpenOCD();

		if (openocdAvailable) {
			await this._startOpenOCDITM(config);
		} else {
			await this._startJLinkITM(config);
		}

		this._status = { active: true, config, framesReceived: 0, overflowCount: 0 };
	}

	async stopITM(): Promise<void> {
		if (this._swoProcess) {
			this._swoProcess.kill('SIGTERM');
			this._swoProcess = null;
		}
		this._status = { ...this._status, active: false };
	}

	getStatus(): IITMStatus {
		return this._status;
	}

	readPort(port: number): IITMFrame[] {
		return this._portBuffers.get(port) ?? [];
	}

	getTextOutput(): string {
		return this._textOutput.join('');
	}

	getPCSamples(): Map<number, number> {
		return this._pcSamples;
	}

	getExceptionTimeline(): IITMFrame[] {
		return this._exceptionTimeline;
	}

	// ─── OpenOCD backend ──────────────────────────────────────────────────────

	private async _startOpenOCDITM(config: IITMConfig): Promise<void> {
		// OpenOCD ITM setup script
		const script = `
import subprocess, sys, time, struct, json

proc = subprocess.Popen(
    ['telnet', '127.0.0.1', '4444'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True
)

def cmd(c):
    proc.stdin.write(c + '\\n')
    proc.stdin.flush()
    time.sleep(0.1)
    return proc.stdout.readline()

# Configure TPIU for SWO output
cmd('reset halt')
cmd('tpiu config internal /dev/null uart off ${config.cpuFreqHz}')
cmd('itm port 0 on')
cmd('itm ports on ${config.stimulusMask}')

# Enable DWT
if ${config.enableDWT ? 1 : 0}:
    cmd('arm semihosting enable')
    cmd('write_memory 0xE0001000 32 0x40000001')  # DWT_CTRL: CYCCNTENA

# Enable exception tracing
if ${config.enableExceptionTrace ? 1 : 0}:
    cmd('write_memory 0xE0001000 32 0x40010001')  # DWT_CTRL: EXCTRCENA + CYCCNTENA

cmd('resume')

print(json.dumps({"status": "configured"}))
sys.stdout.flush()

# Stream SWO data
import socket
try:
    # OpenOCD SWO capture via TCP port 3344
    s = socket.create_connection(('127.0.0.1', 3344), timeout=5)
    print(json.dumps({"status": "streaming"}))
    sys.stdout.flush()

    buf = b''
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
        while len(buf) > 0:
            b = buf[0]
            buf = buf[1:]
            # ITM sync packet (4x 0xFF + 0x7F)
            if b == 0xFF:
                continue
            # ITM stimulus source packet: header = [PORT:4:0 | SIZE:1:0 | 1]
            # SIZE: 01=1B, 10=2B, 11=4B. Port 0-31.
            size_bits = b & 0x03
            if size_bits != 0 and (b & 0x04) == 0:  # lower nibble must be X001, X010, or X011
                port = (b >> 3) & 0x1F
                size_map = {1: 1, 2: 2, 3: 4}
                size = size_map.get(size_bits, 1)
                if len(buf) >= size:
                    data = buf[:size]
                    buf = buf[size:]
                    val = int.from_bytes(data, 'little')
                    if port == 0:
                        ch = chr(val & 0xFF) if 0x20 <= (val & 0xFF) < 0x7F else '.'
                        print(json.dumps({"type": "stimulus", "port": 0, "char": ch}))
                    else:
                        print(json.dumps({"type": "stimulus", "port": port, "value": val}))
                    sys.stdout.flush()
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.stdout.flush()
`;

		await this._spawnITMDecoder(script, 'openocd');
	}

	private async _startJLinkITM(config: IITMConfig): Promise<void> {
		const swoFreq = config.swoFreqHz;
		const cpuFreq = config.cpuFreqHz;

		const script = `
import subprocess, sys, time, json, re

# J-Link SWO capture via JLinkSWOViewerCL
proc = subprocess.Popen(
    ['JLinkSWOViewerCL', '-device', 'auto', '-itmport', '0x3',
     '-swofreq', '${swoFreq}', '-cpufreq', '${cpuFreq}'],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    universal_newlines=False
)

print(json.dumps({"status": "configured"}))
sys.stdout.flush()

# Pattern: JLinkSWOViewerCL outputs ITM data lines as:
# "00000ABC: xx xx xx xx | ...."  (hex dump format)
# Other lines are diagnostics to be filtered
HEX_DUMP_RE = re.compile(rb'^[0-9A-F]{8}:\s+([0-9A-F ]+)\|', re.IGNORECASE)
DIAG_PREFIXES = (b'J-Link', b'SEGGER', b'Connecting', b'Target', b'Info:', b'Found', b'SWD', b'--')

configured = False
for raw_line in proc.stdout:
    line = raw_line.strip()

    # Filter out diagnostic/status lines
    if any(line.startswith(p) for p in DIAG_PREFIXES):
        if b'Connected' in line or b'ITM' in line:
            if not configured:
                print(json.dumps({"status": "streaming"}))
                sys.stdout.flush()
                configured = True
        continue

    # Parse hex dump lines for ITM data
    m = HEX_DUMP_RE.match(line)
    if m:
        hex_bytes = m.group(1).decode('ascii', errors='replace').split()
        for hb in hex_bytes:
            try:
                val = int(hb, 16)
                if 0x20 <= val < 0x7F:
                    char = chr(val)
                    print(json.dumps({"type": "stimulus", "port": 0, "char": char}))
                    sys.stdout.flush()
            except ValueError:
                pass
    elif line and not configured:
        # Non-hex non-diagnostic: assume ITM text output (some JLink versions)
        try:
            text = line.decode('utf-8', errors='replace')
            if text and not any(text.startswith(p.decode()) for p in DIAG_PREFIXES):
                if not configured:
                    print(json.dumps({"status": "streaming"}))
                    sys.stdout.flush()
                    configured = True
                print(json.dumps({"type": "stimulus", "port": 0, "char": text}))
                sys.stdout.flush()
        except Exception:
            pass
`;

		await this._spawnITMDecoder(script, 'jlink');
	}

	private async _spawnITMDecoder(script: string, backend: string): Promise<void> {
		const cp = (globalThis as Record<string, unknown>)['require']
			? ((globalThis as Record<string, unknown>)['require']('child_process') as typeof import('child_process'))
			: null;

		if (!cp) { throw new Error('ITM requires Node.js environment.'); }

		this._swoProcess = cp.spawn('python3', ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });

		let configured = false;

		this._swoProcess.stdout?.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				try {
					const msg = JSON.parse(line) as Record<string, unknown>;

					if (msg['status'] === 'configured' || msg['status'] === 'streaming') {
						configured = true;
						return;
					}

					if (msg['error']) {
						this._onError.fire(String(msg['error']));
						return;
					}

					const frame = this._parseITMMessage(msg);
					if (frame) {
						this._storeFrame(frame);
						this._onITMFrame.fire(frame);
						this._status = { ...this._status, framesReceived: this._status.framesReceived + 1 };
					}
				} catch {
					// raw text — treat as port 0
					const frame: IITMFrame = {
						port: 0, data: line, rawValue: 0, timestamp: Date.now(), type: 'stimulus',
					};
					this._storeFrame(frame);
					this._onITMFrame.fire(frame);
				}
			}
		});

		this._swoProcess.stderr?.on('data', (d: Buffer) => {
			const err = d.toString();
			if (err.toLowerCase().includes('error') || err.toLowerCase().includes('cannot')) {
				this._onError.fire(err.trim());
			}
		});

		// Wait up to 5s for configuration
		const start = Date.now();
		while (!configured && Date.now() - start < 5000) {
			await new Promise(r => setTimeout(r, 200));
		}

		if (!configured) {
			throw new Error(
				`ITM/SWO configuration failed via ${backend}. ` +
				`Check: probe connected, OpenOCD running on port 4444, target halted then resumed. ` +
				`Install J-Link Software for JLink backend.`,
			);
		}
	}

	private _parseITMMessage(msg: Record<string, unknown>): IITMFrame | null {
		const type = String(msg['type'] ?? 'stimulus') as ITMFrameType;
		const port = Number(msg['port'] ?? 0);

		if (type === 'stimulus') {
			const ch = msg['char'] ? String(msg['char']) : '';
			const val = msg['value'] !== undefined ? Number(msg['value']) : 0;
			return { port, data: ch || `0x${val.toString(16).toUpperCase()}`, rawValue: val, timestamp: Date.now(), type };
		}

		if (type === 'exception') {
			return {
				port: -1, data: `IRQ${msg['irq']} ${msg['action']}`,
				rawValue: Number(msg['irq'] ?? 0), timestamp: Date.now(), type,
				exceptionNumber: Number(msg['irq'] ?? 0),
				exceptionAction: String(msg['action'] ?? 'entry') as 'entry' | 'exit' | 'return',
			};
		}

		if (type === 'pc-sample') {
			const pc = Number(msg['pc'] ?? 0);
			return { port: -1, data: `0x${pc.toString(16).toUpperCase()}`, rawValue: pc, timestamp: Date.now(), type };
		}

		return null;
	}

	private _storeFrame(frame: IITMFrame): void {
		if (frame.type === 'stimulus') {
			const buf = this._portBuffers.get(frame.port) ?? [];
			buf.push(frame);
			if (buf.length > 10000) { buf.splice(0, buf.length - 10000); }
			this._portBuffers.set(frame.port, buf);

			if (frame.port === 0 && frame.data) {
				this._textOutput.push(frame.data);
				if (this._textOutput.length > 10000) { this._textOutput.splice(0, this._textOutput.length - 10000); }
			}
		} else if (frame.type === 'exception') {
			this._exceptionTimeline.push(frame);
			if (this._exceptionTimeline.length > 5000) { this._exceptionTimeline.splice(0, 1000); }
		} else if (frame.type === 'pc-sample') {
			const count = this._pcSamples.get(frame.rawValue) ?? 0;
			this._pcSamples.set(frame.rawValue, count + 1);
		}
	}

	private async _checkOpenOCD(): Promise<boolean> {
		const cp = (globalThis as Record<string, unknown>)['require']
			? ((globalThis as Record<string, unknown>)['require']('child_process') as typeof import('child_process'))
			: null;
		if (!cp) { return false; }

		return new Promise(resolve => {
			const proc = cp.spawn('openocd', ['--version'], { timeout: 2000 });
			proc.on('close', (code: number) => resolve(code === 0));
			proc.on('error', () => resolve(false));
		});
	}
}


registerSingleton(IITMService, ITMServiceImpl, InstantiationType.Delayed);
