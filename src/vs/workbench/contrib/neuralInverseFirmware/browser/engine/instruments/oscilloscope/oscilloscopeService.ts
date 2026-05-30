/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Oscilloscope Service
 *
 * Controls bench oscilloscopes over LAN using IEEE 488.2 SCPI protocol (port 5025).
 *
 * Primary target: Siglent SDS800X HD series (SDS802/804/812/814/822/824X HD).
 * Generic LXI/SCPI fallback works for any instrument that speaks standard SCPI.
 *
 * Discovery: mDNS query for _lxi._tcp service on local network.
 * Override: VOID_SCOPE_HOST env var for manual IP configuration.
 *
 * Waveform capture: arm trigger, wait for INR bit 0 (trigger complete),
 * read raw waveform binary via WAVEFORM? query, convert to voltage samples.
 */

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';
import {
	IScopeInfo, IScopeChannelConfig, IScopeTriggerConfig,
	IScopeWaveform, IScopeCapture, IScopeMeasurement, IScopeStatus,
} from './oscilloscopeTypes.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const IOscilloscopeService = createDecorator<IOscilloscopeService>('oscilloscopeService');

export interface IOscilloscopeService {
	readonly _serviceBrand: undefined;

	readonly onCapture: Event<IScopeCapture>;
	readonly onConnected: Event<IScopeInfo>;
	readonly onError: Event<string>;

	/** Discover scopes on LAN via mDNS. */
	discover(): Promise<IScopeInfo[]>;

	/** Connect to a scope at host:5025. */
	connect(host: string): Promise<IScopeInfo>;

	/** Disconnect from current scope. */
	disconnect(): void;

	/** Get current connection status. */
	getStatus(): IScopeStatus;

	/** Configure a channel (V/div, coupling, probe attenuation, offset). */
	configureChannel(config: IScopeChannelConfig): Promise<void>;

	/** Configure trigger source, edge, level, and mode. */
	configureTrigger(config: IScopeTriggerConfig): Promise<void>;

	/** Arm scope, wait for trigger, capture all enabled channels. */
	capture(timeoutSec?: number): Promise<IScopeCapture>;

	/** Run measurements on a channel (FREQ, RISE, FALL, PKPK, MEAN, RMS, DUTY). */
	measure(params: string[], channel: number): Promise<IScopeMeasurement[]>;

	/** Save screen BMP to path. */
	screenshot(path: string): Promise<void>;

	/** Check power rail droop: configure CH1, trigger on falling edge, return min V and droop duration. */
	railCheck(channel: number, nominalV: number, droopThreshold: number): Promise<{ minV: number; droopMs: number; triggered: boolean }>;

	/** Send raw SCPI command and return response. */
	sendSCPI(command: string): Promise<string>;
}


// ─── SCPI constants ───────────────────────────────────────────────────────────

const SCPI_PORT = 5025;
const SCPI_TIMEOUT_MS = 8000;
const WAVEFORM_PREAMBLE_FIELDS = 11;


// ─── Implementation ───────────────────────────────────────────────────────────

class OscilloscopeServiceImpl extends Disposable implements IOscilloscopeService {
	readonly _serviceBrand: undefined;

	private readonly _onCapture = this._register(new Emitter<IScopeCapture>());
	readonly onCapture: Event<IScopeCapture> = this._onCapture.event;

	private readonly _onConnected = this._register(new Emitter<IScopeInfo>());
	readonly onConnected: Event<IScopeInfo> = this._onConnected.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private _status: IScopeStatus = { connected: false };
	private _socket: import('net').Socket | null = null;
	private _host: string | null = null;
	private _captureSeq = 0;

	async discover(): Promise<IScopeInfo[]> {
		const discovered: IScopeInfo[] = [];

		// Check VOID_SCOPE_HOST env var first
		const envHost = process?.env?.['VOID_SCOPE_HOST'];
		if (envHost) {
			try {
				const info = await this.connect(envHost);
				discovered.push(info);
				return discovered;
			} catch {
				// env host not reachable
			}
		}

		// Try mDNS discovery via Python
		try {
			const output = await this._runPython(`
import json, socket
try:
    from zeroconf import ServiceBrowser, Zeroconf
    import time
    found = []
    class L:
        def add_service(self, zc, t, n):
            info = zc.get_service_info(t, n)
            if info:
                host = socket.inet_ntoa(info.addresses[0])
                found.append({"host": host, "name": n})
        def remove_service(self, *a): pass
        def update_service(self, *a): pass
    zc = Zeroconf()
    b = ServiceBrowser(zc, "_lxi._tcp.local.", handlers=[L()])
    time.sleep(2)
    zc.close()
    print(json.dumps(found))
except ImportError:
    print(json.dumps([]))
`);
			const hosts: Array<{ host: string; name: string }> = JSON.parse(output);
			for (const h of hosts) {
				try {
					const info = await this.connect(h.host);
					discovered.push(info);
				} catch {
					// unreachable
				}
			}
		} catch {
			// mDNS not available
		}

		return discovered;
	}

