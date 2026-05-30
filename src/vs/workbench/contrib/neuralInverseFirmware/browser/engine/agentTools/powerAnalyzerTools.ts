/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPowerAnalyzerService } from '../instruments/powerAnalyzer/powerAnalyzerService.js';
import { IPowerConfig, IPowerResult } from '../instruments/powerAnalyzer/powerAnalyzerTypes.js';


export function buildPowerAnalyzerTools(
	session: IFirmwareSessionService,
	pa: IPowerAnalyzerService,
): IVoidInternalTool[] {
	return [
		_fwPaStatus(pa),
		_fwPaMeasure(session, pa),
		_fwPaProfileBoot(session, pa),
		_fwPaTrigger(session, pa),
		_fwPaSetVoltage(pa),
		_fwPaRecord(session, pa),
	];
}


function _fwPaStatus(pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_status',
		description: 'Detect connected power analyzer (Nordic PPK2 or Joulescope JS110/JS220). Returns device type, connection status, and wiring instructions for the detected device.',
		params: {},
		execute: async () => {
			const status = await pa.detect();

			if (!status.connected) {
				return [
					`Power Analyzer: NOT DETECTED`,
					``,
					`Connect one of:`,
					`  Nordic PPK2 (USB VID:1915 PID:C00A)`,
					`    Install: pip install ppk2-api`,
					`    Wiring (source mode): VOUT+ -> DUT VDD, GND -> DUT GND, remove nRF DK "nRF CURRENT" jumper`,
					`    Wiring (ampere mode): bench supply -> (IN+,IN-), scope inline with DUT`,
					``,
					`  Joulescope JS110 (USB VID:16D0 PID:0E88)`,
					`    Install: pip install joulescope`,
					`    Wiring: bench supply(+) -> IN+, bench supply(-) -> IN-, OUT+ -> DUT VCC, OUT- -> DUT GND`,
					``,
					`  Joulescope JS220 (USB VID:16D0 PID:112B) — includes GPI0-3 trigger inputs`,
					`    Install: pip install joulescope`,
					`    2-wire: tie I+ and V+ to bench(+), I- -> DUT VCC, V- -> DUT GND and bench(-)`,
					status.error ? `\nError: ${status.error}` : '',
				].filter(Boolean).join('\n');
			}

			const lines = [
				`Power Analyzer: ${status.device.toUpperCase()} (connected)`,
			];
			if (status.firmwareVersion) { lines.push(`Firmware: ${status.firmwareVersion}`); }
			if (status.calibrated !== undefined) { lines.push(`Calibrated: ${status.calibrated ? 'yes' : 'no'}`); }

			lines.push('');
			lines.push('Capabilities:');
			if (status.device === 'ppk2') {
				lines.push('  Source meter: yes (800-5000 mV output)');
				lines.push('  Ampere meter: yes (inline)');
				lines.push('  Sample rate: 100 kHz');
				lines.push('  GPIO trigger: no (use fw_pa_measure with timing)');
			} else if (status.device === 'js110') {
				lines.push('  Source meter: no (pass-through only)');
				lines.push('  Ampere meter: yes');
				lines.push('  Sample rate: up to 1 MS/s');
				lines.push('  GPIO trigger: no');
			} else if (status.device === 'js220') {
				lines.push('  Source meter: no (pass-through only)');
				lines.push('  Ampere meter: yes');
				lines.push('  Sample rate: up to 2 MS/s');
				lines.push('  GPIO trigger: yes — GPI0-GPI3 inputs for fw_pa_trigger');
				lines.push('  UART decode: yes (hardware, on GPI1)');
			}

			lines.push('');
			lines.push('Next steps:');
			lines.push('  fw_pa_measure({ durationSec: 5 })  — measure current for 5 seconds');
			lines.push('  fw_pa_profile_boot({ durationSec: 3 })  — boot current profile');
			if (status.device === 'js220') {
				lines.push('  fw_pa_trigger({ gpiPin: 0, edge: "rising", windowSec: 2 })  — trigger on GPIO edge');
			}

			return lines.join('\n');
		},
	};
}


function _fwPaMeasure(session: IFirmwareSessionService, pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_measure',
		description: 'Measure DUT current and voltage for a specified duration. Returns average, min, max, peak current in microamps, energy in microjoules, and charge in microcoulombs. Use device="ppk2" with mode="source" to also power the DUT.',
		params: {
			durationSec: { description: 'Measurement duration in seconds. Default: 5.' },
			device: { description: 'Device override: "ppk2", "js110", "js220". Auto-detected if omitted.' },
			mode: { description: 'Measurement mode: "source" (PPK2 powers DUT) or "ampere" (inline). Default: "ampere".' },
			voltageV: { description: 'DUT supply voltage in V (source mode only). Default: 3.3.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 5;
			const status = pa.getStatus();

			const config: IPowerConfig = {
				device: (args.device as IPowerConfig['device']) ?? status.device,
				mode: args.mode === 'source' ? 'source' : 'ampere',
				voltageV: typeof args.voltageV === 'number' ? args.voltageV : 3.3,
			};

			const result = await pa.measure(config, durationSec);
			return _formatPowerResult(result, durationSec);
		},
	};
}


