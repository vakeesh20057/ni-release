/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Clock Tree Validator
 *
 * Validates PLL configurations against hardware constraints and
 * computes flash wait states. Prevents the most common cause of
 * "device hard faults on boot after changing clock speed."
 */

import {
	IClockConstraints, IPLLConfig, IClockValidationResult,
	IClockViolation, IFlashWaitState,
} from './clockTreeTypes.js';

export class ClockTreeValidatorService {

	validate(
		pll: IPLLConfig,
		hseMHz: number,
		ahbPrescaler: number,
		apb1Prescaler: number,
		apb2Prescaler: number,
		family: string,
	): IClockValidationResult {
		const constraints = this.getConstraints(family);
		const errors: IClockViolation[] = [];
		const warnings: IClockViolation[] = [];

		// Compute derived frequencies
		const pllInputMHz = hseMHz / pll.m;
		const vcoMHz = pllInputMHz * pll.n;
		const sysclkMHz = vcoMHz / pll.p;
		const hclkMHz = sysclkMHz / ahbPrescaler;
		const apb1MHz = hclkMHz / apb1Prescaler;
		const apb2MHz = hclkMHz / apb2Prescaler;
		const pll48MHz = vcoMHz / pll.q;

		// Validate M divider range
		if (pll.m < constraints.mRange[0] || pll.m > constraints.mRange[1]) {
			errors.push({ field: 'PLLM', message: `PLLM=${pll.m} out of range [${constraints.mRange[0]}, ${constraints.mRange[1]}]`, actual: pll.m, limit: constraints.mRange[1] });
		}

		// Validate N multiplier range
		if (pll.n < constraints.nRange[0] || pll.n > constraints.nRange[1]) {
			errors.push({ field: 'PLLN', message: `PLLN=${pll.n} out of range [${constraints.nRange[0]}, ${constraints.nRange[1]}]`, actual: pll.n, limit: constraints.nRange[1] });
		}

		// Validate P divider
		if (!constraints.pValues.includes(pll.p)) {
			errors.push({ field: 'PLLP', message: `PLLP=${pll.p} invalid. Must be one of: ${constraints.pValues.join(', ')}`, actual: pll.p, limit: 0 });
		}

		// Validate Q divider range
		if (pll.q < constraints.qRange[0] || pll.q > constraints.qRange[1]) {
			errors.push({ field: 'PLLQ', message: `PLLQ=${pll.q} out of range [${constraints.qRange[0]}, ${constraints.qRange[1]}]`, actual: pll.q, limit: constraints.qRange[1] });
		}

		// PLL input frequency
		if (pllInputMHz < constraints.pllInputRange[0] || pllInputMHz > constraints.pllInputRange[1]) {
			errors.push({ field: 'PLL_INPUT', message: `PLL input = ${pllInputMHz.toFixed(2)} MHz (HSE/${pll.m}). Must be ${constraints.pllInputRange[0]}-${constraints.pllInputRange[1]} MHz.`, actual: pllInputMHz, limit: constraints.pllInputRange[1] });
		}

		// VCO frequency
		if (vcoMHz < constraints.vcoRange[0] || vcoMHz > constraints.vcoRange[1]) {
			errors.push({ field: 'VCO', message: `VCO = ${vcoMHz.toFixed(1)} MHz. Must be ${constraints.vcoRange[0]}-${constraints.vcoRange[1]} MHz.`, actual: vcoMHz, limit: constraints.vcoRange[1] });
		}

		// SYSCLK limit
		if (sysclkMHz > constraints.sysclkMax) {
			errors.push({ field: 'SYSCLK', message: `SYSCLK = ${sysclkMHz.toFixed(1)} MHz exceeds max ${constraints.sysclkMax} MHz.`, actual: sysclkMHz, limit: constraints.sysclkMax });
		}

		// APB1 limit
		if (apb1MHz > constraints.apb1Max) {
			errors.push({ field: 'APB1', message: `APB1 = ${apb1MHz.toFixed(1)} MHz exceeds max ${constraints.apb1Max} MHz.`, actual: apb1MHz, limit: constraints.apb1Max });
		}

		// APB2 limit
		if (apb2MHz > constraints.apb2Max) {
			errors.push({ field: 'APB2', message: `APB2 = ${apb2MHz.toFixed(1)} MHz exceeds max ${constraints.apb2Max} MHz.`, actual: apb2MHz, limit: constraints.apb2Max });
		}

		// Peripheral clock requirements
		for (const req of constraints.peripheralClockRequirements) {
			if (req.clockSource === 'PLL48CLK') {
				const diff = Math.abs(pll48MHz - req.requiredMHz);
				const toleranceMHz = req.requiredMHz * (req.tolerance / 100);
				if (diff > toleranceMHz) {
					errors.push({
						field: req.peripheral,
						message: `${req.peripheral} requires ${req.clockSource} = ${req.requiredMHz} MHz (tolerance ${req.tolerance}%). Got ${pll48MHz.toFixed(2)} MHz.`,
						actual: pll48MHz,
						limit: req.requiredMHz,
					});
				}
			}
		}

		// Flash wait states
		const flashWaitStates = this._computeFlashWaitStates(hclkMHz, constraints.flashWaitStates);

		// VCO sweet spot warning
		const vcoMid = (constraints.vcoRange[0] + constraints.vcoRange[1]) / 2;
		if (vcoMHz < constraints.vcoRange[0] * 1.1 || vcoMHz > constraints.vcoRange[1] * 0.9) {
			warnings.push({ field: 'VCO', message: `VCO = ${vcoMHz.toFixed(1)} MHz is near the edge of valid range. Center (~${vcoMid.toFixed(0)} MHz) gives better jitter.`, actual: vcoMHz, limit: vcoMid });
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			computedValues: {
				pllInputMHz,
				vcoMHz,
				sysclkMHz,
				hclkMHz,
				apb1MHz,
				apb2MHz,
				pll48MHz,
				flashWaitStates,
			},
		};
	}