	async connect(host: string): Promise<IScopeInfo> {
		this._host = host;
		const idn = await this._scpiQuery('*IDN?');

		// Parse IDN: manufacturer,model,serial,firmware
		const parts = idn.split(',');
		const info: IScopeInfo = {
			host,
			port: SCPI_PORT,
			manufacturer: parts[0]?.trim() ?? 'Unknown',
			model: parts[1]?.trim() ?? 'Unknown',
			serialNumber: parts[2]?.trim() ?? '',
			firmware: parts[3]?.trim() ?? '',
		};

		this._status = { connected: true, host, model: info.model };
		this._onConnected.fire(info);
		return info;
	}

	disconnect(): void {
		this._socket?.destroy();
		this._socket = null;
		this._host = null;
		this._status = { connected: false };
	}

	getStatus(): IScopeStatus {
		return this._status;
	}

	async configureChannel(config: IScopeChannelConfig): Promise<void> {
		this._requireConnected();
		const ch = `C${config.channel}`;

		await this._scpiWrite(`${ch}:VOLT_DIV ${config.vDiv.toFixed(3)}`);
		await this._scpiWrite(`${ch}:COUPLING ${config.coupling}`);
		await this._scpiWrite(`${ch}:ATTENUATION ${config.probe}`);

		if (config.offset !== undefined) {
			await this._scpiWrite(`${ch}:OFFSET ${config.offset.toFixed(3)}`);
		}

		// Enable/disable channel trace
		await this._scpiWrite(`${ch}:TRACE ${config.enabled ? 'ON' : 'OFF'}`);
	}

	async configureTrigger(config: IScopeTriggerConfig): Promise<void> {
		this._requireConnected();

		await this._scpiWrite(`TRIGGER_MODE ${config.mode}`);
		await this._scpiWrite(`TRIG_SELECT EDGE,SR,${config.source}`);
		await this._scpiWrite(`${config.source}:TRIG_SLOPE ${config.edge}`);
		await this._scpiWrite(`${config.source}:TRIG_LEVEL ${config.level.toFixed(3)}V`);
	}

	async capture(timeoutSec: number = 5): Promise<IScopeCapture> {
		this._requireConnected();

		// Single acquisition mode
		await this._scpiWrite('TRIG_MODE SINGLE');
		await this._scpiWrite('*CLS');
		await this._scpiWrite('ARM');

		// Poll INR (internal state register) bit 0 = trigger complete
		const deadline = Date.now() + timeoutSec * 1000;
		let triggered = false;
		while (Date.now() < deadline) {
			await new Promise(r => setTimeout(r, 200));
			const inr = await this._scpiQuery('INR?');
			if ((parseInt(inr) & 0x01) !== 0) {
				triggered = true;
				break;
			}
		}

		if (!triggered) {
			throw new Error(
				`Scope trigger timeout after ${timeoutSec}s. ` +
				`Check trigger level (signal may not cross threshold) and trigger mode. ` +
				`Use fw_scope_scpi(":TRIG_MODE AUTO") to force a capture.`,
			);
		}

		// Read waveforms from enabled channels
		const waveforms: IScopeWaveform[] = [];
		for (const ch of [1, 2, 3, 4]) {
			try {
				const traceResp = await this._scpiQuery(`C${ch}:TRACE?`);
				if (!traceResp.toUpperCase().includes('ON')) { continue; }

				const wf = await this._readWaveform(ch);
				if (wf) { waveforms.push(wf); }
			} catch {
				// channel not available or not enabled
			}
		}

		const captureId = `scope_${++this._captureSeq}_${Date.now()}`;
		const timebase = parseFloat(await this._scpiQuery('TIME_DIV?') || '0.001');

		const capture: IScopeCapture = {
			captureId,
			channels: waveforms,
			timebase,
			triggerPoint: 0.5,
			capturedAt: Date.now(),
		};

		this._onCapture.fire(capture);
		return capture;
	}