function _fwPaProfileBoot(session: IFirmwareSessionService, pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_profile_boot',
		description: 'Profile the first N seconds of device boot. Resets the DUT via power cycle (PPK2 source mode), begins sampling immediately, and returns the current profile for the boot sequence. Shows where current spikes occur during initialization.',
		params: {
			durationSec: { description: 'Profile duration from power-on (seconds). Default: 3.' },
			voltageV: { description: 'DUT supply voltage in V. Default: 3.3. Requires PPK2 in source mode.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 3;
			const voltageV = typeof args.voltageV === 'number' ? args.voltageV : 3.3;
			const status = pa.getStatus();

			if (status.device === 'none') {
				return [
					'Boot profiling requires a connected power analyzer.',
					'Connect Nordic PPK2 for DUT power control (source mode), or Joulescope (ampere mode with external supply + relay).',
				].join('\n');
			}

			const config: IPowerConfig = {
				device: status.device,
				mode: status.device === 'ppk2' ? 'source' : 'ampere',
				voltageV,
			};

			// For PPK2: power cycle DUT by toggling output off then on before measuring
			if (status.device === 'ppk2') {
				await pa.setSourceVoltage(Math.round(voltageV * 1000));
			}

			const result = await pa.measure(config, durationSec);

			const lines = [
				`Boot Profile: ${s.mcuConfig?.family ?? 'MCU'} ${s.mcuConfig?.variant ?? ''}`,
				`Duration: ${durationSec}s | Supply: ${voltageV}V`,
				``,
				`Current profile:`,
				`  Average: ${_formatUa(result.avgUa)}`,
				`  Peak:    ${_formatUa(result.peakUa)}`,
				`  Min:     ${_formatUa(result.minUa)}`,
				``,
				_asciiBar(result),
				``,
				`Energy consumed: ${_formatUJ(result.energyUJ)}`,
				`Charge:          ${result.chargeUC.toFixed(1)} µC`,
				`Samples:         ${result.sampleCount.toLocaleString()} at ${(result.sampleCount / durationSec / 1000).toFixed(0)} kHz`,
			];

			if (result.peakUa > result.avgUa * 10) {
				lines.push('');
				lines.push(`[!] Peak is ${(result.peakUa / result.avgUa).toFixed(0)}x average — significant current spikes during boot.`);
				lines.push(`    Common causes: clock initialization, RF radio startup, flash erase on first boot.`);
			}

			return lines.join('\n');
		},
	};
}


function _fwPaTrigger(session: IFirmwareSessionService, pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_trigger',
		description: 'Arm a GPIO trigger on a Joulescope JS220 GPI input (GPI0-GPI3), wait for an edge, then capture a power measurement window. Useful for measuring sleep current windows that are firmware-gated by a GPIO signal.',
		params: {
			gpiPin: { description: 'GPI pin number on Joulescope JS220: 0, 1, 2, or 3.' },
			edge: { description: 'Trigger edge: "rising" (sleep entry) or "falling" (wake). Default: "falling".' },
			windowSec: { description: 'Measurement window duration after trigger (seconds). Default: 2.' },
			timeoutSec: { description: 'Max time to wait for trigger (seconds). Default: 30.' },
			voltageV: { description: 'Expected DUT voltage for energy calculation. Default: 3.3.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const gpiPin = [0, 1, 2, 3].includes(Number(args.gpiPin)) ? (Number(args.gpiPin) as 0|1|2|3) : 0;
			const edge = args.edge === 'rising' ? 'rising' : 'falling';
			const windowSec = typeof args.windowSec === 'number' ? args.windowSec : 2;
			const timeoutSec = typeof args.timeoutSec === 'number' ? args.timeoutSec : 30;
			const voltageV = typeof args.voltageV === 'number' ? args.voltageV : 3.3;

			const status = pa.getStatus();
			if (status.device !== 'js220') {
				return [
					`GPIO trigger capture requires Joulescope JS220 (has GPI0-3 inputs).`,
					`Connected device: ${status.device === 'none' ? 'none' : status.device}.`,
					``,
					`Alternative: Use fw_pa_measure with timing for PPK2 measurements.`,
				].join('\n');
			}

			const config: IPowerConfig = {
				device: 'js220',
				mode: 'ampere',
				voltageV,
			};

			const result = await pa.triggerCapture({ gpiPin, edge, timeoutSec }, config, windowSec);

			return [
				`Triggered capture complete (GPI${gpiPin} ${edge} edge)`,
				`Window: ${windowSec}s`,
				``,
				_formatPowerResult(result, windowSec),
			].join('\n');
		},
	};
}


