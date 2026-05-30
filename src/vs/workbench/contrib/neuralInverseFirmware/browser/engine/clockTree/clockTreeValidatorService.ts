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
		if (fam.startsWith('STM32L4') || fam.startsWith('STM32L5')) { return STM32L4_CONSTRAINTS; }
		if (fam.startsWith('STM32G0')) { return STM32G0_CONSTRAINTS; }
		if (fam.startsWith('STM32F1') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')) { return STM32F1_CONSTRAINTS; }
		if (fam.startsWith('STM32F0') || fam.startsWith('STM32L0') || fam.startsWith('STM32L1')) { return STM32F0_CONSTRAINTS; }

		if (fam.startsWith('NRF')) { return NRF_CONSTRAINTS; }
		if (fam.startsWith('RP2350')) { return RP2350_CONSTRAINTS; }
		if (fam.startsWith('RP20') || fam.startsWith('RP2040')) { return RP2040_CONSTRAINTS; }
		if (fam.startsWith('ESP') || fam === 'D1') { return ESP32_CONSTRAINTS; }
		if (fam.startsWith('MK') || fam.startsWith('KINETIS')) { return KINETIS_K_CONSTRAINTS; }
		if (fam.startsWith('RA') || fam.startsWith('R7FA') || fam.startsWith('R5F') || fam.startsWith('RL78') || fam.startsWith('RX')) { return RENESAS_RA_CONSTRAINTS; }
		if (fam.startsWith('MIMXRT') || fam.startsWith('I.MX RT')) { return IMXRT_CONSTRAINTS; }
		if (fam.startsWith('LPC')) { return LPC55_CONSTRAINTS; }
		if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) { return SAMD_CONSTRAINTS; }
		if (fam.startsWith('ATMEGA') || fam.startsWith('ATTINY') || fam.startsWith('AVR')) { return AVR_CONSTRAINTS; }
		if (fam.startsWith('TMS320') || fam.startsWith('C2000')) { return TI_C2000_CONSTRAINTS; }
		if (fam.startsWith('TC2') || fam.startsWith('TC3') || fam.startsWith('TC4') || fam.startsWith('AURIX')) { return AURIX_CONSTRAINTS; }
		if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) { return EFR32_CONSTRAINTS; }
		if (fam.startsWith('PSOC') || fam.startsWith('CY8C')) { return PSOC6_CONSTRAINTS; }
		// GD32 is STM32-compatible — use matching family constraints
		if (fam.startsWith('GD32F4') || fam.startsWith('GD32E5')) { return STM32F4_CONSTRAINTS; }
		if (fam.startsWith('GD32')) { return STM32F1_CONSTRAINTS; }

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

// STM32F0 / L0 / L1 — 48 MHz max, simple PLL (no PLLN/PLLM/PLLP fields)
const STM32F0_CONSTRAINTS: IClockConstraints = {
	family: 'STM32F0',
	hseRange: [4, 32],
	pllInputRange: [1, 24],
	vcoRange: [16, 48],
	sysclkMax: 48,
	apb1Max: 48,
	apb2Max: 48,
	mRange: [1, 1],    // no PLLM on F0/L0 — treated as /1
	nRange: [2, 16],   // PLLMUL x2..x16
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 24, waitStates: 0 },
		{ maxHCLK: 48, waitStates: 1 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.5 },
	],
};

// STM32G0 — 64 MHz max, PLLM/N/R structure
const STM32G0_CONSTRAINTS: IClockConstraints = {
	family: 'STM32G0',
	hseRange: [4, 48],
	pllInputRange: [2.66, 16],
	vcoRange: [64, 344],
	sysclkMax: 64,
	apb1Max: 64,
	apb2Max: 64,
	mRange: [1, 8],
	nRange: [8, 86],
	pValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
	qRange: [2, 8],
	flashWaitStates: [
		{ maxHCLK: 24, waitStates: 0 },
		{ maxHCLK: 48, waitStates: 1 },
		{ maxHCLK: 64, waitStates: 2 },
	],
	peripheralClockRequirements: [],
};

