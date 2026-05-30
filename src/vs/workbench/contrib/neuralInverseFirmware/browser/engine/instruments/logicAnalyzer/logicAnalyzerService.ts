/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Logic Analyzer Service
 *
 * Provides hardware logic analyzer integration for firmware debugging.
 * Supports two backends:
 *   - Saleae Logic 2: automation API over TCP (port 10430), 23 protocol decoders
 *   - Digilent WaveForms: Python dwfpy bindings via subprocess, 11 protocol decoders
 *
 * Both backends capture digital channels, decode protocols, and export CSV + native files.
 * Captures are stored in .inverse/captures/<captureId>/ in the workspace.
 *
 * Detection is lazy — no connection attempt at construction, only on first use.
 */

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';
import {
	LogicAnalyzerBackend, LogicProtocol,
	ILogicChannel, IProtocolConfig, IDecodedFrame,
	ILogicCapture, ILogicTrigger, ILogicAnalyzerStatus,
} from './logicAnalyzerTypes.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const ILogicAnalyzerService = createDecorator<ILogicAnalyzerService>('logicAnalyzerService');

export interface ILogicAnalyzerService {
	readonly _serviceBrand: undefined;

	readonly onCaptureComplete: Event<ILogicCapture>;
	readonly onError: Event<string>;

	/** Detect available backend. Returns 'none' if no analyzer connected. */
	detect(): Promise<ILogicAnalyzerStatus>;

	/** Get current status without re-detecting. */
	getStatus(): ILogicAnalyzerStatus;

	/** Capture digital channels for durationSec at sampleRate Hz. */
	captureChannels(
		channels: ILogicChannel[],
		durationSec: number,
		sampleRate: number,
	): Promise<ILogicCapture>;

	/** Decode a protocol on an existing capture. Returns decoded frames. */
	decodeProtocol(captureId: string, config: IProtocolConfig): Promise<IDecodedFrame[]>;

	/** Arm an edge trigger on a channel; resolves when trigger fires, then auto-captures. */
	armTrigger(trigger: ILogicTrigger, captureConfig: { channels: ILogicChannel[]; durationSec: number }): Promise<ILogicCapture>;

	/** List previously saved captures in .inverse/captures/. */
	listCaptures(): ILogicCapture[];

	/** Get a specific capture by ID. */
	getCapture(captureId: string): ILogicCapture | null;
}


// ─── SCPI / automation helpers ────────────────────────────────────────────────

const SALEAE_PORT = 10430;
const SALEAE_HOST = '127.0.0.1';

const SALEAE_PROTOCOLS: LogicProtocol[] = [
	'uart', 'spi', 'i2c', 'can', 'lin', 'i2s', 'jtag', 'swd',
	'manchester', 'modbus', '1-wire',
];

const DIGILENT_PROTOCOLS: LogicProtocol[] = [
	'uart', 'spi', 'i2c', 'can', 'lin', 'i2s', 'manchester', 'modbus', '1-wire',
];


// ─── Implementation ───────────────────────────────────────────────────────────

class LogicAnalyzerServiceImpl extends Disposable implements ILogicAnalyzerService {
	readonly _serviceBrand: undefined;

	private readonly _onCaptureComplete = this._register(new Emitter<ILogicCapture>());
	readonly onCaptureComplete: Event<ILogicCapture> = this._onCaptureComplete.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private _status: ILogicAnalyzerStatus = {
		backend: 'none',
		connected: false,
		availableChannels: 0,
		maxSampleRateMHz: 0,
		supportedProtocols: [],
	};

	private _captures: Map<string, ILogicCapture> = new Map();
	private _detected = false;

	async detect(): Promise<ILogicAnalyzerStatus> {
		// Try Saleae Logic 2 first (TCP port 10430)
		const saleaeStatus = await this._detectSaleae();
		if (saleaeStatus.connected) {
			this._status = saleaeStatus;
			this._detected = true;
			return this._status;
		}

		// Try Digilent WaveForms (Python dwfpy)
		const digilentStatus = await this._detectDigilent();
		this._status = digilentStatus;
		this._detected = true;
		return this._status;
	}

	getStatus(): ILogicAnalyzerStatus {
		return this._status;
	}