	async measure(params: string[], channel: number): Promise<IScopeMeasurement[]> {
		this._requireConnected();
		const measurements: IScopeMeasurement[] = [];

		for (const param of params) {
			try {
				// Siglent: C1:PAVA? FREQ
				const resp = await this._scpiQuery(`C${channel}:PAVA? ${param}`);

				// Response format: "C1:PAVA FREQ,1.000kHz" or "FREQ,1.000E+03"
				const valueMatch = resp.match(/([0-9.eE+\-]+)\s*([a-zA-Z]*)/);
				if (valueMatch) {
					const rawVal = parseFloat(valueMatch[1]);
					const unit = this._paramUnit(param, valueMatch[2]);
					const multiplier = this._siMultiplier(valueMatch[2]);

					measurements.push({
						parameter: param,
						channel,
						value: rawVal * multiplier,
						unit,
					});
				}
			} catch {
				// measurement not available
			}
		}

		return measurements;
	}

	async screenshot(path: string): Promise<void> {
		this._requireConnected();

		// Siglent SCDP command returns BMP data
		await this._scpiWrite('SCDP');
		await new Promise(r => setTimeout(r, 500));

		const data = await this._scpiQueryBinary('SCDP');

		const fs = (globalThis as Record<string, unknown>)['require']
			? ((globalThis as Record<string, unknown>)['require']('fs') as typeof import('fs'))
			: null;

		if (!fs) {
			throw new Error('Screenshot requires Node.js environment.');
		}

		fs.writeFileSync(path, data);
	}

	async railCheck(
		channel: number,
		nominalV: number,
		droopThreshold: number,
	): Promise<{ minV: number; droopMs: number; triggered: boolean }> {
		this._requireConnected();

		// Configure channel for rail measurement
		await this.configureChannel({
			channel: channel as 1 | 2 | 3 | 4,
			vDiv: nominalV / 4,
			coupling: 'DC',
			probe: 1,
			enabled: true,
			offset: nominalV / 2,
		});

		// Trigger on falling edge below droop threshold
		await this.configureTrigger({
			source: `C${channel}`,
			edge: 'NEG',
			level: droopThreshold,
			mode: 'SING',
		});

		let triggered = false;
		let capture: IScopeCapture | null = null;

		try {
			capture = await this.capture(5);
			triggered = true;
		} catch {
			// No droop detected within timeout — that is good
		}

		if (!triggered || !capture || capture.channels.length === 0) {
			return { minV: nominalV, droopMs: 0, triggered: false };
		}

		const wf = capture.channels[0];
		const minV = Math.min(...wf.voltages);
		const belowThreshold = wf.voltages.filter(v => v < droopThreshold);
		const droopMs = (belowThreshold.length / wf.sampleRate) * 1000;

		return { minV, droopMs, triggered: true };
	}

	async sendSCPI(command: string): Promise<string> {
		this._requireConnected();
		if (command.endsWith('?')) {
			return this._scpiQuery(command);
		}
		await this._scpiWrite(command);
		return 'OK';
	}

	// ─── Waveform reader ──────────────────────────────────────────────────────

	private async _readWaveform(channel: number): Promise<IScopeWaveform | null> {
		// Request waveform data in binary format
		await this._scpiWrite(`C${channel}:WAVEFORM? DAT2`);
		const resp = await this._scpiQuery(`C${channel}:WAVEFORM? DESC`);

		// Parse preamble descriptor (comma-separated)
		const preamble = resp.split(',');
		if (preamble.length < WAVEFORM_PREAMBLE_FIELDS) { return null; }

		const vDiv = parseFloat(preamble[0] ?? '1');
		const vOffset = parseFloat(preamble[1] ?? '0');
		const timeDiv = parseFloat(preamble[2] ?? '0.001');
		const sampleRate = parseFloat(preamble[3] ?? '1e6');
		const nSamples = parseInt(preamble[4] ?? '1000');

		// Request raw ADC data
		const rawResp = await this._scpiQuery(`C${channel}:WAVEFORM? DAT2`);
		const rawBytes = Buffer.from(rawResp, 'binary');

		// Convert ADC codes to voltage: V = (code - 128) / 25 * vDiv + vOffset
		const voltages: number[] = [];
		const startIdx = rawBytes[1] === 35 ? 2 + parseInt(rawBytes.subarray(2, 3).toString()) : 0;
		for (let i = startIdx; i < Math.min(rawBytes.length, startIdx + nSamples); i++) {
			const code = rawBytes[i] !== undefined ? rawBytes[i]! : 128;
			voltages.push((code - 128) / 25 * vDiv + vOffset);
		}

		return {
			channel,
			voltages,
			timebase: timeDiv,
			sampleRate,
			triggerOffset: timeDiv * 5,
			vDiv,
			vOffset,
		};
	}

