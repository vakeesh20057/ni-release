/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPLLConfig {
	m: number;     // PLL input divider (HSE / M → PLL input, must be 1-2 MHz)
	n: number;     // PLL multiplier (PLL input * N → VCO, must stay in VCO range)
	p: number;     // Main output divider (VCO / P → SYSCLK)
	q: number;     // USB/SDIO divider (VCO / Q → PLL48CLK, must = 48 MHz for USB)
	r?: number;    // I2S/SAI divider (some families)
}

export interface IClockConstraints {
	family: string;
	hseRange: [number, number];       // [minMHz, maxMHz] for HSE crystal
	pllInputRange: [number, number];  // [min, max] MHz after M divider
	vcoRange: [number, number];       // [min, max] MHz for PLL VCO
	sysclkMax: number;                // Max SYSCLK in MHz
	apb1Max: number;                  // Max APB1 clock MHz
	apb2Max: number;                  // Max APB2 clock MHz
	mRange: [number, number];         // [min, max] for M divider
	nRange: [number, number];         // [min, max] for N multiplier
	pValues: number[];                // Valid P values (e.g. [2, 4, 6, 8])
	qRange: [number, number];         // [min, max] for Q divider
	flashWaitStates: IFlashWaitState[];
	peripheralClockRequirements: IPeripheralClockReq[];
}

export interface IFlashWaitState {
	maxHCLK: number;     // Max HCLK MHz for this wait state count
	waitStates: number;  // Number of wait states needed
	voltage?: string;    // Optional: voltage range (e.g. "2.7-3.6V")
}

export interface IPeripheralClockReq {
	peripheral: string;        // e.g. "USB_OTG_FS"
	clockSource: string;       // e.g. "PLL48CLK"
	requiredMHz: number;       // e.g. 48
	tolerance: number;         // e.g. 0.25 (% tolerance)
}

export interface IClockSolution {
	pll: IPLLConfig;
	sysclkMHz: number;
	hclkMHz: number;
	apb1MHz: number;
	apb2MHz: number;
	pll48MHz?: number;
	flashWaitStates: number;
	vcoMHz: number;
	pllInputMHz: number;
	score: number;             // Lower = better (penalty for VCO outside sweet spot)
	warnings: string[];
}

export interface IClockValidationResult {
	valid: boolean;
	errors: IClockViolation[];
	warnings: IClockViolation[];
	computedValues: {
		pllInputMHz: number;
		vcoMHz: number;
		sysclkMHz: number;
		hclkMHz: number;
		apb1MHz: number;
		apb2MHz: number;
		pll48MHz: number;
		flashWaitStates: number;
	};
}

export interface IClockViolation {
	field: string;
	message: string;
	actual: number;
	limit: number;
}
