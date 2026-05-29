/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Clock tree agent tools
 *
 * Validates PLL configurations, finds valid clock solutions, and reports
 * constraints. Prevents "hard fault on boot" from wrong wait states or
 * "USB not working" from wrong PLL48CLK.
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ClockTreeValidatorService } from '../clockTree/clockTreeValidatorService.js';
import { ClockTreeSolver, IClockTarget } from '../clockTree/clockTreeSolver.js';

export function buildClockTreeTools(session: IFirmwareSessionService): IVoidInternalTool[] {
	const validator = new ClockTreeValidatorService();
	const solver = new ClockTreeSolver();

	return [
		_fwValidateClockTree(session, validator),
		_fwSuggestClockConfig(session, solver),
		_fwGetClockConstraints(session, validator),
	];
}


function _fwValidateClockTree(session: IFirmwareSessionService, validator: ClockTreeValidatorService): IVoidInternalTool {
	return {
		name: 'fw_validate_clock_tree',
		description: 'Validate a PLL clock configuration against hardware constraints. Checks: PLL input range, VCO range, SYSCLK max, APB1/APB2 limits, USB 48MHz requirement, and flash wait states. Returns pass/fail with specific violations. Prevents hard faults from wrong clock configuration.',
		params: {
			m: { description: 'PLLM divider (HSE / M = PLL input). Required.' },
			n: { description: 'PLLN multiplier (PLL input * N = VCO). Required.' },
			p: { description: 'PLLP divider (VCO / P = SYSCLK). Required.' },
			q: { description: 'PLLQ divider (VCO / Q = PLL48CLK). Required.' },
			hseMHz: { description: 'HSE crystal frequency in MHz. Default: 8.' },
			ahbPrescaler: { description: 'AHB prescaler (1, 2, 4, ..., 512). Default: 1.' },
			apb1Prescaler: { description: 'APB1 prescaler (1, 2, 4, 8, 16). Default: 4.' },
			apb2Prescaler: { description: 'APB2 prescaler (1, 2, 4, 8, 16). Default: 2.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const m = typeof args.m === 'number' ? args.m : undefined;
			const n = typeof args.n === 'number' ? args.n : undefined;
			const p = typeof args.p === 'number' ? args.p : undefined;
			const q = typeof args.q === 'number' ? args.q : undefined;

			if (m === undefined || n === undefined || p === undefined || q === undefined) {
				return 'Required parameters: m, n, p, q (PLL dividers/multipliers).';
			}

			const hseMHz = typeof args.hseMHz === 'number' ? args.hseMHz : 8;
			const ahbPre = typeof args.ahbPrescaler === 'number' ? args.ahbPrescaler : 1;
			const apb1Pre = typeof args.apb1Prescaler === 'number' ? args.apb1Prescaler : 4;
			const apb2Pre = typeof args.apb2Prescaler === 'number' ? args.apb2Prescaler : 2;
			const family = s.mcuConfig?.family ?? 'STM32F4';

			const result = validator.validate({ m, n, p, q }, hseMHz, ahbPre, apb1Pre, apb2Pre, family);

			const lines = [
				`Clock Tree Validation: ${result.valid ? 'PASS' : 'FAIL'}`,
				'',
				'Computed frequencies:',
				`  PLL input:  ${result.computedValues.pllInputMHz.toFixed(2)} MHz (HSE ${hseMHz} / M ${m})`,
				`  VCO:        ${result.computedValues.vcoMHz.toFixed(1)} MHz (input * N ${n})`,
				`  SYSCLK:     ${result.computedValues.sysclkMHz.toFixed(1)} MHz (VCO / P ${p})`,
				`  HCLK:       ${result.computedValues.hclkMHz.toFixed(1)} MHz (SYSCLK / AHB ${ahbPre})`,
				`  APB1:       ${result.computedValues.apb1MHz.toFixed(1)} MHz (HCLK / ${apb1Pre})`,
				`  APB2:       ${result.computedValues.apb2MHz.toFixed(1)} MHz (HCLK / ${apb2Pre})`,
				`  PLL48CLK:   ${result.computedValues.pll48MHz.toFixed(2)} MHz (VCO / Q ${q})`,
				`  Flash WS:   ${result.computedValues.flashWaitStates}`,
				'',
			];

			if (result.errors.length > 0) {
				lines.push('ERRORS:');
				for (const err of result.errors) {
					lines.push(`  [X] ${err.message}`);
				}
				lines.push('');
			}

			if (result.warnings.length > 0) {
				lines.push('WARNINGS:');
				for (const warn of result.warnings) {
					lines.push(`  [!] ${warn.message}`);
				}
			}

			if (result.valid && result.warnings.length === 0) {
				lines.push('All constraints satisfied. Configuration is safe to use.');
				lines.push(`Required: FLASH->ACR = FLASH_ACR_LATENCY_${result.computedValues.flashWaitStates}WS;`);
			}

			return lines.join('\n');
		},
	};
}


function _fwSuggestClockConfig(session: IFirmwareSessionService, solver: ClockTreeSolver): IVoidInternalTool {
	return {
		name: 'fw_suggest_clock_config',
		description: 'Find valid PLL configurations for a target SYSCLK frequency. Solves the constraint satisfaction problem: finds all (M, N, P, Q) tuples that hit the target while staying within VCO range, satisfying USB 48MHz requirement, and computing correct flash wait states. Returns the top solutions ranked by optimality (lower jitter, center of VCO range).',
		params: {
			targetSysclkMHz: { description: 'Target SYSCLK frequency in MHz, e.g. 168, 72, 180, 480.' },
			hseMHz: { description: 'HSE crystal frequency in MHz. Default: 8.' },
			needUSB: { description: 'Set to true if USB is used (requires PLL48CLK = 48 MHz). Default: true.' },
			maxResults: { description: 'Number of solutions to return. Default: 3.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const targetMHz = typeof args.targetSysclkMHz === 'number' ? args.targetSysclkMHz : undefined;
			if (!targetMHz) { return 'Provide targetSysclkMHz, e.g. 168, 72, 480.'; }

			const hseMHz = typeof args.hseMHz === 'number' ? args.hseMHz : 8;
			const needUSB = args.needUSB !== false;
			const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 3;
			const family = s.mcuConfig?.family ?? 'STM32F4';

			const target: IClockTarget = {
				sysclkMHz: targetMHz,
				usb48Required: needUSB,
			};

			const solutions = solver.solve(hseMHz, target, family, maxResults);

			if (solutions.length === 0) {
				return [
					`No valid PLL configuration found for SYSCLK = ${targetMHz} MHz with HSE = ${hseMHz} MHz${needUSB ? ' + USB 48MHz' : ''}.`,
					'',
					'Suggestions:',
					`  - Try a different target (common: 72, 84, 100, 120, 168, 180, 216, 480)`,
					`  - Try with needUSB: false if USB is not used`,
					`  - Check if the target exceeds the MCU maximum for ${family}`,
				].join('\n');
			}

			const lines = [
				`Found ${solutions.length} valid PLL configuration(s) for SYSCLK = ${targetMHz} MHz:`,
				`(HSE = ${hseMHz} MHz, family = ${family}${needUSB ? ', USB = 48 MHz required' : ''})`,
				'',
			];

			for (let i = 0; i < solutions.length; i++) {
				const sol = solutions[i];
				lines.push(`── Solution ${i + 1} ${i === 0 ? '(RECOMMENDED)' : ''} ──`);
				lines.push(`  PLLM = ${sol.pll.m}, PLLN = ${sol.pll.n}, PLLP = ${sol.pll.p}, PLLQ = ${sol.pll.q}`);
				lines.push(`  SYSCLK = ${sol.sysclkMHz} MHz | HCLK = ${sol.hclkMHz} MHz`);
				lines.push(`  APB1 = ${sol.apb1MHz} MHz | APB2 = ${sol.apb2MHz} MHz`);
				lines.push(`  PLL48CLK = ${sol.pll48MHz?.toFixed(2)} MHz | VCO = ${sol.vcoMHz} MHz`);
				lines.push(`  Flash wait states: ${sol.flashWaitStates}`);
				if (sol.warnings.length > 0) {
					for (const w of sol.warnings) { lines.push(`  [!] ${w}`); }
				}
				lines.push('');
			}

			// Generate code for best solution
			const best = solutions[0];
			lines.push('Ready-to-paste code (solution 1):');
			lines.push('```c');
			lines.push(`RCC->PLLCFGR = (${best.pll.m} << RCC_PLLCFGR_PLLM_Pos)`);
			lines.push(`             | (${best.pll.n} << RCC_PLLCFGR_PLLN_Pos)`);
			lines.push(`             | (${(best.pll.p / 2) - 1} << RCC_PLLCFGR_PLLP_Pos)`);
			lines.push(`             | (${best.pll.q} << RCC_PLLCFGR_PLLQ_Pos)`);
			lines.push(`             | RCC_PLLCFGR_PLLSRC_HSE;`);
			lines.push(`FLASH->ACR = FLASH_ACR_LATENCY_${best.flashWaitStates}WS | FLASH_ACR_PRFTEN | FLASH_ACR_ICEN | FLASH_ACR_DCEN;`);
			lines.push('```');

			return lines.join('\n');
		},
	};
}


function _fwGetClockConstraints(session: IFirmwareSessionService, validator: ClockTreeValidatorService): IVoidInternalTool {
	return {
		name: 'fw_get_clock_constraints',
		description: 'Return the complete clock constraint table for the active MCU family: PLL input range, VCO range, SYSCLK max, APB limits, flash wait state table, and peripheral clock requirements. Use before configuring clocks to understand the boundaries.',
		params: {},
		execute: async () => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const family = s.mcuConfig?.family ?? 'STM32F4';
			const c = validator.getConstraints(family);

			const lines = [
				`Clock constraints for ${c.family}:`,
				'',
				'PLL Configuration Limits:',
				`  HSE range:      ${c.hseRange[0]}-${c.hseRange[1]} MHz`,
				`  PLL input:      ${c.pllInputRange[0]}-${c.pllInputRange[1]} MHz (HSE / M)`,
				`  VCO range:      ${c.vcoRange[0]}-${c.vcoRange[1]} MHz (input * N)`,
				`  PLLM:           ${c.mRange[0]}-${c.mRange[1]}`,
				`  PLLN:           ${c.nRange[0]}-${c.nRange[1]}`,
				`  PLLP values:    ${c.pValues.slice(0, 8).join(', ')}${c.pValues.length > 8 ? '...' : ''}`,
				`  PLLQ:           ${c.qRange[0]}-${c.qRange[1]}`,
				'',
				'Bus Frequency Limits:',
				`  SYSCLK max:     ${c.sysclkMax} MHz`,
				`  APB1 max:       ${c.apb1Max} MHz`,
				`  APB2 max:       ${c.apb2Max} MHz`,
				'',
				'Flash Wait States (at 2.7-3.6V):',
			];

			for (const ws of c.flashWaitStates) {
				lines.push(`  HCLK <= ${ws.maxHCLK} MHz → ${ws.waitStates} wait state(s)`);
			}

			if (c.peripheralClockRequirements.length > 0) {
				lines.push('');
				lines.push('Peripheral Clock Requirements:');
				for (const req of c.peripheralClockRequirements) {
					lines.push(`  ${req.peripheral}: ${req.clockSource} = ${req.requiredMHz} MHz (tolerance: ${req.tolerance}%)`);
				}
			}

			return lines.join('\n');
		},
	};
}