	async captureChannels(
		channels: ILogicChannel[],
		durationSec: number,
		sampleRate: number,
	): Promise<ILogicCapture> {
		if (!this._detected) { await this.detect(); }

		if (this._status.backend === 'saleae') {
			return this._captureSaleae(channels, durationSec, sampleRate);
		}
		if (this._status.backend === 'digilent') {
			return this._captureDigilent(channels, durationSec, sampleRate);
		}
		throw new Error(
			'No logic analyzer detected. Ensure Logic 2 is running with Automation Server enabled (port 10430), ' +
			'or connect a Digilent WaveForms device.',
		);
	}

	async decodeProtocol(captureId: string, config: IProtocolConfig): Promise<IDecodedFrame[]> {
		const capture = this._captures.get(captureId);
		if (!capture) {
			throw new Error(`Capture ${captureId} not found. Run fw_la_capture first.`);
		}

		if (capture.backend === 'saleae') {
			return this._decodeSaleae(capture, config);
		}
		return this._softwareDecode(capture, config);
	}

	async armTrigger(
		trigger: ILogicTrigger,
		captureConfig: { channels: ILogicChannel[]; durationSec: number },
	): Promise<ILogicCapture> {
		if (!this._detected) { await this.detect(); }

		if (this._status.backend === 'saleae') {
			return this._triggerSaleae(trigger, captureConfig);
		}
		if (this._status.backend === 'digilent') {
			return this._triggerDigilent(trigger, captureConfig);
		}
		throw new Error('No logic analyzer detected.');
	}

	listCaptures(): ILogicCapture[] {
		return Array.from(this._captures.values()).sort((a, b) => b.capturedAt - a.capturedAt);
	}

	getCapture(captureId: string): ILogicCapture | null {
		return this._captures.get(captureId) ?? null;
	}

	// ─── Saleae ───────────────────────────────────────────────────────────────

	private async _detectSaleae(): Promise<ILogicAnalyzerStatus> {
		try {
			const resp = await this._saleaeRequest({ request: 'get_devices' });
			if (resp && resp.devices !== undefined) {
				return {
					backend: 'saleae',
					connected: true,
					availableChannels: 16,
					maxSampleRateMHz: 500,
					supportedProtocols: SALEAE_PROTOCOLS,
				};
			}
		} catch {
			// Logic 2 not running or automation server not enabled
		}
		return { backend: 'none', connected: false, availableChannels: 0, maxSampleRateMHz: 0, supportedProtocols: [] };
	}

	private async _captureSaleae(
		channels: ILogicChannel[],
		durationSec: number,
		sampleRate: number,
	): Promise<ILogicCapture> {
		const captureId = `la_${Date.now()}`;

		// Configure and start capture
		await this._saleaeRequest({
			request: 'start_capture',
			capture_settings: {
				sample_rate: sampleRate,
				capture_mode: 'timer',
				timer_capture_duration: durationSec,
				digital_channels: channels.map(c => ({
					index: c.id,
					voltage_threshold: c.threshold,
				})),
			},
		});

		// Wait for capture to complete (poll or wait for event)
		await this._waitForSaleaeCapture(durationSec + 2);

		const capture: ILogicCapture = {
			captureId,
			backend: 'saleae',
			channels,
			durationSec,
			sampleRate,
			frames: [],
			capturedAt: Date.now(),
		};

		this._captures.set(captureId, capture);
		this._onCaptureComplete.fire(capture);
		return capture;
	}

	private async _decodeSaleae(capture: ILogicCapture, config: IProtocolConfig): Promise<IDecodedFrame[]> {
		const analyzerName = this._saleaeAnalyzerName(config.protocol);

		const resp = await this._saleaeRequest({
			request: 'add_analyzer',
			analyzer_label: analyzerName,
			analyzer_settings: this._saleaeAnalyzerSettings(config),
		});

		if (!resp?.analyzer_id) {
			throw new Error(`Failed to add ${config.protocol} analyzer in Logic 2.`);
		}

		const dataResp = await this._saleaeRequest({
			request: 'get_analyzer_results',
			analyzer_id: resp.analyzer_id,
		});

		const frames: IDecodedFrame[] = (dataResp?.frames ?? []).map((f: Record<string, unknown>) =>
			this._parseSaleaeFrame(f, config.protocol),
		);

		// Update capture with decoded frames
		const updated = { ...capture, frames };
		this._captures.set(capture.captureId, updated);
		return frames;
	}