// STM32L4 / L5 — 80 MHz max (120 MHz for L4+ with boost), PLLM/N/R output
const STM32L4_CONSTRAINTS: IClockConstraints = {
	family: 'STM32L4',
	hseRange: [4, 48],
	pllInputRange: [4, 16],
	vcoRange: [64, 344],
	sysclkMax: 80,
	apb1Max: 80,
	apb2Max: 80,
	mRange: [1, 8],
	nRange: [8, 86],
	pValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
	qRange: [2, 8],
	flashWaitStates: [
		{ maxHCLK: 16, waitStates: 0, voltage: '1.8V range 1' },
		{ maxHCLK: 32, waitStates: 1, voltage: '1.8V range 1' },
		{ maxHCLK: 48, waitStates: 2, voltage: '1.8V range 1' },
		{ maxHCLK: 64, waitStates: 3, voltage: '1.8V range 1' },
		{ maxHCLK: 80, waitStates: 4, voltage: '1.8V range 1' },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
		{ peripheral: 'RNG', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

// nRF52/53 — fixed 64/128 MHz from HFCLK (no PLL solver applicable)
const NRF_CONSTRAINTS: IClockConstraints = {
	family: 'nRF',
	hseRange: [32, 32],    // 32 MHz HFXO
	pllInputRange: [32, 32],
	vcoRange: [64, 128],
	sysclkMax: 128,        // nRF5340 App core
	apb1Max: 128,
	apb2Max: 128,
	mRange: [1, 1],
	nRange: [1, 4],
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 128, waitStates: 0 }, // NVMC handles internally
	],
	peripheralClockRequirements: [],
};

// RP2040 / RP2350 — 133/150 MHz via integer/fractional PLL (sys_pll)
// VCO = XTAL(12 MHz) * FBDIV, then divided by POSTDIV1 * POSTDIV2
const RP2040_CONSTRAINTS: IClockConstraints = {
	family: 'RP2040',
	hseRange: [12, 12],
	pllInputRange: [5, 800],
	vcoRange: [750, 1600],
	sysclkMax: 133,
	apb1Max: 133,
	apb2Max: 133,
	mRange: [1, 1],        // REFDIV always 1
	nRange: [16, 320],     // FBDIV
	pValues: [1, 2, 3, 4, 5, 6, 7],  // POSTDIV1
	qRange: [1, 7],        // POSTDIV2
	flashWaitStates: [{ maxHCLK: 133, waitStates: 0 }],
	peripheralClockRequirements: [],
};

const RP2350_CONSTRAINTS: IClockConstraints = {
	...RP2040_CONSTRAINTS,
	family: 'RP2350',
	sysclkMax: 150,
	apb1Max: 150,
	apb2Max: 150,
};

// ESP32 — up to 240 MHz via internal PLL. APB is always 80 MHz.
const ESP32_CONSTRAINTS: IClockConstraints = {
	family: 'ESP32',
	hseRange: [26, 40],
	pllInputRange: [26, 40],
	vcoRange: [320, 480],
	sysclkMax: 240,
	apb1Max: 80,
	apb2Max: 80,
	mRange: [1, 1],
	nRange: [1, 1],
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [{ maxHCLK: 240, waitStates: 0 }],
	peripheralClockRequirements: [],
};

// Kinetis K / KL / KV — up to 180 MHz via MCG PLL (PRDIV + VDIV)
const KINETIS_K_CONSTRAINTS: IClockConstraints = {
	family: 'Kinetis K',
	hseRange: [3, 32],
	pllInputRange: [2, 4],
	vcoRange: [48, 200],
	sysclkMax: 180,
	apb1Max: 60,
	apb2Max: 90,
	mRange: [1, 8],
	nRange: [24, 55],
	pValues: [1, 2],
	qRange: [1, 16],
	flashWaitStates: [
		{ maxHCLK: 50,  waitStates: 0 },
		{ maxHCLK: 100, waitStates: 1 },
		{ maxHCLK: 150, waitStates: 2 },
		{ maxHCLK: 180, waitStates: 3 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB0', clockSource: 'PLL48CLK', requiredMHz: 48, tolerance: 0.25 },
	],
};

// Renesas RA6 — up to 200 MHz PLL (MOSC → PLL via PLLM/PLLN)
const RENESAS_RA_CONSTRAINTS: IClockConstraints = {
	family: 'Renesas RA',
	hseRange: [8, 24],
	pllInputRange: [1, 25],
	vcoRange: [80, 400],
	sysclkMax: 200,
	apb1Max: 100,
	apb2Max: 100,
	mRange: [1, 32],
	nRange: [10, 240],
	pValues: [1, 2, 4],
	qRange: [1, 4],
	flashWaitStates: [
		{ maxHCLK: 50,  waitStates: 0 },
		{ maxHCLK: 100, waitStates: 1 },
		{ maxHCLK: 150, waitStates: 2 },
		{ maxHCLK: 200, waitStates: 3 },
	],
	peripheralClockRequirements: [],
};

// NXP i.MX RT — 600 MHz to 1 GHz PLL via CCM
const IMXRT_CONSTRAINTS: IClockConstraints = {
	family: 'i.MX RT',
	hseRange: [24, 24],
	pllInputRange: [24, 24],
	vcoRange: [600, 1056],
	sysclkMax: 1000,
	apb1Max: 240,
	apb2Max: 240,
	mRange: [1, 1],
	nRange: [25, 44],
	pValues: [1],
	qRange: [1, 16],
	flashWaitStates: [{ maxHCLK: 1000, waitStates: 0 }],
	peripheralClockRequirements: [],
};

// NXP LPC55 — 150 MHz via System PLL (PDIV/MSEL)
const LPC55_CONSTRAINTS: IClockConstraints = {
	family: 'LPC55',
	hseRange: [1, 32],
	pllInputRange: [1, 25],
	vcoRange: [275, 550],
	sysclkMax: 150,
	apb1Max: 150,
	apb2Max: 150,
	mRange: [1, 256],
	nRange: [4, 2048],
	pValues: [2, 4, 8, 16, 32, 64],
	qRange: [1, 64],
	flashWaitStates: [
		{ maxHCLK: 11,  waitStates: 0 },
		{ maxHCLK: 22,  waitStates: 1 },
		{ maxHCLK: 33,  waitStates: 2 },
		{ maxHCLK: 100, waitStates: 5 },
		{ maxHCLK: 150, waitStates: 8 },
	],
	peripheralClockRequirements: [],
};

// Microchip SAM D/E/C/L — 48/120 MHz via DFLL48M or FDPLL
const SAMD_CONSTRAINTS: IClockConstraints = {
	family: 'SAM',
	hseRange: [0.032, 32],
	pllInputRange: [0.032, 2],
	vcoRange: [96, 200],
	sysclkMax: 120,
	apb1Max: 120,
	apb2Max: 120,
	mRange: [1, 512],
	nRange: [1, 8191],
	pValues: [1, 2],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 24,  waitStates: 0 },
		{ maxHCLK: 48,  waitStates: 1 },
		{ maxHCLK: 72,  waitStates: 2 },
		{ maxHCLK: 96,  waitStates: 3 },
		{ maxHCLK: 120, waitStates: 4 },
	],
	peripheralClockRequirements: [
		{ peripheral: 'USB', clockSource: 'DFLL48M', requiredMHz: 48, tolerance: 0.25 },
	],
};