	// ─── SCPI transport ───────────────────────────────────────────────────────

	private async _scpiWrite(command: string): Promise<void> {
		await this._scpiSend(command + '\n');
	}

	private async _scpiQuery(command: string): Promise<string> {
		const resp = await this._scpiSend(command + '\n', true);
		return resp.replace(/\r?\n$/, '');
	}

	private async _scpiQueryBinary(command: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const net = (globalThis as Record<string, unknown>)['require']
				? ((globalThis as Record<string, unknown>)['require']('net') as typeof import('net'))
				: null;

			if (!net || !this._host) {
				reject(new Error('SCPI requires Node.js environment and active connection.'));
				return;
			}

			const socket = net.createConnection({ host: this._host, port: SCPI_PORT });
			const chunks: Buffer[] = [];

			socket.on('connect', () => socket.write(command + '\n'));
			socket.on('data', (d: Buffer) => chunks.push(d));
			socket.on('end', () => resolve(Buffer.concat(chunks)));
			socket.on('error', (e: Error) => reject(e));
			socket.setTimeout(SCPI_TIMEOUT_MS, () => { socket.destroy(); resolve(Buffer.concat(chunks)); });
		});
	}

	private async _scpiSend(command: string, expectResponse = false): Promise<string> {
		return new Promise((resolve, reject) => {
			const net = (globalThis as Record<string, unknown>)['require']
				? ((globalThis as Record<string, unknown>)['require']('net') as typeof import('net'))
				: null;

			if (!net || !this._host) {
				reject(new Error('SCPI requires Node.js environment and active connection. Call fw_scope_discover first.'));
				return;
			}

			const socket = net.createConnection({ host: this._host, port: SCPI_PORT });
			let response = '';

			socket.on('connect', () => socket.write(command));
			socket.on('data', (d: Buffer) => { response += d.toString(); });

			if (expectResponse) {
				socket.setTimeout(SCPI_TIMEOUT_MS, () => { socket.destroy(); resolve(response.trim()); });
				socket.on('end', () => resolve(response.trim()));
			} else {
				socket.setTimeout(1000, () => { socket.destroy(); resolve(''); });
				socket.on('end', () => resolve(''));
			}

			socket.on('error', (e: Error) => reject(new Error(`SCPI error: ${e.message}. Verify scope IP and port 5025 is open.`)));
		});
	}

	private _requireConnected(): void {
		if (!this._status.connected || !this._host) {
			throw new Error(
				'No oscilloscope connected. Run fw_scope_discover to find scopes on LAN, ' +
				'or set VOID_SCOPE_HOST=<ip> environment variable.',
			);
		}
	}

	private _paramUnit(param: string, siSuffix: string): string {
		const units: Record<string, string> = {
			FREQ: 'Hz', RISE: 's', FALL: 's', PKPK: 'V', MEAN: 'V',
			RMS: 'V', DUTY: '%', PERIOD: 's', WIDTH: 's', DELAY: 's',
		};
		return units[param.toUpperCase()] ?? siSuffix ?? '';
	}

	private _siMultiplier(suffix: string): number {
		const map: Record<string, number> = {
			'k': 1e3, 'K': 1e3, 'M': 1e6, 'G': 1e9,
			'm': 1e-3, 'u': 1e-6, 'n': 1e-9, 'p': 1e-12,
		};
		return map[suffix] ?? 1;
	}

	private async _runPython(script: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const cp = (globalThis as Record<string, unknown>)['require']
				? ((globalThis as Record<string, unknown>)['require']('child_process') as typeof import('child_process'))
				: null;
			if (!cp) { reject(new Error('Requires Node.js.')); return; }

			const proc = cp.spawn('python3', ['-c', script], { timeout: 10000 });
			let out = '';
			let err = '';
			proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
			proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
			proc.on('close', (code: number) => {
				if (code !== 0) { reject(new Error(err.trim() || out.trim())); }
				else { resolve(out.trim()); }
			});
			proc.on('error', (e: Error) => reject(e));
		});
	}
}


registerSingleton(IOscilloscopeService, OscilloscopeServiceImpl, InstantiationType.Delayed);
