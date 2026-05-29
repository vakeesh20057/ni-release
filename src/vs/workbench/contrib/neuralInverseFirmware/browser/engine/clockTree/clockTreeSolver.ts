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

	solve(hseMHz: number, target: IClockTarget, family: string, maxResults: number = 5): IClockSolution[] {
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
}