// TI C2000 DSP — up to 200 MHz via SYSPLL (OSCCLK × IMULT / ODIV)
const TI_C2000_CONSTRAINTS: IClockConstraints = {
	family: 'C2000',
	hseRange: [10, 20],
	pllInputRange: [10, 20],
	vcoRange: [100, 400],
	sysclkMax: 200,
	apb1Max: 100,
	apb2Max: 200,
	mRange: [1, 1],
	nRange: [1, 40],
	pValues: [1, 2, 4, 8],
	qRange: [1, 8],
	flashWaitStates: [
		{ maxHCLK: 50,  waitStates: 0 },
		{ maxHCLK: 100, waitStates: 2 },
		{ maxHCLK: 150, waitStates: 3 },
		{ maxHCLK: 200, waitStates: 5 },
	],
	peripheralClockRequirements: [],
};

// AURIX TC2xx/TC3xx — up to 480 MHz via PLL0 (NDIV/PDIV/K2DIV)
const AURIX_CONSTRAINTS: IClockConstraints = {
	family: 'AURIX',
	hseRange: [8, 40],
	pllInputRange: [4, 40],
	vcoRange: [400, 800],
	sysclkMax: 480,
	apb1Max: 240,
	apb2Max: 240,
	mRange: [1, 16],
	nRange: [1, 128],
	pValues: [1, 2, 4, 8, 16, 32, 64],
	qRange: [1, 64],
	flashWaitStates: [{ maxHCLK: 480, waitStates: 0 }],
	peripheralClockRequirements: [],
};

// Silicon Labs EFR32 / EFM32 — up to 80 MHz via DPLL or HFRCO
const EFR32_CONSTRAINTS: IClockConstraints = {
	family: 'EFR32',
	hseRange: [4, 40],
	pllInputRange: [4, 40],
	vcoRange: [32, 160],
	sysclkMax: 80,
	apb1Max: 80,
	apb2Max: 80,
	mRange: [1, 2048],
	nRange: [7, 4095],
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 40, waitStates: 0 },
		{ maxHCLK: 80, waitStates: 1 },
	],
	peripheralClockRequirements: [],
};

// AVR (ATmega / ATtiny) — 8/16/20 MHz, internal RC or crystal, no user-configurable PLL
const AVR_CONSTRAINTS: IClockConstraints = {
	family: 'AVR',
	hseRange: [1, 20],
	pllInputRange: [1, 20],
	vcoRange: [8, 48],
	sysclkMax: 20,
	apb1Max: 20,
	apb2Max: 20,
	mRange: [1, 1],
	nRange: [1, 6],
	pValues: [1],
	qRange: [1, 1],
	flashWaitStates: [{ maxHCLK: 20, waitStates: 0 }],
	peripheralClockRequirements: [],
};

// PSoC 6 (Cypress/Infineon) — up to 150 MHz via PLL0/PLL1
const PSOC6_CONSTRAINTS: IClockConstraints = {
	family: 'PSoC 6',
	hseRange: [4, 33],
	pllInputRange: [4, 8],
	vcoRange: [200, 400],
	sysclkMax: 150,
	apb1Max: 100,
	apb2Max: 75,
	mRange: [1, 18],
	nRange: [8, 200],
	pValues: [2, 4, 8, 16],
	qRange: [1, 1],
	flashWaitStates: [
		{ maxHCLK: 25,  waitStates: 0 },
		{ maxHCLK: 50,  waitStates: 1 },
		{ maxHCLK: 75,  waitStates: 2 },
		{ maxHCLK: 100, waitStates: 3 },
		{ maxHCLK: 150, waitStates: 4 },
	],
	peripheralClockRequirements: [],
};