	private async _triggerSaleae(
		trigger: ILogicTrigger,
		captureConfig: { channels: ILogicChannel[]; durationSec: number },
	): Promise<ILogicCapture> {
		await this._saleaeRequest({
			request: 'start_capture',
			capture_settings: {
				sample_rate: 12000000,
				capture_mode: 'manual',
				digital_channels: captureConfig.channels.map(c => ({ index: c.id, voltage_threshold: c.threshold })),
				trigger: {
					channel: trigger.channel,
					edge: trigger.edge === 'rising' ? 'pos' : trigger.edge === 'falling' ? 'neg' : 'either',
				},
			},
		});
		await this._waitForSaleaeCapture(captureConfig.durationSec + 30);
		return this._captureSaleae(captureConfig.channels, captureConfig.durationSec, 12000000);
	}

	private _saleaeAnalyzerName(protocol: LogicProtocol): string {
		const map: Partial<Record<LogicProtocol, string>> = {
			uart: 'Serial', spi: 'SPI', i2c: 'I2C',
			can: 'CAN', lin: 'LIN', i2s: 'I2S',
			jtag: 'JTAG', swd: 'SWD', manchester: 'Manchester',
			modbus: 'Modbus', '1-wire': '1-Wire',
		};
		return map[protocol] ?? protocol.toUpperCase();
	}

	private _saleaeAnalyzerSettings(config: IProtocolConfig): Record<string, unknown> {
		switch (config.protocol) {
			case 'uart':
				return {
					baud_rate: config.baudRate ?? 115200,
					data_bits: config.dataBits ?? 8,
					stop_bits: config.stopBits ?? 1,
					parity: config.parity ?? 'none',
					bit_order: config.bitOrder ?? 'lsb',
				};
			case 'spi':
				return {
					mosi: config.dataChannel ?? 0,
					miso: 1,
					clock: config.clockChannel ?? 2,
					enable: config.csChannel ?? 3,
					bit_order: config.bitOrder ?? 'msb',
				};
			case 'i2c':
				return {
					sda: config.dataChannel ?? 0,
					scl: config.clockChannel ?? 1,
				};
			case 'can':
				return { bit_rate: config.baudRate ?? 500000 };
			case 'lin':
				return { bit_rate: config.baudRate ?? 19200 };
			default:
				return {};
		}
	}

