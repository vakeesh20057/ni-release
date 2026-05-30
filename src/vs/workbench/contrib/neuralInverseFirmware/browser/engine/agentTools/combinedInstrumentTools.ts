/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Combined Multi-Instrument Debug Workflows
 *
 * Orchestrates GDB + Logic Analyzer + Power Analyzer + Oscilloscope in coordinated
 * debug sessions. Hardware bugs often require observing multiple domains simultaneously:
 *   - Sleep regression: power + GDB non-intrusive attach + UART decode
 *   - I2C NACK hunt: GDB breakpoint + logic analyzer on SDA/SCL
 *   - Brown-out: oscilloscope rail check + logic + GDB CFSR read without reset
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IFirmwareDebugService } from '../debug/debugService.js';
import { ILogicAnalyzerService } from '../instruments/logicAnalyzer/logicAnalyzerService.js';
import { IPowerAnalyzerService } from '../instruments/powerAnalyzer/powerAnalyzerService.js';
import { IOscilloscopeService } from '../instruments/oscilloscope/oscilloscopeService.js';


export function buildCombinedInstrumentTools(
	session: IFirmwareSessionService,
	debug: IFirmwareDebugService,
	la: ILogicAnalyzerService,
	pa: IPowerAnalyzerService,
	scope: IOscilloscopeService,
): IVoidInternalTool[] {
	return [
		_fwDebugCombined(session, debug, la, pa, scope),
		_fwCorrelatePowerLogic(la, pa),
	];
}


