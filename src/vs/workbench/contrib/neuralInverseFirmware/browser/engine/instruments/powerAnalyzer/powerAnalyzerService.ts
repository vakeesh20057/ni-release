/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Power Analyzer Service
 *
 * Measures DUT current, voltage, and energy using:
 *   - Nordic PPK2 (Power Profiler Kit 2): USB VID:PID 1915:C00A
 *     Source meter mode (PPK2 supplies DUT) or ampere meter mode (inline measurement).
 *     API via ppk2-api Python package or ppk2_api npm package.
 *   - Joulescope JS110 / JS220: USB VID:PID 16D0:0E88 (JS110), 16D0:112B (JS220)
 *     Pass-through only (JS110/JS220 do not power DUT in source mode).
 *     JS220 supports GPIO trigger inputs (GPI0-3) for firmware-gated capture windows.
 *
 * Both backends drive Python subprocess scripts for hardware access.
 * Results are returned as IPowerResult with full statistics.
 */

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';
import {
	PowerAnalyzerDevice, IPowerConfig, IPowerSample,
	IPowerResult, IPowerTrigger, IPowerAnalyzerStatus, IPowerSession,
} from './powerAnalyzerTypes.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const IPowerAnalyzerService = createDecorator<IPowerAnalyzerService>('powerAnalyzerService');

export interface IPowerAnalyzerService {
	readonly _serviceBrand: undefined;

	readonly onMeasurementComplete: Event<IPowerResult>;
	readonly onSampleBatch: Event<IPowerSample[]>;
	readonly onError: Event<string>;

	/** Detect connected power analyzer device. */
	detect(): Promise<IPowerAnalyzerStatus>;

	/** Get current status. */
	getStatus(): IPowerAnalyzerStatus;

	/** Begin measurement. Returns sessionId. */
	startMeasurement(config: IPowerConfig): Promise<string>;

	/** Stop measurement and return statistics. */
	stopMeasurement(sessionId: string): Promise<IPowerResult>;

	/** Single measurement for durationSec. Convenience wrapper for start+stop. */
	measure(config: IPowerConfig, durationSec: number): Promise<IPowerResult>;

	/** Arm GPIO trigger, wait for edge, capture window. */
	triggerCapture(trigger: IPowerTrigger, config: IPowerConfig, windowSec: number): Promise<IPowerResult>;

	/** Set DUT supply voltage (PPK2 source mode only). Range: 800-5000 mV. */
	setSourceVoltage(mV: number): Promise<void>;

	/** Stream long capture to JLS file (Joulescope) or CSV (PPK2). */
	streamToFile(path: string, config: IPowerConfig, durationSec: number): Promise<void>;

	/** List active measurement sessions. */
	getActiveSessions(): IPowerSession[];
}


// ─── USB VID:PID detection patterns ──────────────────────────────────────────

const PPK2_VID = '1915';
const PPK2_PID = 'C00A';
const JS110_VID = '16D0';
const JS110_PID = '0E88';
const JS220_VID = '16D0';
const JS220_PID = '112B';


// ─── Implementation ───────────────────────────────────────────────────────────

class PowerAnalyzerServiceImpl extends Disposable implements IPowerAnalyzerService {
	readonly _serviceBrand: undefined;

	private readonly _onMeasurementComplete = this._register(new Emitter<IPowerResult>());
	readonly onMeasurementComplete: Event<IPowerResult> = this._onMeasurementComplete.event;

	private readonly _onSampleBatch = this._register(new Emitter<IPowerSample[]>());
	readonly onSampleBatch: Event<IPowerSample[]> = this._onSampleBatch.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private _status: IPowerAnalyzerStatus = { device: 'none', connected: false };
	private _sessions: Map<string, IPowerSession> = new Map();
	private _detected = false;

	async detect(): Promise<IPowerAnalyzerStatus> {
		this._status = await this._detectDevice();
		this._detected = true;
		return this._status;
	}