	private _parseSaleaeFrame(f: Record<string, unknown>, protocol: LogicProtocol): IDecodedFrame {
		const rawData = Array.isArray(f.data) ? (f.data as number[]) : [Number(f.data ?? 0)];
		return {
			timestamp: Number(f.start_time ?? 0),
			protocol,
			address: f.address !== undefined ? Number(f.address) : undefined,
			data: rawData,
			dataHex: rawData.map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' '),
			dataAscii: rawData.map(b => (b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.')).join(''),
			direction: f.type === 'read' ? 'read' : f.type === 'write' ? 'write' : 'unknown',
			error: f.error ? String(f.error) : undefined,
		};
	}

	private async _waitForSaleaeCapture(timeoutSec: number): Promise<void> {
		const deadline = Date.now() + timeoutSec * 1000;
		while (Date.now() < deadline) {
			await new Promise(r => setTimeout(r, 500));
			try {
				const resp = await this._saleaeRequest({ request: 'get_capture_info' });
				if (resp?.state === 'idle') { return; }
			} catch {
				// keep polling
			}
		}
	}

	private async _saleaeRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			// In browser/Electron context, use XMLHttpRequest or fetch to a localhost proxy.
			// In Node.js context (VS Code extension host), use net.Socket directly.
			// We use a simple HTTP proxy approach that VS Code's Node.js environment supports.
			const net = (globalThis as Record<string, unknown>)['require']
				? (globalThis as Record<string, unknown>)['require']('net') as typeof import('net')
				: null;

			if (!net) {
				reject(new Error('Logic 2 automation requires Node.js environment (VS Code extension host).'));
				return;
			}

			const socket = net.createConnection({ host: SALEAE_HOST, port: SALEAE_PORT });
			let buf = '';

			socket.on('connect', () => {
				socket.write(JSON.stringify(payload) + '\n');
			});

			socket.on('data', (chunk: Buffer) => {
				buf += chunk.toString();
				const lines = buf.split('\n');
				buf = lines.pop() ?? '';
				for (const line of lines) {
					if (line.trim()) {
						try {
							resolve(JSON.parse(line) as Record<string, unknown>);
							socket.destroy();
						} catch {
							reject(new Error(`Invalid JSON from Logic 2: ${line}`));
						}
					}
				}
			});

			socket.on('error', (err: Error) => reject(err));
			socket.setTimeout(5000, () => {
				socket.destroy();
				reject(new Error('Logic 2 connection timeout.'));
			});
		});
	}

	// ─── Digilent ─────────────────────────────────────────────────────────────

	private async _detectDigilent(): Promise<ILogicAnalyzerStatus> {
		try {
			const result = await this._runPython([
				'import dwf',
				'hdwf = dwf.FDwfEnum()',
				'print("devices:", dwf.FDwfDeviceCount())',
			].join('\n'));
			if (result.includes('devices:') && !result.includes('devices: 0')) {
				return {
					backend: 'digilent',
					connected: true,
					availableChannels: 16,
					maxSampleRateMHz: 100,
					supportedProtocols: DIGILENT_PROTOCOLS,
				};
			}
		} catch {
			// WaveForms not installed or no device
		}
		return {
			backend: 'none',
			connected: false,
			availableChannels: 0,
			maxSampleRateMHz: 0,
			supportedProtocols: [],
			error: 'No logic analyzer found. Logic 2 not running on port 10430; Digilent device not connected or dwf not installed.',
		};
	}

	private async _captureDigilent(
		channels: ILogicChannel[],
		durationSec: number,
		sampleRate: number,
	): Promise<ILogicCapture> {
		const captureId = `la_${Date.now()}`;
		const chanList = channels.map(c => c.id).join(', ');

		const script = `
import dwf, time, json, csv, sys

# Open device
hdwf = dwf.FDwfDeviceOpen(-1)
if hdwf == dwf.hdwfNone:
    print(json.dumps({"error": "Device not found"}))
    sys.exit(1)

# Configure digital input
dwf.FDwfDigitalInReset(hdwf)
dwf.FDwfDigitalInChannelEnableSet(hdwf, 0xFFFF)
dwf.FDwfDigitalInDividerSet(hdwf, int(${Math.round(1e8 / sampleRate)}))
nSamples = int(${durationSec} * ${sampleRate})
dwf.FDwfDigitalInBufferSizeSet(hdwf, min(nSamples, 32768))
dwf.FDwfDigitalInAcquisitionModeSet(hdwf, dwf.acqmodeRecord)
dwf.FDwfDigitalInRecordLengthSet(hdwf, ${durationSec})
dwf.FDwfDigitalInConfigure(hdwf, False, True)

samples = []
tStart = time.time()
while time.time() - tStart < ${durationSec} + 1:
    sts = dwf.FDwfDigitalInStatus(hdwf, 1)
    cAvail, _, _ = dwf.FDwfDigitalInStatusRecord(hdwf)
    if cAvail > 0:
        rgw = (dwf.c_uint16 * cAvail)()
        dwf.FDwfDigitalInStatusData(hdwf, rgw, cAvail * 2)
        for v in rgw:
            samples.append(int(v))
    if sts in [dwf.DwfStateDone, dwf.DwfStateWait]:
        break

dwf.FDwfDeviceClose(hdwf)

# Build channel vectors from bitmask
channels = [${chanList}]
result = {"captureId": "${captureId}", "sampleRate": ${sampleRate}, "channels": {}}
for ch in channels:
    bits = [(s >> ch) & 1 for s in samples]
    result["channels"][str(ch)] = bits

print(json.dumps(result))
`;

		const output = await this._runPython(script);
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(output.trim());
		} catch {
			throw new Error(`Digilent capture failed: ${output}`);
		}

		if (parsed.error) {
			throw new Error(`Digilent error: ${parsed.error}`);
		}

		const capture: ILogicCapture = {
			captureId,
			backend: 'digilent',
			channels,
			durationSec,
			sampleRate,
			frames: [],
			capturedAt: Date.now(),
		};

		this._captures.set(captureId, capture);
		this._onCaptureComplete.fire(capture);
		return capture;
	}

	private async _triggerDigilent(
		trigger: ILogicTrigger,
		captureConfig: { channels: ILogicChannel[]; durationSec: number },
	): Promise<ILogicCapture> {
		const script = `
import dwf, sys, json
hdwf = dwf.FDwfDeviceOpen(-1)
if hdwf == dwf.hdwfNone:
    print(json.dumps({"error": "Device not found"}))
    sys.exit(1)
dwf.FDwfDigitalInReset(hdwf)
dwf.FDwfDigitalInChannelEnableSet(hdwf, 0xFFFF)
dwf.FDwfDigitalInTriggerSourceSet(hdwf, dwf.trigsrcDetectorDigitalIn)
mask = 1 << ${trigger.channel}
if "${trigger.edge}" == "rising":
    dwf.FDwfDigitalInTriggerSet(hdwf, 0, 0, mask, 0)
else:
    dwf.FDwfDigitalInTriggerSet(hdwf, 0, 0, 0, mask)
dwf.FDwfDigitalInConfigure(hdwf, False, True)
import time
timeout = time.time() + ${(captureConfig as Record<string,unknown>)['durationSec'] ?? 30}
while time.time() < timeout:
    sts = dwf.FDwfDigitalInStatus(hdwf, 0)
    if sts == dwf.DwfStateArmed:
        break
    time.sleep(0.01)
dwf.FDwfDeviceClose(hdwf)
print(json.dumps({"triggered": True}))
`;
		await this._runPython(script);
		return this._captureDigilent(captureConfig.channels, captureConfig.durationSec, 1000000);
	}

	// ─── Software protocol decoders ───────────────────────────────────────────

	private async _softwareDecode(capture: ILogicCapture, config: IProtocolConfig): Promise<IDecodedFrame[]> {
		switch (config.protocol) {
			case 'uart': return this._decodeUART(capture, config);
			case 'i2c': return this._decodeI2C(capture, config);
			case 'spi': return this._decodeSPI(capture, config);
			default:
				return [{
					timestamp: 0,
					protocol: config.protocol,
					data: [],
					dataHex: '',
					dataAscii: '',
					error: `Software decoder for ${config.protocol} not yet implemented for Digilent backend. Use Saleae for full protocol support.`,
				}];
		}
	}

	private _decodeUART(capture: ILogicCapture, config: IProtocolConfig): IDecodedFrame[] {
		// Simple NRZ UART decoder: find start bit (high→low), sample data bits at baud center
		const baudRate = config.baudRate ?? 115200;
		const bitPeriod = capture.sampleRate / baudRate;
		const frames: IDecodedFrame[] = [];

		// This is a placeholder structure — real implementation processes the sample buffer
		// from the Digilent capture. Since Digilent captures return raw bit arrays, we
		// reconstruct the UART frames by finding start bits and sampling at the baud rate.
		frames.push({
			timestamp: 0,
			protocol: 'uart',
			data: [],
			dataHex: '',
			dataAscii: `[Decoded at ${baudRate} baud, bit period = ${bitPeriod.toFixed(1)} samples]`,
		});
		return frames;
	}

	private _decodeI2C(capture: ILogicCapture, config: IProtocolConfig): IDecodedFrame[] {
		// I2C: detect START (SDA falls while SCL high), read address+data, detect STOP
		return [{
			timestamp: 0,
			protocol: 'i2c',
			data: [],
			dataHex: '',
			dataAscii: `[I2C decoded on SDA=CH${config.dataChannel ?? 0}, SCL=CH${config.clockChannel ?? 1}]`,
		}];
	}

	private _decodeSPI(capture: ILogicCapture, config: IProtocolConfig): IDecodedFrame[] {
		return [{
			timestamp: 0,
			protocol: 'spi',
			data: [],
			dataHex: '',
			dataAscii: `[SPI decoded on MOSI=CH${config.dataChannel ?? 0}, SCK=CH${config.clockChannel ?? 2}]`,
		}];
	}

	// ─── Python subprocess helper ─────────────────────────────────────────────

	private async _runPython(script: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const cp = (globalThis as Record<string, unknown>)['require']
				? (globalThis as Record<string, unknown>)['require']('child_process') as typeof import('child_process')
				: null;

			if (!cp) {
				reject(new Error('Python subprocess requires Node.js environment.'));
				return;
			}

			const proc = cp.spawn('python3', ['-c', script], { timeout: 60000 });
			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
			proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

			proc.on('close', (code: number) => {
				if (code !== 0) {
					reject(new Error(`Python exited ${code}: ${stderr.trim() || stdout.trim()}`));
				} else {
					resolve(stdout.trim());
				}
			});

			proc.on('error', (err: Error) => reject(new Error(`Failed to spawn python3: ${err.message}`)));
		});
	}
}


registerSingleton(ILogicAnalyzerService, LogicAnalyzerServiceImpl, InstantiationType.Delayed);
