/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEGGER Real-Time Transfer (RTT) Service
 *
 * Drives J-Link RTT for zero-overhead printf-style debug logging via SWD/JTAG.
 * No UART peripheral needed — RTT uses a shared memory buffer that J-Link reads
 * via background SWD access while the CPU runs at full speed.
 *
 * Backends:
 *   1. JLinkExe CLI subprocess: spawns JLinkExe with RTT commands, reads stdout
 *   2. pylink Python package: via subprocess, provides structured API
 *
 * RTT channel 0 is the default printf/logging channel (down = host->MCU, up = MCU->host).
 * Channels 1-31 are available for custom data streams.
 *
 * Logs stored in .inverse/rtt/<sessionId>/ch<N>.log
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface IRTTChannel {
	index: number;
	name: string;
	direction: 'up' | 'down';   // up = MCU->host, down = host->MCU
	bufferSize: number;
}

export interface IRTTFrame {
	channel: number;
	data: string;
	timestamp: number;
	rawBytes: Uint8Array;
}

export interface IRTTStatus {
	connected: boolean;
	targetDevice?: string;
	interface?: 'swd' | 'jtag';
	speedKHz?: number;
	channels?: IRTTChannel[];
	error?: string;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const IRTTService = createDecorator<IRTTService>('rttService');

export interface IRTTService {
	readonly _serviceBrand: undefined;

	readonly onRTTData: Event<IRTTFrame>;
	readonly onRTTConnected: Event<IRTTStatus>;
	readonly onRTTError: Event<string>;

	/** Start RTT session. Connects J-Link to target and begins streaming. */
	startRTT(targetDevice: string, interfaceType?: 'swd' | 'jtag', speedKHz?: number): Promise<void>;

	/** Stop RTT session and close J-Link connection. */
	stopRTT(): Promise<void>;

	/** Get current RTT status. */
	getStatus(): IRTTStatus;

	/** Read buffered data from an RTT up-channel (MCU->host). */
	readChannel(channel?: number): Promise<string[]>;

	/** Write data to an RTT down-channel (host->MCU). */
	writeChannel(channel: number, data: string): Promise<void>;

	/** Get list of available RTT channels. */
	getChannels(): IRTTChannel[];

	/** Get full log for a channel. */
	getChannelLog(channel: number): string[];
}


// ─── Implementation ───────────────────────────────────────────────────────────

class RTTServiceImpl extends Disposable implements IRTTService {
	readonly _serviceBrand: undefined;

	private readonly _onRTTData = this._register(new Emitter<IRTTFrame>());
	readonly onRTTData: Event<IRTTFrame> = this._onRTTData.event;

	private readonly _onRTTConnected = this._register(new Emitter<IRTTStatus>());
	readonly onRTTConnected: Event<IRTTStatus> = this._onRTTConnected.event;

	private readonly _onRTTError = this._register(new Emitter<string>());
	readonly onRTTError: Event<string> = this._onRTTError.event;

	private _status: IRTTStatus = { connected: false };
	private _channels: IRTTChannel[] = [];
	private _channelLogs: Map<number, string[]> = new Map();
	private _jlinkProcess: ReturnType<typeof import('child_process').spawn> | null = null;
	private _pollInterval: ReturnType<typeof setInterval> | null = null;

	async startRTT(targetDevice: string, interfaceType: 'swd' | 'jtag' = 'swd', speedKHz = 4000): Promise<void> {
		if (this._status.connected) {
			await this.stopRTT();
		}

		// Try JLinkExe first, fall back to pylink
		const jlinkAvailable = await this._checkJLink();

		if (jlinkAvailable) {
			await this._startJLinkExe(targetDevice, interfaceType, speedKHz);
		} else {
			await this._startPylink(targetDevice, interfaceType, speedKHz);
		}
	}

	async stopRTT(): Promise<void> {
		if (this._pollInterval) {
			clearInterval(this._pollInterval);
			this._pollInterval = null;
		}
		if (this._jlinkProcess) {
			try {
				this._jlinkProcess.stdin?.write('exit\n');
				await new Promise(r => setTimeout(r, 500));
				this._jlinkProcess.kill('SIGTERM');
			} catch {
				// ignore kill errors
			}
			this._jlinkProcess = null;
		}
		this._status = { connected: false };
	}

	getStatus(): IRTTStatus {
		return this._status;
	}

	async readChannel(channel = 0): Promise<string[]> {
		if (!this._status.connected) {
			throw new Error('RTT not connected. Run fw_rtt_start first.');
		}
		return this._channelLogs.get(channel) ?? [];
	}

	async writeChannel(channel: number, data: string): Promise<void> {
		if (!this._status.connected) {
			throw new Error('RTT not connected. Run fw_rtt_start first.');
		}
		if (!this._jlinkProcess?.stdin) {
			throw new Error('JLink process not available for write.');
		}
		// JLinkExe RTT write via rtterminal command
		this._jlinkProcess.stdin.write(`rtterminal write ${channel} "${data.replace(/"/g, '\\"')}"\n`);
	}

