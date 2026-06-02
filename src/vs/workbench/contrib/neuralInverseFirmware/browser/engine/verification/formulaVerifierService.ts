/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formula Verification Service
 *
 * Validates common embedded firmware calculations against datasheet-specified
 * formulas. Catches prescaler/divider errors before they reach hardware.
 *
 * Supported formulas:
 *   - UART baud rate (BRR register)
 *   - SPI clock divider
 *   - I2C timing (CCR/TIMINGR)
 *   - Timer period/frequency
 *   - PLL output frequency
 *   - ADC sample time + conversion time
 *   - PWM duty cycle + frequency
 *   - CAN bit timing (prescaler, BS1, BS2, SJW)
 */

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';


export const IFormulaVerifierService = createDecorator<IFormulaVerifierService>('formulaVerifierService');

export interface IFormulaVerifierService {
	readonly _serviceBrand: undefined;

	verify(formula: IFormulaVerification): IFormulaResult;
	listFormulas(): IFormulaTemplate[];
}

export interface IFormulaVerification {
	type: FormulaType;
	params: Record<string, number>;
	expected?: number;
}

export interface IFormulaResult {
	computed: number;
	unit: string;
	formula: string;
	error?: {
		message: string;
		deviation: number;
		deviationPercent: number;
	};
	warnings: string[];
}

export interface IFormulaTemplate {
	type: FormulaType;
	description: string;
	params: Array<{ name: string; description: string; unit: string }>;
	outputUnit: string;
}

export type FormulaType =
	| 'uart-baud'
	| 'spi-clock'
	| 'i2c-frequency'
	| 'timer-period'
	| 'timer-frequency'
	| 'pll-output'
	| 'adc-conversion-time'
	| 'pwm-frequency'
	| 'pwm-duty'
	| 'can-bitrate';


class FormulaVerifierServiceImpl extends Disposable implements IFormulaVerifierService {
	readonly _serviceBrand: undefined;

	verify(formula: IFormulaVerification): IFormulaResult {
		switch (formula.type) {
			case 'uart-baud': return this._verifyUartBaud(formula.params, formula.expected);
			case 'spi-clock': return this._verifySpiClock(formula.params, formula.expected);
			case 'i2c-frequency': return this._verifyI2cFreq(formula.params, formula.expected);
			case 'timer-period': return this._verifyTimerPeriod(formula.params, formula.expected);
			case 'timer-frequency': return this._verifyTimerFreq(formula.params, formula.expected);
			case 'pll-output': return this._verifyPllOutput(formula.params, formula.expected);
			case 'adc-conversion-time': return this._verifyAdcTime(formula.params, formula.expected);
			case 'pwm-frequency': return this._verifyPwmFreq(formula.params, formula.expected);
			case 'pwm-duty': return this._verifyPwmDuty(formula.params, formula.expected);
			case 'can-bitrate': return this._verifyCanBitrate(formula.params, formula.expected);
			default: return { computed: 0, unit: '', formula: 'unknown', warnings: [`Unknown formula type: ${formula.type}`] };
		}
	}

	listFormulas(): IFormulaTemplate[] {
		return FORMULA_TEMPLATES;
	}

	// ─── UART ────────────────────────────────────────────────────────────────

	private _verifyUartBaud(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? p.pclk ?? 0;
		const brr = p.brr ?? 0;
		const over8 = p.over8 ?? 0;

		const divisor = over8 ? (8 * brr) : (16 * brr);
		const computed = divisor > 0 ? fclk / divisor : 0;
		const formula = over8
			? `baud = f_clk / (8 × BRR) = ${fclk} / (8 × ${brr})`
			: `baud = f_clk / (16 × BRR) = ${fclk} / (16 × ${brr})`;

		const warnings: string[] = [];
		if (computed > 0 && expected) {
			const errorPct = Math.abs(computed - expected) / expected * 100;
			if (errorPct > 3) warnings.push(`Baud rate error ${errorPct.toFixed(2)}% exceeds 3% — communication may be unreliable.`);
			else if (errorPct > 1) warnings.push(`Baud rate error ${errorPct.toFixed(2)}% — acceptable but not ideal.`);
		}

		return this._buildResult(computed, 'baud', formula, expected, warnings);
	}

	// ─── SPI ─────────────────────────────────────────────────────────────────