function _fwDebugCombined(
	session: IFirmwareSessionService,
	debug: IFirmwareDebugService,
	la: ILogicAnalyzerService,
	pa: IPowerAnalyzerService,
	scope: IOscilloscopeService,
): IVoidInternalTool {
	return {
		name: 'fw_debug_combined',
		description: `Multi-instrument debug workflow. Orchestrates GDB, logic analyzer, power analyzer, and oscilloscope in a single coordinated session to diagnose common hardware bugs.

Scenarios:
  sleep-regression: Measure sleep current via power analyzer (Joulescope GPI trigger or PPK2 timing),
    attach GDB non-intrusively to read RTC/wakeup-source registers, decode UART log via logic analyzer.
    Use when: sleep current jumped unexpectedly, need to identify which peripheral failed to power down.

  i2c-nack: Set GDB breakpoint on HAL_I2C_ErrorCallback / i2c_error_handler, start logic analyzer
    capture on SDA+SCL channels, report I2C address + decode last N frames when breakpoint fires.
    Use when: I2C sensor NACKs intermittently, need to correlate error callback with bus state.

  brownout: Configure oscilloscope to trigger on VDD falling edge, capture power waveform,
    simultaneously capture PWM/GPIO via logic analyzer, read SCB->CFSR and SCB->HFSR via GDB
    without halting the MCU. Correlates power droop with motor/load switching events.
    Use when: MCU resets under heavy load, suspect brown-out reset.`,
		params: {
			scenario: { description: 'Debug scenario: "sleep-regression", "i2c-nack", or "brownout".' },
			sdaChannel: { description: 'Logic analyzer channel for SDA (i2c-nack scenario). Default: 0.' },
			sclChannel: { description: 'Logic analyzer channel for SCL (i2c-nack scenario). Default: 1.' },
			vddChannel: { description: 'Oscilloscope channel for VDD rail (brownout scenario). Default: 1.' },
			nominalV: { description: 'Nominal VDD voltage V (brownout scenario). Default: 3.3.' },
			sleepWindowSec: { description: 'Power measurement window for sleep current (sleep-regression). Default: 5.' },
			i2cBaudRate: { description: 'I2C clock frequency Hz for decode (i2c-nack). Default: 400000.' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const scenario = String(args.scenario ?? 'sleep-regression');

			switch (scenario) {
				case 'sleep-regression':
					return _scenarioSleepRegression(session, debug, la, pa, args);
				case 'i2c-nack':
					return _scenarioI2CNack(session, debug, la, args);
				case 'brownout':
					return _scenarioBrownout(session, debug, la, scope, args);
				default:
					return [
						`Unknown scenario: "${scenario}"`,
						``,
						`Available scenarios:`,
						`  sleep-regression — power + GDB non-intrusive + UART decode`,
						`  i2c-nack         — GDB breakpoint + logic analyzer on I2C bus`,
						`  brownout         — oscilloscope rail + logic + GDB CFSR read`,
					].join('\n');
			}
		},
	};
}


async function _scenarioSleepRegression(
	session: IFirmwareSessionService,
	debug: IFirmwareDebugService,
	la: ILogicAnalyzerService,
	pa: IPowerAnalyzerService,
	args: Record<string, unknown>,
): Promise<string> {
	const sleepWindowSec = typeof args.sleepWindowSec === 'number' ? args.sleepWindowSec : 5;
	const results: string[] = [
		`=== Sleep Current Regression Analysis ===`,
		``,
		`Step 1: Detecting instruments...`,
	];

	const paStatus = await pa.detect();
	const laStatus = await la.detect();
	const debugState = debug.state;

	results.push(`  Power analyzer: ${paStatus.connected ? paStatus.device.toUpperCase() : 'NOT CONNECTED'}`);
	results.push(`  Logic analyzer: ${laStatus.connected ? laStatus.backend.toUpperCase() : 'NOT CONNECTED'}`);
	results.push(`  GDB:            ${debugState.clientConnected ? 'connected' : 'not connected'}`);
	results.push('');

	// Step 2: Measure sleep current
	if (paStatus.connected) {
		results.push(`Step 2: Measuring current for ${sleepWindowSec}s...`);
		try {
			const powerResult = await pa.measure(
				{ device: paStatus.device, mode: 'ampere', voltageV: 3.3 },
				sleepWindowSec,
			);
			results.push(`  Average current: ${_formatUa(powerResult.avgUa)}`);
			results.push(`  Peak current:    ${_formatUa(powerResult.peakUa)}`);
			results.push(`  Min current:     ${_formatUa(powerResult.minUa)}`);

			if (powerResult.avgUa > 1000) {
				results.push(`  [WARNING] Average ${_formatUa(powerResult.avgUa)} — expected <100 µA for deep sleep`);
				results.push(`  Suspect: peripheral not powered down, clock still running, or DMA active`);
			} else if (powerResult.peakUa > powerResult.avgUa * 20) {
				results.push(`  [INFO] Current spikes ${(powerResult.peakUa / powerResult.avgUa).toFixed(0)}x average — likely periodic wake events`);
			}
		} catch (e) {
			results.push(`  Power measurement error: ${(e as Error).message}`);
		}
	} else {
		results.push(`Step 2: SKIPPED — no power analyzer connected`);
	}

	results.push('');

	// Step 3: GDB non-intrusive register read
	if (debugState.clientConnected) {
		results.push(`Step 3: Reading wakeup-source registers via GDB (non-intrusive)...`);
		try {
			// Read RTC and PWR wakeup source registers
			const family = session.session.mcuConfig?.family?.toUpperCase() ?? '';
			const commands = _getWakeupSourceCommands(family);

			for (const cmd of commands) {
				try {
					const resp = await debug.sendCommand(cmd.gdbCommand);
					results.push(`  ${cmd.label}: ${resp.output.trim() ?? 'N/A'}`);
				} catch {
					results.push(`  ${cmd.label}: read failed`);
				}
			}
		} catch (e) {
			results.push(`  GDB register read error: ${(e as Error).message}`);
		}
	} else {
		results.push(`Step 3: SKIPPED — GDB not connected (run fw_debug_start then attach non-intrusively)`);
	}

	results.push('');

	// Step 4: Logic analyzer UART decode
	if (laStatus.connected) {
		results.push(`Step 4: Capturing UART log for ${Math.min(sleepWindowSec, 3)}s...`);
		// Record start time to correlate with power measurement
		const captureStartEpoch = Date.now();
		try {
			const capture = await la.captureChannels(
				[{ id: 0, label: 'UART_TX', threshold: 1.65, pullup: false }],
				Math.min(sleepWindowSec, 3),
				12000000,
			);
			const frames = await la.decodeProtocol(capture.captureId, { protocol: 'uart', baudRate: 115200 });
			if (frames.length > 0) {
				results.push(`  ${frames.length} UART frames decoded:`);
				for (const frame of frames.slice(0, 10)) {
					// Convert logic capture timestamp to wall-clock epoch for correlation
					const wallClock = captureStartEpoch + frame.timestamp * 1000;
					results.push(`    +${frame.timestamp.toFixed(3)}s (${new Date(wallClock).toISOString().slice(11, 23)}): "${frame.dataAscii}"`);
				}
				// Look for sleep entry message
				const sleepFrame = frames.find(f => f.dataAscii.toLowerCase().includes('sleep') || f.dataAscii.toLowerCase().includes('deep'));
				if (sleepFrame) {
					results.push(`  [KEY] Sleep entry logged at +${sleepFrame.timestamp.toFixed(3)}s: "${sleepFrame.dataAscii}"`);
					results.push(`  Cross-reference: check power trace at this timestamp for current drop`);
				}
			} else {
				results.push(`  No UART frames — device may not be logging sleep transitions`);
			}
		} catch (e) {
			results.push(`  Logic analyzer error: ${(e as Error).message}`);
		}
	} else {
		results.push(`Step 4: SKIPPED — no logic analyzer connected`);
	}

	results.push('');
	results.push(`=== Diagnostic Summary ===`);
	results.push(`Use fw_correlate_power_logic to overlay power timeline with UART log events.`);
	results.push(`Common fixes for excess sleep current:`);
	results.push(`  1. Peripheral not disabled: check all xxx_DeInit() calls before sleep entry`);
	results.push(`  2. GPIO floating: set all unused pins to analog mode before sleep`);
	results.push(`  3. Clock not stopped: verify HSE/PLL disabled, only LSE/LSI active in sleep`);
	results.push(`  4. Debug probe current: disconnect J-Link during sleep measurement`);

	return results.join('\n');
}


async function _scenarioI2CNack(
	session: IFirmwareSessionService,
	debug: IFirmwareDebugService,
	la: ILogicAnalyzerService,
	args: Record<string, unknown>,
): Promise<string> {
	const sdaChannel = typeof args.sdaChannel === 'number' ? args.sdaChannel : 0;
	const sclChannel = typeof args.sclChannel === 'number' ? args.sclChannel : 1;
	const baudRate = typeof args.i2cBaudRate === 'number' ? args.i2cBaudRate : 400000;

	const results: string[] = [
		`=== I2C NACK Hunt ===`,
		``,
		`Step 1: Setting GDB breakpoint on I2C error callback...`,
	];

	const debugState = debug.state;
	if (debugState.clientConnected) {
		const errorCallbacks = ['HAL_I2C_ErrorCallback', 'i2c_error_handler', 'I2C_ErrorHandler'];
		let breakpointSet = false;
		for (const cb of errorCallbacks) {
			try {
				const bp = await debug.setBreakpoint(cb);
				results.push(`  Breakpoint set: ${cb} (ID: ${bp.id})`);
				breakpointSet = true;
				break;
			} catch {
				// try next
			}
		}
		if (!breakpointSet) {
			results.push(`  No standard I2C error callback found. Set manually: fw_debug_set_breakpoint("your_i2c_error_func")`);
		}
	} else {
		results.push(`  GDB not connected — breakpoint skipped`);
	}

	results.push('');

	const laStatus = await la.detect();
	results.push(`Step 2: Starting I2C capture (SDA=CH${sdaChannel}, SCL=CH${sclCh}) — trigger on SCL falling edge...`);

	if (laStatus.connected) {
		try {
			// Trigger on SCL falling edge to start capture exactly when I2C activity begins
			// This avoids capturing silence and ensures we get actual transaction data
			let capture;
			try {
				capture = await la.armTrigger(
					{ channel: sclCh, edge: 'falling' },
					{
						channels: [
							{ id: sdaChannel, label: 'SDA', threshold: 1.65, pullup: true },
							{ id: sclCh, label: 'SCL', threshold: 1.65, pullup: true },
						],
						durationSec: 2,
					},
				);
				results.push(`  Triggered capture: ${capture.captureId} (${capture.durationSec}s)`);
			} catch {
				// Trigger timed out — fall back to free-running 5s capture
				results.push(`  SCL trigger timed out — using free-running 5s capture`);
				capture = await la.captureChannels(
					[
						{ id: sdaChannel, label: 'SDA', threshold: 1.65, pullup: true },
						{ id: sclCh, label: 'SCL', threshold: 1.65, pullup: true },
					],
					5,
					12000000,
				);
			}

			results.push(`  Capture complete: ${capture.captureId}`);

			// Decode I2C
			const frames = await la.decodeProtocol(capture.captureId, {
				protocol: 'i2c',
				dataChannel: sdaChannel,
				clockChannel: sclCh,
			});

			const errors = frames.filter(f => f.error);
			const nacks = errors.filter(f => f.error?.toLowerCase().includes('nack'));

			results.push(`  Total frames: ${frames.length} | Errors: ${errors.length} | NACKs: ${nacks.length}`);
			results.push('');

			if (nacks.length > 0) {
				results.push(`  NACK details:`);
				for (const nack of nacks.slice(0, 5)) {
					const addr = nack.address !== undefined ? `0x${nack.address.toString(16).toUpperCase().padStart(2, '0')}` : 'unknown';
					results.push(`    ${nack.timestamp.toFixed(6)}s: addr=${addr}, data=${nack.dataHex}, error=${nack.error}`);
				}
				results.push('');

				// Diagnose NACK type
				const firstNack = nacks[0]!;
				if (firstNack.dataHex === '') {
					results.push(`  Diagnosis: Address NACK (NAK after address byte)`);
					results.push(`    -> Wrong slave address, device not powered, or device not connected`);
					results.push(`    -> Verify: check pull-up resistors (typically 4.7k for 400 kHz)`);
				} else {
					results.push(`  Diagnosis: Data NACK (NAK after data byte)`);
					results.push(`    -> Slave rejected data — possible clock-stretch timeout or wrong register`);
					results.push(`    -> Check: I2C timeout configuration, clock stretch support`);
					results.push(`    -> Verify with oscilloscope: fw_scope_capture for SDA rise time`);
				}
			} else if (errors.length > 0) {
				results.push(`  Non-NACK errors: ${errors.map(e => e.error).join(', ')}`);
			} else {
				results.push(`  No I2C errors detected in this capture window.`);
				results.push(`  The error may be intermittent — try fw_la_trigger for edge-triggered capture.`);
			}
		} catch (e) {
			results.push(`  Logic analyzer error: ${(e as Error).message}`);
		}
	} else {
		results.push(`  No logic analyzer — connect Saleae Logic 2 or Digilent WaveForms`);
	}

	// GDB error register read if breakpoint hit
	if (debugState.clientConnected) {
		results.push('');
		results.push(`Step 3: Reading I2C error register (if breakpoint fired)...`);
		try {
			const sr1 = await debug.sendCommand('p/x I2C1->SR1');
			results.push(`  I2C1->SR1 = ${sr1.output?.trim() ?? 'N/A'}`);
			results.push(`    Bit 10 (BERR) = bus error (SDA/SCL glitch)`);
			results.push(`    Bit 9 (ARLO) = arbitration lost`);
			results.push(`    Bit 8 (AF)   = acknowledge failure (NACK)`);
			results.push(`    Bit 0 (SB)   = start condition sent`);
		} catch {
			results.push(`  I2C1->SR1 read failed — try: fw_debug_read_memory with I2C base address`);
		}
	}

	return results.join('\n');
}


async function _scenarioBrownout(
	session: IFirmwareSessionService,
	debug: IFirmwareDebugService,
	la: ILogicAnalyzerService,
	scope: IOscilloscopeService,
	args: Record<string, unknown>,
): Promise<string> {
	const vddChannel = typeof args.vddChannel === 'number' ? (Math.max(1, Math.min(4, args.vddChannel)) as 1|2|3|4) : 1;
	const nominalV = typeof args.nominalV === 'number' ? args.nominalV : 3.3;
	const droopThreshold = nominalV * 0.85;

	const results: string[] = [
		`=== Brown-out Diagnosis ===`,
		``,
		`Configuration:`,
		`  VDD rail:          CH${vddChannel} on oscilloscope`,
		`  Nominal voltage:   ${nominalV}V`,
		`  Droop threshold:   ${droopThreshold.toFixed(2)}V (85% of nominal)`,
		``,
	];

	const scopeStatus = scope.getStatus();
	const laStatus = la.getStatus();
	const debugState = debug.state;

	results.push(`Instruments:`);
	results.push(`  Oscilloscope: ${scopeStatus.connected ? scopeStatus.model ?? 'connected' : 'NOT CONNECTED'}`);
	results.push(`  Logic analyzer: ${laStatus.connected ? laStatus.backend : 'NOT CONNECTED'}`);
	results.push(`  GDB: ${debugState.clientConnected ? 'connected' : 'NOT CONNECTED'}`);
	results.push('');

	// Step 1: Rail check via oscilloscope
	results.push(`Step 1: Checking VDD rail on CH${vddChannel}...`);
	if (scopeStatus.connected) {
		try {
			const railResult = await scope.railCheck(vddChannel, nominalV, droopThreshold);
			if (railResult.triggered) {
				const droopMV = (nominalV - railResult.minV) * 1000;
				results.push(`  [DROOP DETECTED] Min: ${railResult.minV.toFixed(3)}V (${droopMV.toFixed(0)} mV drop)`);
				results.push(`  Droop duration: ${railResult.droopMs.toFixed(2)} ms`);

				if (droopMV > 500) {
					results.push(`  CRITICAL: ${droopMV.toFixed(0)} mV droop likely exceeds BOR threshold.`);
					results.push(`  BOR typically triggers at 2.7-2.8V on STM32 — MCU will reset.`);
				}
			} else {
				results.push(`  No droop above ${droopThreshold.toFixed(2)}V detected.`);
				results.push(`  If resets still occur, check for software hard faults (not power issue).`);
			}
		} catch (e) {
			results.push(`  Oscilloscope error: ${(e as Error).message}`);
		}
	} else {
		results.push(`  SKIPPED — no oscilloscope connected`);
		results.push(`  Connect scope CH${vddChannel} to VDD rail, run fw_scope_discover first`);
	}

	results.push('');

	// Step 2: Logic capture during load event
	results.push(`Step 2: Capturing PWM/load signals via logic analyzer...`);
	if (laStatus.connected) {
		try {
			const capture = await la.captureChannels(
				[
					{ id: 0, label: 'PWM', threshold: 1.65, pullup: false },
					{ id: 1, label: 'HALL', threshold: 1.65, pullup: false },
					{ id: 2, label: 'ENABLE', threshold: 1.65, pullup: false },
				],
				2,
				12000000,
			);
			results.push(`  Captured 2s of PWM/Hall/Enable signals: ${capture.captureId}`);
			results.push(`  Decode with: fw_la_decode({ captureId: "${capture.captureId}", protocol: "uart" })`);
		} catch (e) {
			results.push(`  Logic analyzer error: ${(e as Error).message}`);
		}
	} else {
		results.push(`  SKIPPED — no logic analyzer connected`);
	}

	results.push('');

	// Step 3: GDB fault register read without halting
	results.push(`Step 3: Reading fault registers via GDB (non-intrusive)...`);
	if (debugState.clientConnected) {
		const faultRegs = [
			{ name: 'SCB->CFSR', address: '0xE000ED28', desc: 'Configurable Fault Status Register' },
			{ name: 'SCB->HFSR', address: '0xE000ED2C', desc: 'Hard Fault Status Register' },
			{ name: 'SCB->DFSR', address: '0xE000ED30', desc: 'Debug Fault Status Register' },
		];

		for (const reg of faultRegs) {
			try {
				const resp = await debug.sendCommand(`x/1wx ${reg.address}`);
				const value = resp.output.trim() ?? '0x00000000';
				results.push(`  ${reg.name} (${reg.address}) = ${value}`);
			} catch {
				results.push(`  ${reg.name}: read failed`);
			}
		}
		results.push('');
		results.push(`  CFSR interpretation:`);
		results.push(`    0x00000000 = no fault recorded (power-induced reset, not software fault)`);
		results.push(`    Non-zero = software fault (UsageFault, BusFault, MemFault) — NOT a brown-out`);
	} else {
		results.push(`  SKIPPED — run fw_debug_start with "attach without reset" first`);
	}

	results.push('');
	results.push(`=== Diagnosis ===`);
	results.push(`VDD droops below BOR threshold:  Hardware issue — add bulk capacitance near MCU, widen power traces`);
	results.push(`CFSR non-zero with clean VDD:    Software fault — set breakpoint on HardFault_Handler, read stack`);
	results.push(`Both droop AND CFSR non-zero:    Power droop triggered BOR, but also software instability present`);

	return results.join('\n');
}


function _fwCorrelatePowerLogic(la: ILogicAnalyzerService, pa: IPowerAnalyzerService): IVoidInternalTool {
	return {
		name: 'fw_correlate_power_logic',
		description: 'Correlate a power measurement result with logic analyzer decoded frames. Finds temporal overlaps between high-current windows (above a threshold) and protocol events (errors, specific addresses, data patterns).',
		params: {
			powerSessionId: { description: 'Power result session ID from fw_pa_measure.' },
			logicCaptureId: { description: 'Logic capture ID from fw_la_capture.' },
			currentThresholdUa: { description: 'Current threshold in microamps to identify high-current windows. Default: 10x average.' },
			searchPattern: { description: 'Optional ASCII pattern to search for in logic frames, e.g. "sleep", "error".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const captureId = String(args.logicCaptureId ?? '');
			if (!captureId) { return 'Provide logicCaptureId from fw_la_capture + fw_la_decode.'; }

			const capture = la.getCapture(captureId);
			if (!capture) {
				return `Capture ${captureId} not found. Re-run fw_la_capture to regenerate.`;
			}

			if (capture.frames.length === 0) {
				return `No decoded frames in capture ${captureId}. Run fw_la_decode first.`;
			}

			const pattern = typeof args.searchPattern === 'string' ? args.searchPattern.toLowerCase() : '';

			const results: string[] = [
				`=== Power-Logic Correlation ===`,
				`Logic capture: ${captureId} (${capture.frames.length} frames, ${capture.durationSec}s)`,
				``,
			];

			// Filter frames by pattern if specified
			const relevantFrames = pattern
				? capture.frames.filter(f =>
					f.dataAscii.toLowerCase().includes(pattern) ||
					f.error?.toLowerCase().includes(pattern),
				)
				: capture.frames.filter(f => f.error);

			if (relevantFrames.length === 0) {
				results.push(pattern
					? `No frames matching "${pattern}" found.`
					: `No error frames found. Use searchPattern to filter specific events.`,
				);
				results.push('');
				results.push(`Timeline summary:`);
				results.push(`  First frame: ${capture.frames[0]!.timestamp.toFixed(6)}s`);
				results.push(`  Last frame:  ${capture.frames[capture.frames.length - 1]!.timestamp.toFixed(6)}s`);
				results.push(`  Total: ${capture.frames.length} frames`);
				results.push(`  Errors: ${capture.frames.filter(f => f.error).length}`);
				return results.join('\n');
			}

			results.push(`Found ${relevantFrames.length} ${pattern ? `"${pattern}"` : 'error'} events:`);
			results.push('');

			for (const frame of relevantFrames.slice(0, 20)) {
				const addr = frame.address !== undefined ? ` addr=0x${frame.address.toString(16).toUpperCase().padStart(2, '0')}` : '';
				const err = frame.error ? ` [${frame.error}]` : '';
				results.push(`  ${frame.timestamp.toFixed(6)}s ${frame.protocol.toUpperCase()}${addr} "${frame.dataAscii}"${err}`);
			}

			if (relevantFrames.length > 20) {
				results.push(`  ... and ${relevantFrames.length - 20} more`);
			}

			results.push('');
			results.push(`For full power-logic timeline analysis:`);
			results.push(`  Connect Joulescope JS220 with GPI connected to a firmware debug GPIO`);
			results.push(`  Use fw_pa_trigger to synchronize power capture to the same edge`);
			results.push(`  Compare timestamps to identify if current spikes precede or follow protocol events`);

			return results.join('\n');
		},
	};
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

function _formatUa(ua: number): string {
	if (ua >= 1e6) { return `${(ua / 1e6).toFixed(3)} A`; }
	if (ua >= 1e3) { return `${(ua / 1e3).toFixed(2)} mA`; }
	return `${ua.toFixed(1)} µA`;
}

function _getWakeupSourceCommands(family: string): Array<{ label: string; gdbCommand: string }> {
	if (family.startsWith('STM32') || family.startsWith('NRF')) {
		return [
			{ label: 'RCC->CSR (reset cause)', gdbCommand: 'p/x RCC->CSR' },
			{ label: 'PWR->CSR (wakeup source)', gdbCommand: 'p/x PWR->CSR' },
			{ label: 'RTC->ISR', gdbCommand: 'p/x RTC->ISR' },
		];
	}
	if (family.startsWith('NRF')) {
		return [
			{ label: 'NRF_POWER->RESETREAS', gdbCommand: 'p/x *((unsigned int*)0x40000400)' },
			{ label: 'NRF_RTC0->COUNTER', gdbCommand: 'p/x *((unsigned int*)0x4000B504)' },
		];
	}
	return [
		{ label: 'Reset cause register', gdbCommand: 'p/x *((unsigned int*)0xE000ED28)' }, // SCB->CFSR fallback
	];
}
