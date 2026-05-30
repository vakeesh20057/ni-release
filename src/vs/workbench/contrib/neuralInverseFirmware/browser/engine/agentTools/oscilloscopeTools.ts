/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IOscilloscopeService } from '../instruments/oscilloscope/oscilloscopeService.js';
import { IScopeChannelConfig, IScopeTriggerConfig } from '../instruments/oscilloscope/oscilloscopeTypes.js';


export function buildOscilloscopeTools(
	session: IFirmwareSessionService,
	scope: IOscilloscopeService,
): IVoidInternalTool[] {
	return [
		_fwScopeDiscover(scope),
		_fwScopeCapture(session, scope),
		_fwScopeMeasure(session, scope),
		_fwScopeScreenshot(scope),
		_fwScopeRailCheck(session, scope),
		_fwScopeSCPI(scope),
	];
}


function _fwScopeDiscover(scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_discover',
		description: 'Discover oscilloscopes on the local network via mDNS (LXI/SCPI _lxi._tcp). Also checks VOID_SCOPE_HOST environment variable for manual IP configuration. Primary target: Siglent SDS800X HD. Generic SCPI fallback for other LXI instruments.',
		params: {},
		execute: async () => {
			const scopes = await scope.discover();

			if (scopes.length === 0) {
				return [
					`No oscilloscopes found on LAN.`,
					``,
					`To connect:`,
					`  1. Connect scope to same network as this machine`,
					`  2. Ensure LAN/mDNS is enabled on scope (Network settings > LXI)`,
					`  3. Or set environment variable: VOID_SCOPE_HOST=<scope-ip-address>`,
					`  4. Re-run fw_scope_discover`,
					``,
					`Supported scopes:`,
					`  Siglent SDS800X HD series (SDS802/804/812/814/822/824X HD)`,
					`  Any LXI/SCPI instrument on port 5025 (standard IEEE 488.2)`,
				].join('\n');
			}

			const lines = [`Found ${scopes.length} oscilloscope(s):`];
			for (const s of scopes) {
				lines.push(`  ${s.model} (${s.manufacturer}) @ ${s.host}:${s.port}`);
				lines.push(`    S/N: ${s.serialNumber} | FW: ${s.firmware}`);
			}
			lines.push('');
			lines.push(`Connected to: ${scopes[0]!.host} (${scopes[0]!.model})`);
			lines.push('');
			lines.push('Next steps:');
			lines.push('  fw_scope_capture({ channel:1, vDiv:1.0, triggerEdge:"POS", triggerLevel:1.5 })');
			lines.push('  fw_scope_measure({ params:["FREQ","PKPK","RISE"], channel:1 })');
			lines.push('  fw_scope_rail_check({ channel:1, nominalV:3.3, droopThreshold:2.8 })');

			return lines.join('\n');
		},
	};
}