function _fwPaSetVoltage(pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_set_voltage',
		description: 'Set the DUT supply voltage on a Nordic PPK2 in source meter mode. Range: 800-5000 mV. Use to test DUT behavior at different voltages (e.g. brown-out threshold testing).',
		params: {
			mV: { description: 'Supply voltage in millivolts (800-5000). E.g. 3300 for 3.3V, 1800 for 1.8V.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const mV = typeof args.mV === 'number' ? args.mV : 3300;

			if (mV < 800 || mV > 5000) {
				return `Voltage ${mV} mV out of PPK2 range. Valid range: 800-5000 mV (0.8V-5.0V).`;
			}

			await pa.setSourceVoltage(mV);

			return [
				`PPK2 source voltage set to ${mV} mV (${(mV / 1000).toFixed(3)} V).`,
				``,
				`Now run fw_pa_measure to measure current at this voltage.`,
				`Useful tests:`,
				`  3300 mV — normal 3.3V operation`,
				`  1800 mV — test 1.8V compatibility`,
				`  2700 mV — near typical brown-out threshold`,
				`  800 mV  — near minimum operating voltage`,
			].join('\n');
		},
	};
}


function _fwPaRecord(session: IFirmwareSessionService, pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_pa_record',
		description: 'Stream a long power capture to disk as a JLS file (Joulescope) or CSV (PPK2). For captures exceeding 60 seconds where keeping all samples in memory is impractical. File saved to .inverse/captures/.',
		params: {
			durationSec: { description: 'Total capture duration in seconds.' },
			voltageV: { description: 'DUT voltage for energy calculation. Default: 3.3.' },
			filename: { description: 'Output filename (without extension). Default: timestamp-based name.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 60;
			const voltageV = typeof args.voltageV === 'number' ? args.voltageV : 3.3;
			const status = pa.getStatus();

			if (status.device === 'none') {
				return 'No power analyzer connected. Run fw_pa_status for connection instructions.';
			}

			const ts = Date.now();
			const baseName = typeof args.filename === 'string' ? args.filename : `capture_${ts}`;
			const ext = status.device === 'js220' || status.device === 'js110' ? '.jls' : '.csv';
			const path = `.inverse/captures/${baseName}${ext}`;

			const config: IPowerConfig = {
				device: status.device,
				mode: 'ampere',
				voltageV,
			};

			await pa.streamToFile(path, config, durationSec);

			return [
				`Recording complete: ${path}`,
				`Device: ${status.device.toUpperCase()} | Duration: ${durationSec}s | Supply: ${voltageV}V`,
				``,
				ext === '.jls'
					? `JLS file can be opened in Joulescope UI for visual analysis and annotation.`
					: `CSV columns: timestamp_ms, current_ua`,
			].join('\n');
		},
	};
}


// ─── Formatting helpers ───────────────────────────────────────────────────────

function _formatPowerResult(result: IPowerResult, durationSec: number): string {
	const lines = [
		`Current Measurement (${durationSec}s):`,
		`  Average: ${_formatUa(result.avgUa)}`,
		`  Min:     ${_formatUa(result.minUa)}`,
		`  Max:     ${_formatUa(result.maxUa)}`,
		`  Peak:    ${_formatUa(result.peakUa)}`,
		``,
		`  Energy:  ${_formatUJ(result.energyUJ)}`,
		`  Charge:  ${result.chargeUC.toFixed(1)} µC`,
		`  Voltage: ${result.voltageV.toFixed(3)} V`,
		`  Samples: ${result.sampleCount.toLocaleString()}`,
		``,
		_asciiBar(result),
	];
	return lines.join('\n');
}

function _formatUa(ua: number): string {
	if (ua >= 1e6) { return `${(ua / 1e6).toFixed(3)} A`; }
	if (ua >= 1e3) { return `${(ua / 1e3).toFixed(2)} mA`; }
	return `${ua.toFixed(1)} µA`;
}

function _formatUJ(uj: number): string {
	if (uj >= 1e6) { return `${(uj / 1e6).toFixed(3)} J`; }
	if (uj >= 1e3) { return `${(uj / 1e3).toFixed(3)} mJ`; }
	return `${uj.toFixed(1)} µJ`;
}

function _asciiBar(result: IPowerResult): string {
	// ASCII bar chart showing avg vs min/max range
	const range = result.maxUa - result.minUa;
	if (range <= 0) { return `  [${_formatUa(result.avgUa)}]`; }

	const width = 40;
	const avgPos = Math.round(((result.avgUa - result.minUa) / range) * width);
	const bar = Array(width + 1).fill('─');
	bar[0] = '|';
	bar[width] = '|';
	if (avgPos >= 0 && avgPos <= width) { bar[avgPos] = 'A'; }

	return [
		`  min${' '.repeat(Math.floor(width / 2) - 2)}avg${' '.repeat(Math.ceil(width / 2) - 2)}max`,
		`  ${bar.join('')}`,
		`  ${_formatUa(result.minUa).padEnd(Math.floor(width / 2) + 1)}${_formatUa(result.avgUa).padEnd(Math.ceil(width / 2) - 2)}${_formatUa(result.maxUa)}`,
	].join('\n');
}