	private _verifySpiClock(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? p.pclk ?? 0;
		const prescaler = p.prescaler ?? p.br ?? 0;

		const divider = prescaler < 8 ? (2 << prescaler) : prescaler;
		const computed = divider > 0 ? fclk / divider : 0;
		const formula = `f_spi = f_clk / prescaler = ${fclk} / ${divider}`;

		const warnings: string[] = [];
		if (computed > 50_000_000) warnings.push('SPI clock exceeds 50 MHz — verify slave device max clock specification.');

		return this._buildResult(computed, 'Hz', formula, expected, warnings);
	}

	// ─── I2C ─────────────────────────────────────────────────────────────────

	private _verifyI2cFreq(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? p.pclk ?? 0;
		const ccr = p.ccr ?? 0;
		const duty = p.duty ?? 0;

		let computed: number;
		let formula: string;
		if (duty === 0) {
			computed = ccr > 0 ? fclk / (2 * ccr) : 0;
			formula = `f_i2c = f_clk / (2 × CCR) = ${fclk} / (2 × ${ccr})`;
		} else {
			computed = ccr > 0 ? fclk / (3 * ccr) : 0;
			formula = `f_i2c = f_clk / (3 × CCR) = ${fclk} / (3 × ${ccr}) [fast mode duty=1]`;
		}

		const warnings: string[] = [];
		if (computed > 400_000) warnings.push('I2C frequency exceeds 400 kHz Fast Mode specification.');
		if (computed > 100_000 && expected && expected <= 100_000) warnings.push('Computed frequency is Fast Mode but target appears to be Standard Mode (100 kHz).');

		return this._buildResult(computed, 'Hz', formula, expected, warnings);
	}

	// ─── Timer ───────────────────────────────────────────────────────────────

	private _verifyTimerPeriod(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? 0;
		const psc = p.psc ?? p.prescaler ?? 0;
		const arr = p.arr ?? p.period ?? 0;

		const computed = fclk > 0 ? ((psc + 1) * (arr + 1)) / fclk : 0;
		const formula = `T = (PSC+1)(ARR+1) / f_clk = (${psc}+1)(${arr}+1) / ${fclk}`;

		return this._buildResult(computed, 's', formula, expected, []);
	}

	private _verifyTimerFreq(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? 0;
		const psc = p.psc ?? p.prescaler ?? 0;
		const arr = p.arr ?? p.period ?? 0;

		const divisor = (psc + 1) * (arr + 1);
		const computed = divisor > 0 ? fclk / divisor : 0;
		const formula = `f = f_clk / ((PSC+1)(ARR+1)) = ${fclk} / ((${psc}+1)(${arr}+1))`;

		return this._buildResult(computed, 'Hz', formula, expected, []);
	}

	// ─── PLL ─────────────────────────────────────────────────────────────────

	private _verifyPllOutput(p: Record<string, number>, expected?: number): IFormulaResult {
		const fin = p.fin ?? p.hse ?? p.hsi ?? 0;
		const m = p.m ?? p.pllm ?? 1;
		const n = p.n ?? p.plln ?? 1;
		const pdiv = p.p ?? p.pllp ?? 2;

		const vco = (fin / m) * n;
		const computed = vco / pdiv;
		const formula = `f_pll = (f_in / M) × N / P = (${fin} / ${m}) × ${n} / ${pdiv}`;

		const warnings: string[] = [];
		const vcoMHz = vco / 1_000_000;
		if (vcoMHz < 100) warnings.push(`VCO frequency ${vcoMHz.toFixed(1)} MHz is below typical minimum (100 MHz) — PLL may not lock.`);
		if (vcoMHz > 432) warnings.push(`VCO frequency ${vcoMHz.toFixed(1)} MHz exceeds typical maximum (432 MHz for STM32F4).`);
		if (fin / m < 1_000_000) warnings.push('PLL input frequency (f_in/M) below 1 MHz — increases jitter.');
		if (fin / m > 2_000_000) warnings.push('PLL input frequency (f_in/M) above 2 MHz — check datasheet limits.');

		return this._buildResult(computed, 'Hz', formula, expected, warnings);
	}

	// ─── ADC ─────────────────────────────────────────────────────────────────