function _fwScopeCapture(session: IFirmwareSessionService, scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_capture',
		description: 'Arm the oscilloscope trigger and capture a waveform. Configure channels (V/div, coupling, probe), trigger (source, edge, level), and wait for trigger. Returns waveform data with voltage samples and timing.',
		params: {
			channel: { description: 'Primary channel to capture (1-4). Default: 1.' },
			vDiv: { description: 'Volts per division for the channel. Default: 1.0.' },
			coupling: { description: 'Channel coupling: "DC", "AC", or "GND". Default: "DC".' },
			probe: { description: 'Probe attenuation: 1, 10, or 100. Default: 1.' },
			triggerSource: { description: 'Trigger source: "C1"-"C4", "EXT", "LINE". Default: "C1".' },
			triggerEdge: { description: 'Trigger edge: "POS" (rising), "NEG" (falling), "RFAL" (both). Default: "POS".' },
			triggerLevel: { description: 'Trigger level in volts. Default: half of vDiv * 5 range.' },
			triggerMode: { description: 'Trigger mode: "SING" (single), "NORM" (normal), "AUTO". Default: "SING".' },
			timeoutSec: { description: 'Max wait time for trigger (seconds). Default: 5.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const channel = typeof args.channel === 'number' ? (Math.max(1, Math.min(4, args.channel)) as 1|2|3|4) : 1;
			const vDiv = typeof args.vDiv === 'number' ? args.vDiv : 1.0;
			const coupling = ['DC', 'AC', 'GND'].includes(String(args.coupling)) ? String(args.coupling) as 'DC'|'AC'|'GND' : 'DC';
			const probe = [1, 10, 100].includes(Number(args.probe)) ? Number(args.probe) as 1|10|100 : 1;
			const triggerSource = String(args.triggerSource ?? `C${channel}`);
			const triggerEdge = ['POS', 'NEG', 'RFAL'].includes(String(args.triggerEdge)) ? String(args.triggerEdge) as 'POS'|'NEG'|'RFAL' : 'POS';
			const triggerLevel = typeof args.triggerLevel === 'number' ? args.triggerLevel : 0;
			const triggerMode = ['SING', 'NORM', 'AUTO'].includes(String(args.triggerMode)) ? String(args.triggerMode) as 'AUTO'|'NORM'|'SING' : 'SING';
			const timeoutSec = typeof args.timeoutSec === 'number' ? args.timeoutSec : 5;

			const chConfig: IScopeChannelConfig = {
				channel, vDiv, coupling, probe, enabled: true,
			};

			const trigConfig: IScopeTriggerConfig = {
				source: triggerSource,
				edge: triggerEdge,
				level: triggerLevel,
				mode: triggerMode,
			};

			await scope.configureChannel(chConfig);
			await scope.configureTrigger(trigConfig);

			const capture = await scope.capture(timeoutSec);

			if (capture.channels.length === 0) {
				return [
					`Capture complete but no waveform data returned.`,
					`Check that channel ${channel} is physically connected to a signal.`,
				].join('\n');
			}

			const wf = capture.channels.find(c => c.channel === channel) ?? capture.channels[0]!;
			const vMin = Math.min(...wf.voltages);
			const vMax = Math.max(...wf.voltages);
			const vMean = wf.voltages.reduce((a, b) => a + b, 0) / wf.voltages.length;
			const vPkPk = vMax - vMin;

			return [
				`Capture: ${capture.captureId}`,
				`Channel: CH${wf.channel} | ${wf.voltages.length.toLocaleString()} samples @ ${(wf.sampleRate / 1e6).toFixed(1)} MHz`,
				`Timebase: ${_formatTime(wf.timebase)}/div (${_formatTime(wf.timebase * 10)} total)`,
				``,
				`Quick measurements:`,
				`  Pk-Pk:  ${vPkPk.toFixed(3)} V`,
				`  Max:    ${vMax.toFixed(3)} V`,
				`  Min:    ${vMin.toFixed(3)} V`,
				`  Mean:   ${vMean.toFixed(3)} V`,
				``,
				_waveformAscii(wf.voltages, vMin, vMax),
				``,
				`Next steps:`,
				`  fw_scope_measure({ params:["FREQ","RISE","DUTY"], channel:${channel} })`,
				`  fw_scope_screenshot({ path: ".inverse/captures/scope_${Date.now()}.bmp" })`,
			].join('\n');
		},
	};
}