	getConstraints(family: string): IClockConstraints {
		const fam = family.toUpperCase();

		if (fam.startsWith('STM32F4')) { return STM32F4_CONSTRAINTS; }
		if (fam.startsWith('STM32F7')) { return STM32F7_CONSTRAINTS; }
		if (fam.startsWith('STM32H7')) { return STM32H7_CONSTRAINTS; }
		if (fam.startsWith('STM32G4')) { return STM32G4_CONSTRAINTS; }
		if (fam.startsWith('STM32F1') || fam.startsWith('STM32F0') || fam.startsWith('STM32F3')) {
			return STM32F1_CONSTRAINTS;
		}

		// Default to F4 constraints
		return STM32F4_CONSTRAINTS;
	}

	private _computeFlashWaitStates(hclkMHz: number, table: IFlashWaitState[]): number {
		for (const entry of table) {
			if (hclkMHz <= entry.maxHCLK) {
				return entry.waitStates;
			}
		}
		return table[table.length - 1]?.waitStates ?? 5;
	}
}


// ─── Constraint Databases ────────────────────────────────────────────────────

const STM32F4_CONSTRAINTS: IClockConstraints = {
	family: 'STM32F4',
	hseRange: [4, 26],
	pllInputRange: [1, 2],
	vcoRange: [100, 432],
	sysclkMax: 168,
	apb1Max: 42,
	apb2Max: 84,
	mRange: [2, 63],
	nRange: [50, 432],
	pValues: [2, 4, 6, 8],
	qRange: [2, 15],
	flashWaitStates: [
		{ maxHCLK: 30, waitStates: 0, voltage: '2.7-3.6V' },
		{ maxHCLK: 60, waitStates: 1, voltage: '2.7-3.6V' },
		{ maxHCLK: 90, waitStates: 2, voltage: '2.7-3.6V' },
		{ maxHCLK: 120, waitStates: 3, voltage: '2.7-3.6V' },
		{ maxHCLK: 150, waitStates: 4, voltage: '2.7-3.6V' },
		{ maxHCLK: 168, waitStates: 5, voltage: '2.7-3.6V' },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB_OTG_FS', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
		{ peripheral: 'SDIO', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
		{ peripheral: 'RNG', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

const STM32F7_CONSTRAINTS: IClockConstraints = {
	family: 'STM32F7',
	hseRange: [4, 26],
	pllInputRange: [1, 2],
	vcoRange: [100, 432],
	sysclkMax: 216,
	apb1Max: 54,
	apb2Max: 108,
	mRange: [2, 63],
	nRange: [50, 432],
	pValues: [2, 4, 6, 8],
	qRange: [2, 15],
	flashWaitStates: [
		{ maxHCLK: 30, waitStates: 0 },
		{ maxHCLK: 60, waitStates: 1 },
		{ maxHCLK: 90, waitStates: 2 },
		{ maxHCLK: 120, waitStates: 3 },
		{ maxHCLK: 150, waitStates: 4 },
		{ maxHCLK: 180, waitStates: 5 },
		{ maxHCLK: 210, waitStates: 6 },
		{ maxHCLK: 216, waitStates: 7 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB_OTG_FS', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
		{ peripheral: 'SDMMC1', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

const STM32H7_CONSTRAINTS: IClockConstraints = {
	family: 'STM32H7',
	hseRange: [4, 48],
	pllInputRange: [1, 16],
	vcoRange: [150, 836],
	sysclkMax: 480,
	apb1Max: 120,
	apb2Max: 120,
	mRange: [1, 63],
	nRange: [4, 512],
	pValues: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128],
	qRange: [1, 128],
	flashWaitStates: [
		{ maxHCLK: 70, waitStates: 0 },
		{ maxHCLK: 140, waitStates: 1 },
		{ maxHCLK: 210, waitStates: 2 },
		{ maxHCLK: 275, waitStates: 3 },
		{ maxHCLK: 480, waitStates: 4 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB_OTG', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

const STM32G4_CONSTRAINTS: IClockConstraints = {
	family: 'STM32G4',
	hseRange: [4, 48],
	pllInputRange: [2.66, 16],
	vcoRange: [64, 344],
	sysclkMax: 170,
	apb1Max: 170,
	apb2Max: 170,
	mRange: [1, 16],
	nRange: [8, 127],
	pValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
	qRange: [2, 8],
	flashWaitStates: [
		{ maxHCLK: 34, waitStates: 0 },
		{ maxHCLK: 68, waitStates: 1 },
		{ maxHCLK: 102, waitStates: 2 },
		{ maxHCLK: 136, waitStates: 3 },
		{ maxHCLK: 170, waitStates: 4 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

const STM32F1_CONSTRAINTS: IClockConstraints = {
	family: 'STM32F1',
	hseRange: [4, 16],
	pllInputRange: [1, 16],
	vcoRange: [16, 72],
	sysclkMax: 72,
	apb1Max: 36,
	apb2Max: 72,
	mRange: [1, 2],
	nRange: [2, 16],
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 24, waitStates: 0 },
		{ maxHCLK: 48, waitStates: 1 },
		{ maxHCLK: 72, waitStates: 2 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0 },
	],
};