	getStatus(): IPowerAnalyzerStatus {
		return this._status;
	}

	async startMeasurement(config: IPowerConfig): Promise<string> {
		if (!this._detected) { await this.detect(); }
		if (this._status.device === 'none') {
			throw new Error(this._noDeviceError());
		}

		const sessionId = `pa_${Date.now()}`;
		this._sessions.set(sessionId, { sessionId, config, startedAt: Date.now(), running: true });
		return sessionId;
	}

	async stopMeasurement(sessionId: string): Promise<IPowerResult> {
		const session = this._sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found.`);
		}
		session.running = false;
		const durationSec = (Date.now() - session.startedAt) / 1000;
		return this.measure(session.config, durationSec);
	}

	async measure(config: IPowerConfig, durationSec: number): Promise<IPowerResult> {
		if (!this._detected) { await this.detect(); }
		if (this._status.device === 'none') {
			throw new Error(this._noDeviceError());
		}

		if (this._status.device === 'ppk2') {
			return this._measurePPK2(config, durationSec);
		}
		return this._measureJoulescope(config, durationSec, this._status.device);
	}

	async triggerCapture(trigger: IPowerTrigger, config: IPowerConfig, windowSec: number): Promise<IPowerResult> {
		if (!this._detected) { await this.detect(); }
		if (this._status.device === 'none') {
			throw new Error(this._noDeviceError());
		}

		if (this._status.device !== 'js220') {
			throw new Error(
				`GPIO trigger capture requires Joulescope JS220 (has GPI0-3 inputs). ` +
				`Connected device: ${this._status.device}. ` +
				`For PPK2, use fw_pa_measure with manual timing instead.`,
			);
		}

		return this._triggerJoulescope(trigger, config, windowSec);
	}

	async setSourceVoltage(mV: number): Promise<void> {
		if (!this._detected) { await this.detect(); }
		if (this._status.device !== 'ppk2') {
			throw new Error(
				`setSourceVoltage is only supported by Nordic PPK2 in source meter mode. ` +
				`Connected device: ${this._status.device}.`,
			);
		}
		if (mV < 800 || mV > 5000) {
			throw new Error(`Voltage ${mV} mV out of PPK2 range (800-5000 mV).`);
		}

		await this._runPython(`
import ppk2_api.ppk2_api as ppk2
devices = ppk2.PPK2_API.list_devices()
if not devices:
    raise RuntimeError("PPK2 not found")
dev = ppk2.PPK2_API(devices[0])
dev.get_modifiers()
dev.set_source_voltage(${mV})
dev.toggle_DUT_power(ppk2.PPK2_API.SourceCurrent.SOURCE_VOLTAGE)
dev.close_device()
print("voltage_set")
`);
	}

	async streamToFile(path: string, config: IPowerConfig, durationSec: number): Promise<void> {
		if (!this._detected) { await this.detect(); }

		if (this._status.device === 'js220') {
			await this._streamJLS(path, config, durationSec);
		} else {
			await this._streamCSV(path, config, durationSec);
		}
	}

	getActiveSessions(): IPowerSession[] {
		return Array.from(this._sessions.values()).filter(s => s.running);
	}

	// ─── Device detection ─────────────────────────────────────────────────────

	private async _detectDevice(): Promise<IPowerAnalyzerStatus> {
		// Check USB devices via Python for cross-platform compatibility
		const script = `
import sys
try:
    import usb.core
    devices = usb.core.find(find_all=True)
    found = []
    for d in devices:
        vid = format(d.idVendor, '04X')
        pid = format(d.idProduct, '04X')
        found.append(f"{vid}:{pid}")
    print(','.join(found))
except ImportError:
    # Try platform-specific detection
    import subprocess
    try:
        out = subprocess.check_output(['python3', '-c', 'import ppk2_api.ppk2_api as p; print(p.PPK2_API.list_devices())'], timeout=5).decode()
        print(out)
    except Exception as e:
        print(f"error:{e}")
`;
		try {
			const output = await this._runPython(script);
			if (output.includes(`${PPK2_VID}:${PPK2_PID}`)) {
				return { device: 'ppk2', connected: true, calibrated: true };
			}
			if (output.includes(`${JS220_VID}:${JS220_PID}`)) {
				return { device: 'js220', connected: true };
			}
			if (output.includes(`${JS110_VID}:${JS110_PID}`)) {
				return { device: 'js110', connected: true };
			}
		} catch {
			// Detection failed — try ppk2_api directly
			try {
				const ppkOut = await this._runPython(
					`from ppk2_api.ppk2_api import PPK2_API; print(PPK2_API.list_devices())`,
				);
				if (ppkOut.includes('/dev/') || ppkOut.includes('COM')) {
					return { device: 'ppk2', connected: true };
				}
			} catch {
				// no device
			}
		}

		return {
			device: 'none',
			connected: false,
			error: 'No power analyzer found. Connect a Nordic PPK2 (USB VID:1915) or Joulescope JS110/JS220 (USB VID:16D0).',
		};
	}

	// ─── PPK2 measurement ─────────────────────────────────────────────────────

	private async _measurePPK2(config: IPowerConfig, durationSec: number): Promise<IPowerResult> {
		const isSource = config.mode === 'source';
		const voltageStr = isSource && config.voltageV ? `${Math.round(config.voltageV * 1000)}` : '3300';

		const script = `
import ppk2_api.ppk2_api as ppk2
import time, json, statistics

devices = ppk2.PPK2_API.list_devices()
if not devices:
    print(json.dumps({"error": "PPK2 not found"}))
    exit(1)

dev = ppk2.PPK2_API(devices[0])
dev.get_modifiers()

if ${isSource ? 1 : 0}:
    dev.set_source_voltage(${voltageStr})
    dev.toggle_DUT_power(ppk2.PPK2_API.SourceCurrent.SOURCE_VOLTAGE)
else:
    dev.toggle_DUT_power(ppk2.PPK2_API.SourceCurrent.AMPERE_MODE)

samples_ua = []
v_samples = []
start = time.time()

while time.time() - start < ${durationSec}:
    read_data, raw_digital = dev.get_data()
    if read_data:
        samples_ua.extend([int(s) for s in read_data])

dev.toggle_DUT_power(ppk2.PPK2_API.SourceCurrent.OFF)
dev.close_device()

if not samples_ua:
    print(json.dumps({"error": "No samples collected"}))
    exit(1)

avg_ua = sum(samples_ua) / len(samples_ua)
result = {
    "avgUa": avg_ua,
    "minUa": min(samples_ua),
    "maxUa": max(samples_ua),
    "peakUa": max(samples_ua),
    "chargeUC": sum(samples_ua) / len(samples_ua) * ${durationSec},
    "energyUJ": sum(samples_ua) / len(samples_ua) * ${durationSec} * ${config.voltageV ?? 3.3},
    "voltageV": ${config.voltageV ?? 3.3},
    "durationMs": ${Math.round(durationSec * 1000)},
    "sampleCount": len(samples_ua)
}
print(json.dumps(result))
`;

		const output = await this._runPython(script);
		let parsed: Record<string, number>;
		try {
			parsed = JSON.parse(output.trim()) as Record<string, number>;
		} catch {
			throw new Error(`PPK2 measurement failed: ${output}`);
		}

		if ((parsed as Record<string, unknown>)['error']) {
			throw new Error(`PPK2 error: ${(parsed as Record<string, unknown>)['error']}`);
		}

		const result: IPowerResult = {
			sessionId: `ppk2_${Date.now()}`,
			avgUa: parsed.avgUa,
			minUa: parsed.minUa,
			maxUa: parsed.maxUa,
			peakUa: parsed.peakUa,
			chargeUC: parsed.chargeUC,
			energyUJ: parsed.energyUJ,
			voltageV: parsed.voltageV,
			durationMs: parsed.durationMs,
			sampleCount: parsed.sampleCount,
		};

		this._onMeasurementComplete.fire(result);
		return result;
	}

	// ─── Joulescope measurement ───────────────────────────────────────────────

	private async _measureJoulescope(
		config: IPowerConfig,
		durationSec: number,
		device: PowerAnalyzerDevice,
	): Promise<IPowerResult> {
		const script = `
import joulescope, time, json, sys

with joulescope.scan_require_one(config='off') as js:
    js.parameter_set('i_range', 'auto')
    js.parameter_set('v_range', '15V')
    data = js.read(contiguous_duration=${durationSec})

i_data = data[:, 0]  # current column in amperes
v_data = data[:, 1]  # voltage column

samples_ua = [float(v) * 1e6 for v in i_data if v == v]  # filter NaN
if not samples_ua:
    print(json.dumps({"error": "No valid samples"}))
    sys.exit(1)

avg_v = float(sum(v_data) / len(v_data))
avg_ua = float(sum(samples_ua) / len(samples_ua))
charge_uc = float(sum(i_data[i_data == i_data]) * (${durationSec} / len(i_data)) * 1e6)
energy_uj = charge_uc * avg_v

print(json.dumps({
    "avgUa": avg_ua,
    "minUa": float(min(samples_ua)),
    "maxUa": float(max(samples_ua)),
    "peakUa": float(max(samples_ua)),
    "chargeUC": charge_uc,
    "energyUJ": energy_uj,
    "voltageV": avg_v,
    "durationMs": ${Math.round(durationSec * 1000)},
    "sampleCount": len(samples_ua)
}))
`;

		const output = await this._runPython(script);
		let parsed: Record<string, number>;
		try {
			parsed = JSON.parse(output.trim()) as Record<string, number>;
		} catch {
			throw new Error(`Joulescope measurement failed: ${output}`);
		}

		if ((parsed as Record<string, unknown>)['error']) {
			throw new Error(`Joulescope error: ${(parsed as Record<string, unknown>)['error']}`);
		}

		const result: IPowerResult = {
			sessionId: `${device}_${Date.now()}`,
			avgUa: parsed.avgUa,
			minUa: parsed.minUa,
			maxUa: parsed.maxUa,
			peakUa: parsed.peakUa,
			chargeUC: parsed.chargeUC,
			energyUJ: parsed.energyUJ,
			voltageV: parsed.voltageV,
			durationMs: parsed.durationMs,
			sampleCount: parsed.sampleCount,
		};

		this._onMeasurementComplete.fire(result);
		return result;
	}

	private async _triggerJoulescope(trigger: IPowerTrigger, config: IPowerConfig, windowSec: number): Promise<IPowerResult> {
		const script = `
import joulescope, time, json, sys

# JS220 GPIO trigger
with joulescope.scan_require_one(config='off') as js:
    js.parameter_set('i_range', 'auto')
    # Configure GPI trigger
    js.parameter_set('trigger_source', f'gpi{${trigger.gpiPin}}')
    js.parameter_set('trigger_edge', '${trigger.edge}')
    # Wait for trigger then capture
    timeout = time.time() + ${trigger.timeoutSec ?? 30}
    triggered = False
    while time.time() < timeout:
        if js.status().get('trigger_fired'):
            triggered = True
            break
        time.sleep(0.01)

    if not triggered:
        print(json.dumps({"error": "Trigger timeout after ${trigger.timeoutSec ?? 30}s"}))
        sys.exit(1)

    data = js.read(contiguous_duration=${windowSec})

i_data = data[:, 0]
v_data = data[:, 1]
samples_ua = [float(v) * 1e6 for v in i_data if v == v]
avg_v = float(sum(v_data) / len(v_data))
avg_ua = float(sum(samples_ua) / len(samples_ua))

print(json.dumps({
    "avgUa": avg_ua,
    "minUa": float(min(samples_ua)),
    "maxUa": float(max(samples_ua)),
    "peakUa": float(max(samples_ua)),
    "chargeUC": float(avg_ua * ${windowSec}),
    "energyUJ": float(avg_ua * ${windowSec} * avg_v),
    "voltageV": avg_v,
    "durationMs": ${Math.round(windowSec * 1000)},
    "sampleCount": len(samples_ua)
}))
`;
		const output = await this._runPython(script);
		const parsed = JSON.parse(output.trim()) as Record<string, number>;
		if ((parsed as Record<string, unknown>)['error']) {
			throw new Error(`Joulescope trigger error: ${(parsed as Record<string, unknown>)['error']}`);
		}

		const result: IPowerResult = {
			sessionId: `js220_trig_${Date.now()}`,
			avgUa: parsed.avgUa, minUa: parsed.minUa, maxUa: parsed.maxUa,
			peakUa: parsed.peakUa, chargeUC: parsed.chargeUC, energyUJ: parsed.energyUJ,
			voltageV: parsed.voltageV, durationMs: parsed.durationMs, sampleCount: parsed.sampleCount,
		};
		this._onMeasurementComplete.fire(result);
		return result;
	}

	private async _streamJLS(path: string, config: IPowerConfig, durationSec: number): Promise<void> {
		await this._runPython(`
import joulescope, time
with joulescope.scan_require_one(config='off') as js:
    js.parameter_set('i_range', 'auto')
    with open('${path.replace(/\\/g, '/')}', 'wb') as f:
        start = time.time()
        for data, idx in js.stream_iter():
            f.write(data.tobytes())
            if time.time() - start > ${durationSec}:
                break
print("stream_complete")
`);
	}

	private async _streamCSV(path: string, config: IPowerConfig, durationSec: number): Promise<void> {
		await this._runPython(`
import ppk2_api.ppk2_api as ppk2, time, csv
devices = ppk2.PPK2_API.list_devices()
dev = ppk2.PPK2_API(devices[0])
dev.get_modifiers()
dev.toggle_DUT_power(ppk2.PPK2_API.SourceCurrent.AMPERE_MODE)
start = time.time()
with open('${path.replace(/\\/g, '/')}', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['timestamp_ms', 'current_ua'])
    while time.time() - start < ${durationSec}:
        samples, _ = dev.get_data()
        if samples:
            t = (time.time() - start) * 1000
            for s in samples:
                w.writerow([f'{t:.2f}', int(s)])
dev.close_device()
print("stream_complete")
`);
	}

	// ─── Python subprocess helper ─────────────────────────────────────────────

	private async _runPython(script: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const cp = (globalThis as Record<string, unknown>)['require']
				? (globalThis as Record<string, unknown>)['require']('child_process') as typeof import('child_process')
				: null;

			if (!cp) {
				reject(new Error('Python subprocess requires VS Code extension host (Node.js environment).'));
				return;
			}

			const proc = cp.spawn('python3', ['-c', script], { timeout: 120000 });
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

	private _noDeviceError(): string {
		return [
			'No power analyzer detected.',
			'Connect one of:',
			'  - Nordic PPK2 (USB VID:1915 PID:C00A) — install: pip install ppk2-api',
			'  - Joulescope JS110 (USB VID:16D0 PID:0E88) — install: pip install joulescope',
			'  - Joulescope JS220 (USB VID:16D0 PID:112B) — install: pip install joulescope',
			'',
			'PPK2 wiring (source mode): VOUT+ -> DUT VDD, GND -> DUT GND',
			'PPK2 wiring (ampere mode): bench supply -> (IN+/IN-), (OUT+/OUT-) -> DUT',
		].join('\n');
	}
}


registerSingleton(IPowerAnalyzerService, PowerAnalyzerServiceImpl, InstantiationType.Delayed);