	private _verifyAdcTime(p: Record<string, number>, expected?: number): IFormulaResult {
		const fAdc = p.fAdc ?? p.adcClk ?? 0;
		const sampleCycles = p.sampleCycles ?? p.smp ?? 0;
		const resolution = p.resolution ?? 12;

		const convCycles = resolution + sampleCycles;
		const computed = fAdc > 0 ? convCycles / fAdc : 0;
		const formula = `t_conv = (resolution + sample_cycles) / f_adc = (${resolution} + ${sampleCycles}) / ${fAdc}`;

		const warnings: string[] = [];
		if (fAdc > 36_000_000) warnings.push('ADC clock exceeds 36 MHz — check datasheet max ADC clock.');
		if (fAdc < 600_000) warnings.push('ADC clock below 600 kHz — may affect accuracy.');

		return this._buildResult(computed, 's', formula, expected, warnings);
	}

	// ─── PWM ─────────────────────────────────────────────────────────────────

	private _verifyPwmFreq(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? 0;
		const psc = p.psc ?? p.prescaler ?? 0;
		const arr = p.arr ?? p.period ?? 0;

		const divisor = (psc + 1) * (arr + 1);
		const computed = divisor > 0 ? fclk / divisor : 0;
		const formula = `f_pwm = f_clk / ((PSC+1)(ARR+1)) = ${fclk} / ((${psc}+1)(${arr}+1))`;

		return this._buildResult(computed, 'Hz', formula, expected, []);
	}

	private _verifyPwmDuty(p: Record<string, number>, expected?: number): IFormulaResult {
		const ccr = p.ccr ?? p.compare ?? 0;
		const arr = p.arr ?? p.period ?? 0;

		const computed = arr > 0 ? (ccr / (arr + 1)) * 100 : 0;
		const formula = `duty = CCR / (ARR+1) × 100 = ${ccr} / (${arr}+1) × 100`;

		const warnings: string[] = [];
		if (ccr > arr + 1) warnings.push('CCR > ARR+1 — output will be permanently high (100% duty).');

		return this._buildResult(computed, '%', formula, expected, warnings);
	}

	// ─── CAN ─────────────────────────────────────────────────────────────────