function _fwScopeMeasure(session: IFirmwareSessionService, scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_measure',
		description: 'Run automated measurements on a captured waveform channel. Available parameters: FREQ (frequency), RISE (rise time), FALL (fall time), PKPK (peak-to-peak voltage), MEAN (average voltage), RMS (RMS voltage), DUTY (duty cycle %), PERIOD, WIDTH, DELAY.',
		params: {
			params: { description: 'Array of measurement parameters, e.g. ["FREQ", "RISE", "PKPK", "DUTY"]' },
			channel: { description: 'Channel number to measure (1-4). Default: 1.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const channel = typeof args.channel === 'number' ? args.channel : 1;
			let params: string[];
			if (Array.isArray(args.params)) {
				params = args.params.map(p => String(p).toUpperCase());
			} else {
				params = ['FREQ', 'PKPK', 'RISE', 'FALL', 'DUTY', 'MEAN'];
			}

			const measurements = await scope.measure(params, channel);

			if (measurements.length === 0) {
				return [
					`No measurements returned for CH${channel}.`,
					`Ensure a capture has been taken (fw_scope_capture) and the channel has signal.`,
				].join('\n');
			}

			const lines = [`Measurements on CH${channel}:`];
			for (const m of measurements) {
				const val = _formatMeasValue(m.parameter, m.value, m.unit);
				lines.push(`  ${m.parameter.padEnd(10)} ${val}`);
			}

			return lines.join('\n');
		},
	};
}


function _fwScopeScreenshot(scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_screenshot',
		description: 'Save a BMP screenshot of the current oscilloscope screen. Useful for capturing waveforms with annotations for documentation or sharing.',
		params: {
			path: { description: 'Output file path for BMP screenshot. Default: .inverse/captures/scope_<timestamp>.bmp' },
		},
		execute: async (args: Record<string, unknown>) => {
			const path = typeof args.path === 'string' ? args.path : `.inverse/captures/scope_${Date.now()}.bmp`;

			await scope.screenshot(path);

			return [
				`Screenshot saved: ${path}`,
				`File format: BMP (Windows bitmap, uncompressed).`,
				`To convert: convert ${path} ${path.replace('.bmp', '.png')}  (ImageMagick)`,
			].join('\n');
		},
	};
}


function _fwScopeRailCheck(session: IFirmwareSessionService, scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_rail_check',
		description: 'Check a power rail for voltage droop. Configures the scope to trigger on a voltage falling edge below the droop threshold, then reports minimum voltage and droop duration. Use to diagnose brown-out resets caused by insufficient capacitance or poor PCB layout.',
		params: {
			channel: { description: 'Oscilloscope channel connected to the power rail. Default: 1.' },
			nominalV: { description: 'Nominal rail voltage (V). E.g. 3.3, 1.8, 5.0. Default: 3.3.' },
			droopThreshold: { description: 'Voltage level that triggers capture (V). Default: nominalV * 0.85.' },
			timeoutSec: { description: 'Max wait for trigger (seconds). Default: 5.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const channel = typeof args.channel === 'number' ? (Math.max(1, Math.min(4, args.channel)) as 1|2|3|4) : 1;
			const nominalV = typeof args.nominalV === 'number' ? args.nominalV : 3.3;
			const droopThreshold = typeof args.droopThreshold === 'number' ? args.droopThreshold : nominalV * 0.85;

			const result = await scope.railCheck(channel, nominalV, droopThreshold);

			if (!result.triggered) {
				return [
					`Rail check: No droop detected on CH${channel}`,
					`Rail held above ${droopThreshold.toFixed(3)}V for the entire measurement window.`,
					`Rail appears stable at ${nominalV}V nominal.`,
					``,
					`If you expect a droop, check:`,
					`  - Trigger threshold (${droopThreshold.toFixed(2)}V) may be too low`,
					`  - Load event may not be occurring during measurement window`,
					`  - Probe not connected to correct rail`,
				].join('\n');
			}

			const droopMV = (nominalV - result.minV) * 1000;
			const severity = droopMV > 500 ? 'CRITICAL' : droopMV > 200 ? 'WARNING' : 'INFO';

			return [
				`Rail Check: CH${channel} — ${nominalV}V rail`,
				``,
				`[${severity}] Droop detected:`,
				`  Minimum voltage: ${result.minV.toFixed(3)} V (${droopMV.toFixed(0)} mV below nominal)`,
				`  Droop duration:  ${result.droopMs.toFixed(2)} ms`,
				`  Drop to nominal: ${((droopMV / nominalV / 10)).toFixed(1)}%`,
				``,
				droopMV > 500
					? `CRITICAL: ${droopMV.toFixed(0)} mV droop may exceed brown-out reset threshold. Check BOR settings.`
					: droopMV > 200
					? `WARNING: ${droopMV.toFixed(0)} mV droop is significant. Add bulk capacitance to supply.`
					: `INFO: Minor droop (${droopMV.toFixed(0)} mV), likely within spec.`,
				``,
				`Diagnosis:`,
				`  If VDD droops below BOR threshold -> MCU resets -> appears as random restart`,
				`  Fix: Add 10-100 µF bulk cap near MCU VDD, improve trace width from regulator`,
				`  Verify: Read SCB->CFSR after reset to check for unexpected HardFault (vs clean BOR)`,
			].join('\n');
		},
	};
}


