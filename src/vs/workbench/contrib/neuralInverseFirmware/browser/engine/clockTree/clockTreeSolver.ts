/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Clock Tree Constraint Solver
 *
 * Finds valid PLL configurations for a target SYSCLK that also satisfy
 * peripheral clock requirements (USB 48MHz, flash wait states, bus limits).
 * Bounded integer search — always terminates, no LLM calls.
 */

import { IClockConstraints, IClockSolution, IPLLConfig } from './clockTreeTypes.js';
import { ClockTreeValidatorService } from './clockTreeValidatorService.js';

export interface IClockTarget {
	sysclkMHz: number;
	usb48Required: boolean;
	i2sClockMHz?: number;
	ahbPrescaler?: number;
	apb1Prescaler?: number;
	apb2Prescaler?: number;
}

export class ClockTreeSolver {
	private readonly _validator = new ClockTreeValidatorService();

	/** Returns a human-readable note when a family has a fixed/non-PLL clock. Null means "use the solver". */
	getFixedClockNote(family: string): string | null {
		const fam = family.toUpperCase();
		if (fam.startsWith('NRF')) {
			return `nRF52/53/91 clock is sourced from internal HFOSC (64 MHz) or external HFXO (32 MHz).\nNo PLL solver needed. Use NRF_CLOCK->HFCLKCTRL and nrfx_clock API:\n  nrfx_clock_hfclk_start(); // start HFXO\n  while (!nrfx_clock_hfclk_is_running()) {} // wait for ready`;
		}
		if (fam.startsWith('ESP32') || fam.startsWith('ESP8266')) {
			return `ESP32 clock is managed by the IDF. CPU frequency set via:\n  esp_pm_config_esp32_t pm_config = { .max_freq_mhz = 240, .min_freq_mhz = 80 };\n  esp_pm_configure(&pm_config);\nOr for C3/S3/H2/C6: use CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ in sdkconfig.`;
		}
		if (fam.startsWith('RP20')) {
			return null; // RP2040/RP2350 has a real PLL solver (FBDIV/POSTDIV1/POSTDIV2)
		}
		if (fam.startsWith('ATMEGA') || fam.startsWith('ATTINY') || fam.startsWith('AVR')) {
			return `AVR clock is selected by fuse bits (CKSEL[3:0]) at programming time, not at runtime.\nCommon options: internal RC 8 MHz, external crystal up to 20 MHz.\nFuse bytes: LFUSE = 0xFF (full-swing crystal), HFUSE = 0xD9 (default).`;
		}
		return null;
	}

	solve(hseMHz: number, target: IClockTarget, family: string, maxResults: number = 5): IClockSolution[] {
		const fam = family.toUpperCase();

		// RP2040/RP2350: uses FBDIV/POSTDIV1/POSTDIV2, not M/N/P/Q
		if (fam.startsWith('RP20')) {
			return this._solveRP2040(hseMHz, target, fam, maxResults);
		}

		// SAM FDPLL: uses LDR/LDRFRAC (integer + 4-bit fractional)
		if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
			return this._solveSAMDPLL(hseMHz, target, fam, maxResults);
		}