	private _verifyCanBitrate(p: Record<string, number>, expected?: number): IFormulaResult {
		const fclk = p.fclk ?? p.pclk ?? 0;
		const prescaler = p.prescaler ?? p.brp ?? 1;
		const bs1 = p.bs1 ?? p.tseg1 ?? 1;
		const bs2 = p.bs2 ?? p.tseg2 ?? 1;
		const sjw = p.sjw ?? 1;

		const bitTime = (1 + bs1 + bs2);
		const computed = bitTime > 0 ? fclk / (prescaler * bitTime) : 0;
		const formula = `bitrate = f_clk / (BRP × (1 + BS1 + BS2)) = ${fclk} / (${prescaler} × (1 + ${bs1} + ${bs2}))`;

		const warnings: string[] = [];
		const samplePoint = ((1 + bs1) / bitTime) * 100;
		if (samplePoint < 75 || samplePoint > 87.5) {
			warnings.push(`Sample point at ${samplePoint.toFixed(1)}% — CAN 2.0 recommends 75-87.5%.`);
		}
		if (sjw > Math.min(bs1, bs2)) {
			warnings.push(`SJW (${sjw}) > min(BS1, BS2) — violates CAN specification.`);
		}

		return this._buildResult(computed, 'bps', formula, expected, warnings);
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private _buildResult(computed: number, unit: string, formula: string, expected: number | undefined, warnings: string[]): IFormulaResult {
		const result: IFormulaResult = { computed, unit, formula, warnings };

		if (expected !== undefined && expected > 0) {
			const deviation = computed - expected;
			const deviationPercent = (deviation / expected) * 100;
			if (Math.abs(deviationPercent) > 0.01) {
				result.error = {
					message: `Expected ${expected} ${unit}, computed ${computed.toFixed(4)} ${unit} (${deviationPercent > 0 ? '+' : ''}${deviationPercent.toFixed(3)}%)`,
					deviation,
					deviationPercent,
				};
			}
		}

		return result;
	}
}


const FORMULA_TEMPLATES: IFormulaTemplate[] = [
	{
		type: 'uart-baud',
		description: 'UART baud rate from BRR register value',
		params: [
			{ name: 'fclk', description: 'Peripheral clock frequency', unit: 'Hz' },
			{ name: 'brr', description: 'Baud rate register value', unit: '' },
			{ name: 'over8', description: 'Oversampling by 8 (0=16x, 1=8x)', unit: '' },
		],
		outputUnit: 'baud',
	},
	{
		type: 'spi-clock',
		description: 'SPI clock frequency from prescaler',
		params: [
			{ name: 'fclk', description: 'Peripheral clock frequency', unit: 'Hz' },
			{ name: 'prescaler', description: 'Baud rate control bits (0-7 for /2../256, or direct divider)', unit: '' },
		],
		outputUnit: 'Hz',
	},
	{
		type: 'i2c-frequency',
		description: 'I2C SCL frequency from CCR register',
		params: [
			{ name: 'fclk', description: 'Peripheral clock frequency', unit: 'Hz' },
			{ name: 'ccr', description: 'Clock control register value', unit: '' },
			{ name: 'duty', description: 'Duty cycle mode (0=50%, 1=fast mode 2:1)', unit: '' },
		],
		outputUnit: 'Hz',
	},
	{
		type: 'timer-frequency',
		description: 'Timer output frequency from prescaler and auto-reload',
		params: [
			{ name: 'fclk', description: 'Timer clock frequency', unit: 'Hz' },
			{ name: 'psc', description: 'Prescaler register value', unit: '' },
			{ name: 'arr', description: 'Auto-reload register value', unit: '' },
		],
		outputUnit: 'Hz',
	},
	{
		type: 'timer-period',
		description: 'Timer overflow period',
		params: [
			{ name: 'fclk', description: 'Timer clock frequency', unit: 'Hz' },
			{ name: 'psc', description: 'Prescaler register value', unit: '' },
			{ name: 'arr', description: 'Auto-reload register value', unit: '' },
		],
		outputUnit: 's',
	},
	{
		type: 'pll-output',
		description: 'PLL output frequency (f_in/M × N / P)',
		params: [
			{ name: 'fin', description: 'PLL input frequency (HSE or HSI)', unit: 'Hz' },
			{ name: 'm', description: 'Input divider (PLLM)', unit: '' },
			{ name: 'n', description: 'Multiplier (PLLN)', unit: '' },
			{ name: 'p', description: 'Output divider (PLLP)', unit: '' },
		],
		outputUnit: 'Hz',
	},
	{
		type: 'adc-conversion-time',
		description: 'ADC total conversion time',
		params: [
			{ name: 'fAdc', description: 'ADC clock frequency', unit: 'Hz' },
			{ name: 'sampleCycles', description: 'Sample time in ADC clock cycles', unit: 'cycles' },
			{ name: 'resolution', description: 'ADC resolution in bits (default: 12)', unit: 'bits' },
		],
		outputUnit: 's',
	},
	{
		type: 'pwm-frequency',
		description: 'PWM output frequency',
		params: [
			{ name: 'fclk', description: 'Timer clock frequency', unit: 'Hz' },
			{ name: 'psc', description: 'Prescaler register value', unit: '' },
			{ name: 'arr', description: 'Auto-reload (period) register value', unit: '' },
		],
		outputUnit: 'Hz',
	},
	{
		type: 'pwm-duty',
		description: 'PWM duty cycle percentage',
		params: [
			{ name: 'ccr', description: 'Capture/compare register value', unit: '' },
			{ name: 'arr', description: 'Auto-reload (period) register value', unit: '' },
		],
		outputUnit: '%',
	},
	{
		type: 'can-bitrate',
		description: 'CAN bus bit rate and sample point',
		params: [
			{ name: 'fclk', description: 'CAN peripheral clock frequency', unit: 'Hz' },
			{ name: 'prescaler', description: 'Baud rate prescaler (BRP)', unit: '' },
			{ name: 'bs1', description: 'Bit segment 1 (time quanta)', unit: 'tq' },
			{ name: 'bs2', description: 'Bit segment 2 (time quanta)', unit: 'tq' },
			{ name: 'sjw', description: 'Synchronisation jump width', unit: 'tq' },
		],
		outputUnit: 'bps',
	},
];

registerSingleton(IFormulaVerifierService, FormulaVerifierServiceImpl, InstantiationType.Delayed);