function _fwScopeSCPI(scope: IOscilloscopeService): IVoidInternalTool {
	return {
		name: 'fw_scope_scpi',
		description: 'Send a raw SCPI command to the oscilloscope and return the response. Use for commands not covered by other tools, or for non-Siglent scopes where the standard SCPI interface may differ. Queries (ending in ?) return the response string.',
		params: {
			command: { description: 'SCPI command string. Queries end in "?". E.g. ":ACQ:MDEP 100K", ":C1:VDIV?", "*IDN?".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const command = String(args.command ?? '');
			if (!command) { return 'Provide a SCPI command, e.g. "*IDN?" or ":C1:VDIV 1V".'; }

			const response = await scope.sendSCPI(command);

			const lines = [`SCPI: ${command}`];
			if (response && response !== 'OK') {
				lines.push(`Response: ${response}`);
			} else {
				lines.push(`Sent (no response expected for write commands).`);
			}

			return lines.join('\n');
		},
	};
}


// ─── Formatting helpers ───────────────────────────────────────────────────────

function _formatTime(sec: number): string {
	if (sec >= 1) { return `${sec.toFixed(3)} s`; }
	if (sec >= 1e-3) { return `${(sec * 1e3).toFixed(2)} ms`; }
	if (sec >= 1e-6) { return `${(sec * 1e6).toFixed(2)} µs`; }
	return `${(sec * 1e9).toFixed(2)} ns`;
}

function _formatMeasValue(param: string, value: number, unit: string): string {
	if (unit === 'Hz') {
		if (value >= 1e9) { return `${(value / 1e9).toFixed(3)} GHz`; }
		if (value >= 1e6) { return `${(value / 1e6).toFixed(3)} MHz`; }
		if (value >= 1e3) { return `${(value / 1e3).toFixed(3)} kHz`; }
		return `${value.toFixed(3)} Hz`;
	}
	if (unit === 's') {
		return _formatTime(value);
	}
	if (unit === '%') {
		return `${value.toFixed(2)} %`;
	}
	if (unit === 'V') {
		return `${value.toFixed(4)} V`;
	}
	return `${value.toFixed(4)} ${unit}`;
}

function _waveformAscii(voltages: number[], vMin: number, vMax: number): string {
	const height = 8;
	const width = 60;

	// Downsample to width
	const step = Math.max(1, Math.floor(voltages.length / width));
	const sampled = Array.from({ length: width }, (_, i) => voltages[i * step] ?? 0);

	const range = vMax - vMin || 1;
	const rows: string[] = [];

	for (let row = height - 1; row >= 0; row--) {
		const threshold = vMin + (range * row / (height - 1));
		const line = sampled.map(v => v >= threshold ? '*' : ' ').join('');
		const label = row === height - 1 ? ` ${vMax.toFixed(2)}V` :
			row === 0 ? ` ${vMin.toFixed(2)}V` :
			row === Math.floor(height / 2) ? ` ${((vMax + vMin) / 2).toFixed(2)}V` : '';
		rows.push(`  |${line}${label}`);
	}
	rows.push(`  +${'─'.repeat(width)}`);

	return rows.join('\n');
}