		// Kinetis: VDIV=24..55, PRDIV=1..8 — VCO = (fREF/PRDIV)*VDIV
		if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
			return this._solveKinetis(hseMHz, target, maxResults);
		}

		// Renesas RA: VCO = MOSC / PLLM * PLLN, output = VCO / PLLP
		if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
			return this._solveRenesas(hseMHz, target, maxResults);
		}

		const constraints = this._validator.getConstraints(family);
		const solutions: IClockSolution[] = [];

		const ahbPre = target.ahbPrescaler ?? 1;
		const apb1Pre = target.apb1Prescaler ?? this._guessAPB1Prescaler(target.sysclkMHz, constraints);
		const apb2Pre = target.apb2Prescaler ?? this._guessAPB2Prescaler(target.sysclkMHz, constraints);

		// Iterate over valid M values
		for (let m = constraints.mRange[0]; m <= constraints.mRange[1]; m++) {
			const pllInput = hseMHz / m;
			if (pllInput < constraints.pllInputRange[0] || pllInput > constraints.pllInputRange[1]) {
				continue;
			}

			// For each valid P value
			for (const p of constraints.pValues) {
				// Target VCO = SYSCLK * P
				const targetVCO = target.sysclkMHz * p;
				if (targetVCO < constraints.vcoRange[0] || targetVCO > constraints.vcoRange[1]) {
					continue;
				}

				// N = VCO / pllInput — must be integer
				const nExact = targetVCO / pllInput;
				const n = Math.round(nExact);
				if (Math.abs(n - nExact) > 0.001) { continue; } // Not integer
				if (n < constraints.nRange[0] || n > constraints.nRange[1]) { continue; }

				// Verify SYSCLK = VCO / P
				const actualVCO = pllInput * n;
				const actualSysclk = actualVCO / p;
				if (Math.abs(actualSysclk - target.sysclkMHz) > 0.01) { continue; }

				// Find Q for USB if required
				let q: number;
				if (target.usb48Required) {
					const qExact = actualVCO / 48;
					q = Math.round(qExact);
					if (q < constraints.qRange[0] || q > constraints.qRange[1]) { continue; }
					const actualPLL48 = actualVCO / q;
					if (Math.abs(actualPLL48 - 48) > 0.12) { continue; } // 0.25% tolerance
				} else {
					q = Math.max(constraints.qRange[0], Math.round(actualVCO / 48));
					q = Math.min(q, constraints.qRange[1]);
				}

				const pll: IPLLConfig = { m, n, p, q };

				// Full validation
				const result = this._validator.validate(pll, hseMHz, ahbPre, apb1Pre, apb2Pre, family);
				if (!result.valid) { continue; }

				// Score: prefer VCO in center of range, lower Q, standard prescalers
				const vcoCenter = (constraints.vcoRange[0] + constraints.vcoRange[1]) / 2;
				const vcoPenalty = Math.abs(result.computedValues.vcoMHz - vcoCenter) / vcoCenter;
				const qPenalty = q * 0.01;
				const score = vcoPenalty + qPenalty;

				solutions.push({
					pll,
					sysclkMHz: result.computedValues.sysclkMHz,
					hclkMHz: result.computedValues.hclkMHz,
					apb1MHz: result.computedValues.apb1MHz,
					apb2MHz: result.computedValues.apb2MHz,
					pll48MHz: result.computedValues.pll48MHz,
					flashWaitStates: result.computedValues.flashWaitStates,
					vcoMHz: result.computedValues.vcoMHz,
					pllInputMHz: result.computedValues.pllInputMHz,
					score,
					warnings: result.warnings.map(w => w.message),
				});
			}
		}

		// Sort by score (lower is better) and return top N
		solutions.sort((a, b) => a.score - b.score);
		return solutions.slice(0, maxResults);
	}

	private _guessAPB1Prescaler(sysclkMHz: number, constraints: IClockConstraints): number {
		if (sysclkMHz <= constraints.apb1Max) { return 1; }
		if (sysclkMHz / 2 <= constraints.apb1Max) { return 2; }
		if (sysclkMHz / 4 <= constraints.apb1Max) { return 4; }
		if (sysclkMHz / 8 <= constraints.apb1Max) { return 8; }
		return 16;
	}

	private _guessAPB2Prescaler(sysclkMHz: number, constraints: IClockConstraints): number {
		if (sysclkMHz <= constraints.apb2Max) { return 1; }
		if (sysclkMHz / 2 <= constraints.apb2Max) { return 2; }
		return 4;
	}

	/** RP2040/RP2350 PLL solver: sysclk = XTAL(12MHz) * FBDIV / (POSTDIV1 * POSTDIV2) */
	private _solveRP2040(hseMHz: number, target: IClockTarget, fam: string, maxResults: number): IClockSolution[] {
		const xtal = hseMHz > 0 ? hseMHz : 12;  // RP2040 Pico always uses 12 MHz XTAL
		const maxSysclk = fam.startsWith('RP2350') ? 150 : 133;
		const targetMHz = Math.min(target.sysclkMHz, maxSysclk);
		const solutions: IClockSolution[] = [];

		for (let postdiv1 = 1; postdiv1 <= 7; postdiv1++) {
			for (let postdiv2 = 1; postdiv2 <= postdiv1; postdiv2++) {  // postdiv2 <= postdiv1 for efficiency
				const fbdivExact = (targetMHz * postdiv1 * postdiv2) / xtal;
				const fbdiv = Math.round(fbdivExact);
				if (fbdiv < 16 || fbdiv > 320) { continue; }
				if (Math.abs(fbdiv - fbdivExact) > 0.01) { continue; }

				const vcoMHz = xtal * fbdiv;
				if (vcoMHz < 750 || vcoMHz > 1600) { continue; }

				const actualSysclk = vcoMHz / (postdiv1 * postdiv2);
				if (Math.abs(actualSysclk - targetMHz) > 0.01) { continue; }

				const score = Math.abs(vcoMHz - 1000) / 1000 + postdiv1 * 0.01;
				solutions.push({
					pll: { m: 1, n: fbdiv, p: postdiv1, q: postdiv2 }, // reuse fields: n=FBDIV, p=POSTDIV1, q=POSTDIV2
					sysclkMHz: actualSysclk,
					hclkMHz: actualSysclk,
					apb1MHz: actualSysclk,
					apb2MHz: actualSysclk,
					flashWaitStates: 0,
					vcoMHz,
					pllInputMHz: xtal,
					score,
					warnings: vcoMHz > 1500 ? ['VCO near upper limit — consider increasing POSTDIV'] : [],
				});
			}
		}
		solutions.sort((a, b) => a.score - b.score);
		return solutions.slice(0, maxResults);
	}

	/** SAM FDPLL solver: f_clk_dpll = f_ckr * (LDR + 1 + LDRFRAC/16) where f_ckr = XOSC32K/REFCLK_DIV */
	private _solveSAMDPLL(hseMHz: number, target: IClockTarget, _fam: string, maxResults: number): IClockSolution[] {
		const solutions: IClockSolution[] = [];
		const targetMHz = Math.min(target.sysclkMHz, 120);

		// SAM DPLL ref can be XOSC32K (0.032 MHz) or XOSC. For XOSC (e.g. 8 MHz HSE):
		const refMHz = hseMHz > 0 ? hseMHz : 8;

		for (let refDiv = 1; refDiv <= 64; refDiv++) {
			const fckr = refMHz / refDiv;
			if (fckr < 0.032 || fckr > 2) { continue; }

			const ratioExact = targetMHz / fckr;
			const ldr = Math.floor(ratioExact) - 1;
			if (ldr < 0 || ldr > 4095) { continue; }

			const ldrfrac = Math.round((ratioExact - Math.floor(ratioExact)) * 16);
			const actualMHz = fckr * (ldr + 1 + ldrfrac / 16);
			if (Math.abs(actualMHz - targetMHz) > 0.1) { continue; }

			const flashWS = actualMHz <= 24 ? 0 : actualMHz <= 48 ? 1 : actualMHz <= 72 ? 2 : actualMHz <= 96 ? 3 : 4;
			solutions.push({
				pll: { m: refDiv, n: ldr, p: 1, q: ldrfrac },  // reuse: m=REFCLK_DIV, n=LDR, q=LDRFRAC
				sysclkMHz: actualMHz,
				hclkMHz: actualMHz,
				apb1MHz: actualMHz,
				apb2MHz: actualMHz,
				flashWaitStates: flashWS,
				vcoMHz: actualMHz,
				pllInputMHz: fckr,
				score: Math.abs(actualMHz - targetMHz) + refDiv * 0.01,
				warnings: ldrfrac !== 0 ? ['Fractional divider active — small frequency error possible'] : [],
			});
		}
		solutions.sort((a, b) => a.score - b.score);
		return solutions.slice(0, maxResults);
	}

	/** Kinetis MCG PLL solver: f_pll = (fOSC / PRDIV) * VDIV */
	private _solveKinetis(hseMHz: number, target: IClockTarget, maxResults: number): IClockSolution[] {
		const solutions: IClockSolution[] = [];
		const targetMHz = Math.min(target.sysclkMHz, 180);

		for (let prdiv = 1; prdiv <= 8; prdiv++) {
			const pllRef = hseMHz / prdiv;
			if (pllRef < 2 || pllRef > 4) { continue; }

			for (let vdiv = 24; vdiv <= 55; vdiv++) {
				const pllOut = pllRef * vdiv;
				const coreMHz = pllOut / 2;  // core clock = PLL / 2
				if (Math.abs(coreMHz - targetMHz) > 0.1) { continue; }
				if (coreMHz > 180) { continue; }

				const flashWS = coreMHz <= 50 ? 0 : coreMHz <= 100 ? 1 : coreMHz <= 150 ? 2 : 3;
				solutions.push({
					pll: { m: prdiv, n: vdiv, p: 2, q: 1 },  // p=2 (core=PLL/2)
					sysclkMHz: coreMHz,
					hclkMHz: coreMHz,
					apb1MHz: Math.min(coreMHz, 60),
					apb2MHz: Math.min(coreMHz, 90),
					flashWaitStates: flashWS,
					vcoMHz: pllOut,
					pllInputMHz: pllRef,
					score: Math.abs(coreMHz - targetMHz) + prdiv * 0.001,
					warnings: [],
				});
			}
		}
		solutions.sort((a, b) => a.score - b.score);
		return solutions.slice(0, maxResults);
	}

	/** Renesas RA PLL solver: f_pll = MOSC / PLLM * PLLN, f_out = f_pll / PLLP */
	private _solveRenesas(hseMHz: number, target: IClockTarget, maxResults: number): IClockSolution[] {
		const solutions: IClockSolution[] = [];
		const targetMHz = Math.min(target.sysclkMHz, 200);

		for (let pllm = 1; pllm <= 32; pllm++) {
			const pllIn = hseMHz / pllm;
			if (pllIn < 1 || pllIn > 25) { continue; }

			for (const pllp of [1, 2, 4]) {
				const pllnExact = (targetMHz * pllp * pllm) / hseMHz;
				const plln = Math.round(pllnExact);
				if (Math.abs(plln - pllnExact) > 0.01) { continue; }
				if (plln < 10 || plln > 240) { continue; }

				const vcoMHz = pllIn * plln;
				const actualMHz = vcoMHz / pllp;
				if (Math.abs(actualMHz - targetMHz) > 0.1) { continue; }
				if (vcoMHz < 80 || vcoMHz > 400) { continue; }

				const flashWS = actualMHz <= 50 ? 0 : actualMHz <= 100 ? 1 : actualMHz <= 150 ? 2 : 3;
				solutions.push({
					pll: { m: pllm, n: plln, p: pllp, q: 2 },
					sysclkMHz: actualMHz,
					hclkMHz: actualMHz,
					apb1MHz: Math.min(actualMHz / 2, 100),
					apb2MHz: Math.min(actualMHz / 2, 100),
					flashWaitStates: flashWS,
					vcoMHz,
					pllInputMHz: pllIn,
					score: Math.abs(actualMHz - targetMHz) + pllm * 0.001,
					warnings: [],
				});
			}
		}
		solutions.sort((a, b) => a.score - b.score);
		return solutions.slice(0, maxResults);
	}
}