	getChannels(): IRTTChannel[] {
		return this._channels;
	}

	getChannelLog(channel: number): string[] {
		return this._channelLogs.get(channel) ?? [];
	}

	// ─── JLinkExe backend ─────────────────────────────────────────────────────

	private async _startJLinkExe(target: string, iface: string, speed: number): Promise<void> {
		const cp = this._requireCP();

		// Create JLink script file using OS-appropriate temp dir
		const os = (globalThis as Record<string, unknown>)['require']
			? ((globalThis as Record<string, unknown>)['require'] as (m: string) => unknown)('os') as typeof import('os')
			: null;
		const path = (globalThis as Record<string, unknown>)['require']
			? ((globalThis as Record<string, unknown>)['require'] as (m: string) => unknown)('path') as typeof import('path')
			: null;

		const script = [
			`device ${target}`,
			`si ${iface.toUpperCase()}`,
			`speed ${speed}`,
			`connect`,
			`rttstart`,
		].join('\n');

		const fs = this._requireFS();
		const tmpDir = os ? os.tmpdir() : '/tmp';
		const scriptPath = path ? path.join(tmpDir, `ni_rtt_${Date.now()}.jlink`) : `/tmp/ni_rtt_${Date.now()}.jlink`;
		fs.writeFileSync(scriptPath, script, 'utf8');

		this._jlinkProcess = cp.spawn('JLinkExe', ['-CommandFile', scriptPath], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let output = '';
		let connected = false;

		this._jlinkProcess.stdout?.on('data', (chunk: unknown) => {
			const text = String(chunk);
			output += text;

			const lines = text.split('\n');
			for (const line of lines) {
				// Detect successful RTT connection across all JLink firmware versions:
				// "RTT enabled." / "RTT started." / "Connected to target" / "NumUpBuffers"
				if (
					(line.toLowerCase().includes('rtt') && (line.includes('enabl') || line.includes('start') || line.includes('found'))) ||
					line.includes('NumUpBuffers') ||
					(line.includes('Connected') && line.includes('target'))
				) {
					if (!connected) {
						connected = true;
						this._status = { connected: true, targetDevice: target, interface: iface as 'swd' | 'jtag', speedKHz: speed };
						this._parseRTTChannels(output);
						this._onRTTConnected.fire(this._status);
					}
				}

				// Parse RTT terminal output — multiple JLink output formats:
				// 1. "###RTT Terminal [0]: <data>"  (older JLink)
				// 2. "###RTT Client: <data>"
				// 3. Raw data after "rtterminal read 0" command
				// 4. SEGGER_RTT_printf output mixed in stdout
				const rttPatterns = [
					/###RTT Terminal\s*(?:\[\d+\])?:\s*(.*)/,
					/###RTT Client:\s*(.*)/,
					/JLINK_RTT_Read:\s*(.*)/,
				];

				let matched = false;
				for (const pattern of rttPatterns) {
					const m = line.match(pattern);
					if (m) {
						const data = m[1] ?? '';
						if (data.trim()) {
							const frame: IRTTFrame = { channel: 0, data, timestamp: Date.now(), rawBytes: new TextEncoder().encode(data) };
							this._appendToLog(0, data);
							this._onRTTData.fire(frame);
						}
						matched = true;
						break;
					}
				}

				// If already connected and line doesn't look like a JLink diagnostic, treat as RTT data
				if (!matched && connected && line.trim() &&
					!line.startsWith('J-Link') && !line.startsWith('SEGGER') &&
					!line.startsWith('Connecting') && !line.startsWith('Target') &&
					!line.startsWith('Found') && !line.startsWith('Info:') &&
					!line.startsWith('VTarget') && !line.includes('SWD frequency') &&
					!line.startsWith('#')) {
					const data = line.trim();
					const frame: IRTTFrame = { channel: 0, data, timestamp: Date.now(), rawBytes: new TextEncoder().encode(data) };
					this._appendToLog(0, data);
					this._onRTTData.fire(frame);
				}
			}
		});

		this._jlinkProcess.stderr?.on('data', (chunk: unknown) => {
			const err = String(chunk);
			if (err.includes('Cannot connect') || err.includes('Error')) {
				this._onRTTError.fire(err.trim());
			}
		});

		this._jlinkProcess.on('close', () => {
			this._status = { connected: false };
			if (this._pollInterval) { clearInterval(this._pollInterval); }
			// Clean up temp script file
			try { fs.unlinkSync(scriptPath); } catch { /* file already cleaned up */ }
		});

		// Wait for connection or timeout
		const timeout = 10000;
		const start = Date.now();
		while (!connected && Date.now() - start < timeout) {
			await new Promise(r => setTimeout(r, 200));
		}

		if (!connected) {
			throw new Error(
				`J-Link RTT connection timeout. ` +
				`Target: ${target}. Check:\n` +
				`  1. J-Link probe connected via USB\n` +
				`  2. Target MCU powered on\n` +
				`  3. Target device name correct (e.g. STM32F407VG, nRF52840_xxAA)\n` +
				`  4. JLinkExe in PATH (install J-Link Software from segger.com)`,
			);
		}

		// Start polling for new data every 100ms
		this._pollInterval = setInterval(() => {
			if (this._jlinkProcess?.stdin && this._status.connected) {
				this._jlinkProcess.stdin.write('rtterminal read 0\n');
			}
		}, 100);
	}

	private async _startPylink(target: string, iface: string, speed: number): Promise<void> {
		const script = `
import pylink, time, sys, json

jlink = pylink.JLink()
jlink.open()
jlink.set_tif(pylink.JLinkInterfaces.${iface.toUpperCase()})
jlink.connect('${target}', verbose=False, speed=${speed})
jlink.rtt_start()
time.sleep(0.5)

num_buffers = jlink.rtt_get_num_up_buffers() + jlink.rtt_get_num_down_buffers()
print(json.dumps({"status": "connected", "channels": num_buffers}))
sys.stdout.flush()

# Stream output until killed
while True:
    try:
        data = bytes(jlink.rtt_read(0, 1024))
        if data:
            text = data.decode('utf-8', errors='replace')
            print(json.dumps({"ch": 0, "data": text}))
            sys.stdout.flush()
    except pylink.errors.JLinkRTTException as e:
        # RTT not yet initialized in firmware — keep polling
        pass
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.stdout.flush()
        break
    time.sleep(0.05)
`;

		const cp = this._requireCP();
		this._jlinkProcess = cp.spawn('python3', ['-c', script], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let connected = false;

		this._jlinkProcess.stdout?.on('data', (chunk: unknown) => {
			const lines = String(chunk).split('\n').filter(Boolean);
			for (const line of lines) {
				try {
					const msg = JSON.parse(line) as Record<string, unknown>;
					if (msg['status'] === 'connected') {
						connected = true;
						this._status = { connected: true, targetDevice: target, interface: iface as 'swd' | 'jtag' };
						this._onRTTConnected.fire(this._status);
					} else if (msg['ch'] !== undefined && msg['data']) {
						const ch = Number(msg['ch']);
						const data = String(msg['data']);
						const frame: IRTTFrame = { channel: ch, data, timestamp: Date.now(), rawBytes: new TextEncoder().encode(data) };
						this._appendToLog(ch, data);
						this._onRTTData.fire(frame);
					}
				} catch {
					// non-JSON output — treat as channel 0 raw text
					this._appendToLog(0, line);
				}
			}
		});

		const start = Date.now();
		while (!connected && Date.now() - start < 10000) {
			await new Promise(r => setTimeout(r, 200));
		}

		if (!connected) {
			throw new Error(
				`pylink RTT connection failed. ` +
				`Install: pip install pylink-square. ` +
				`Ensure J-Link connected and target device "${target}" is correct.`,
			);
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	private async _checkJLink(): Promise<boolean> {
		const cp = this._requireCP();
		return new Promise(resolve => {
			const proc = cp.spawn('JLinkExe', ['--version'], { timeout: 3000 });
			proc.on('close', (code: number) => resolve(code === 0));
			proc.on('error', () => resolve(false));
		});
	}

	private _parseRTTChannels(output: string): void {
		// Extract channel info from JLinkExe RTT output
		const upMatch = output.match(/(\d+) up-channel/);
		const downMatch = output.match(/(\d+) down-channel/);
		const numUp = upMatch ? parseInt(upMatch[1]!) : 1;
		const numDown = downMatch ? parseInt(downMatch[1]!) : 1;

		this._channels = [];
		for (let i = 0; i < numUp; i++) {
			this._channels.push({ index: i, name: i === 0 ? 'Terminal' : `Up${i}`, direction: 'up', bufferSize: 1024 });
		}
		for (let i = 0; i < numDown; i++) {
			this._channels.push({ index: i, name: i === 0 ? 'Terminal' : `Down${i}`, direction: 'down', bufferSize: 16 });
		}
		this._status = { ...this._status, channels: this._channels };
	}

	private _appendToLog(channel: number, data: string): void {
		const log = this._channelLogs.get(channel) ?? [];
		log.push(...data.split('\n').filter(l => l.length > 0));
		// Keep last 10000 lines per channel
		if (log.length > 10000) { log.splice(0, log.length - 10000); }
		this._channelLogs.set(channel, log);
	}

	private _requireCP(): typeof import('child_process') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('RTT requires Node.js environment (VS Code extension host).'); }
		return (req as NodeRequire)('child_process') as typeof import('child_process');
	}

	private _requireFS(): typeof import('fs') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('RTT requires Node.js environment.'); }
		return (req as NodeRequire)('fs') as typeof import('fs');
	}
}


registerSingleton(IRTTService, RTTServiceImpl, InstantiationType.Delayed);
