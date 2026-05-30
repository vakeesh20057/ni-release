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
		_fwGetClockConstraints(session, validator, solver),
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

			// Fixed-clock families: no PLL solver needed
			const fixedNote = solver.getFixedClockNote(family);
			if (fixedNote) {
				return [`${family} does not use a configurable PLL solver.`, '', fixedNote].join('\n');
			}

			const solutions = solver.solve(hseMHz, target, family, maxResults);

			if (solutions.length === 0) {
				return [
					`No valid PLL configuration found for SYSCLK = ${targetMHz} MHz with ${family.toUpperCase().startsWith('RP20') ? `XTAL = ${hseMHz} MHz` : `HSE = ${hseMHz} MHz`}${needUSB ? ' + USB 48MHz' : ''}.`,
					'',
					'Suggestions:',
					`  - Try a different target frequency`,
					`  - Check if the target exceeds the MCU maximum for ${family}`,
					needUSB ? `  - Try with needUSB: false if USB is not used` : '',
				].filter(Boolean).join('\n');
			}

			const fam = family.toUpperCase();
			const isRP2040 = fam.startsWith('RP20');
			const isSAM = fam.startsWith('SAM') || fam.startsWith('ATSAM');
			const isKinetis = fam.startsWith('MK') || fam.startsWith('KINETIS');
			const isRenesas = fam.startsWith('RA') || fam.startsWith('R7FA');

			const lines = [
				`Found ${solutions.length} valid PLL configuration(s) for SYSCLK = ${targetMHz} MHz:`,
				`(${isRP2040 ? `XTAL = ${hseMHz} MHz` : `HSE = ${hseMHz} MHz`}, family = ${family}${needUSB ? ', USB = 48 MHz required' : ''})`,
				'',
			];

			for (let i = 0; i < solutions.length; i++) {
				const sol = solutions[i];
				lines.push(`── Solution ${i + 1} ${i === 0 ? '(RECOMMENDED)' : ''} ──`);

				if (isRP2040) {
					lines.push(`  FBDIV = ${sol.pll.n}, POSTDIV1 = ${sol.pll.p}, POSTDIV2 = ${sol.pll.q}`);
					lines.push(`  VCO = ${sol.vcoMHz} MHz, SYSCLK = ${sol.sysclkMHz} MHz`);
				} else if (isSAM) {
					lines.push(`  FDPLL: LDR = ${sol.pll.n}, LDRFRAC = ${sol.pll.q}, REFCLK_DIV = ${sol.pll.m}`);
					lines.push(`  ref = ${sol.pllInputMHz.toFixed(3)} MHz, SYSCLK = ${sol.sysclkMHz.toFixed(3)} MHz`);
				} else if (isKinetis) {
					lines.push(`  PRDIV = ${sol.pll.m}, VDIV = ${sol.pll.n}, PLL output = ${sol.vcoMHz} MHz`);
					lines.push(`  Core = ${sol.sysclkMHz} MHz, Bus = ${sol.apb1MHz} MHz, Flash = ${sol.apb2MHz} MHz`);
				} else if (isRenesas) {
					lines.push(`  PLLM = ${sol.pll.m}, PLLN = ${sol.pll.n}, PLLP = ${sol.pll.p}`);
					lines.push(`  VCO = ${sol.vcoMHz} MHz, SYSCLK = ${sol.sysclkMHz} MHz`);
				} else {
					lines.push(`  PLLM = ${sol.pll.m}, PLLN = ${sol.pll.n}, PLLP = ${sol.pll.p}, PLLQ = ${sol.pll.q}`);
					lines.push(`  VCO = ${sol.vcoMHz} MHz | PLL48CLK = ${sol.pll48MHz?.toFixed(2) ?? 'N/A'} MHz`);
				}

				lines.push(`  SYSCLK = ${sol.sysclkMHz} MHz | APB1 = ${sol.apb1MHz} MHz | APB2 = ${sol.apb2MHz} MHz`);
				lines.push(`  Flash wait states: ${sol.flashWaitStates}`);
				if (sol.warnings.length > 0) {
					for (const w of sol.warnings) { lines.push(`  [!] ${w}`); }
				}
				lines.push('');
			}

			// Generate ready-to-paste code for best solution
			const best = solutions[0];
			lines.push('Ready-to-paste code (solution 1):');
			lines.push('```c');

			if (isRP2040) {
				lines.push(`/* RP2040/RP2350 PLL setup via SDK (pico-sdk) */`);
				lines.push(`set_sys_clock_pll(PICO_PLL_VCO_MIN_FREQ_MHZ * MHZ, ${best.pll.p}, ${best.pll.q});`);
				lines.push(`/* Or manually: */`);
				lines.push(`pll_init(pll_sys, 1, ${best.vcoMHz}MHZ, ${best.pll.p}, ${best.pll.q});`);
				lines.push(`clock_configure(clk_sys, CLOCKS_CLK_SYS_CTRL_SRC_VALUE_CLKSRC_CLK_SYS_AUX,`);
				lines.push(`    CLOCKS_CLK_SYS_CTRL_AUXSRC_VALUE_CLKSRC_PLL_SYS, ${best.vcoMHz}MHZ, ${best.sysclkMHz}MHZ);`);
			} else if (isSAM) {
				lines.push(`/* SAM FDPLL configuration */`);
				lines.push(`OSCCTRL->DPLLRATIO.reg = OSCCTRL_DPLLRATIO_LDR(${best.pll.n}) | OSCCTRL_DPLLRATIO_LDRFRAC(${best.pll.q});`);
				lines.push(`OSCCTRL->DPLLCTRLB.reg = OSCCTRL_DPLLCTRLB_REFCLK(OSCCTRL_DPLLCTRLB_REFCLK_XOSC_Val);`);
				lines.push(`OSCCTRL->DPLLCTRLA.reg = OSCCTRL_DPLLCTRLA_ENABLE;`);
				lines.push(`while (!(OSCCTRL->DPLLSTATUS.reg & OSCCTRL_DPLLSTATUS_CLKRDY)) {}`);
				lines.push(`GCLK->GENCTRL[0].reg = GCLK_GENCTRL_SRC_DPLL96M | GCLK_GENCTRL_GENEN;`);
			} else if (isKinetis) {
				lines.push(`/* Kinetis MCG PLL configuration */`);
				lines.push(`MCG->C5 = MCG_C5_PRDIV0(${best.pll.m - 1}); /* PRDIV = ${best.pll.m} */`);
				lines.push(`MCG->C6 = MCG_C6_PLLS_MASK | MCG_C6_VDIV0(${best.pll.n - 24}); /* VDIV = ${best.pll.n} */`);
				lines.push(`while (!(MCG->S & MCG_S_PLLST_MASK)) {} /* wait for PLL */`);
				lines.push(`while (!(MCG->S & MCG_S_LOCK0_MASK)) {} /* wait for lock */`);
			} else if (isRenesas) {
				lines.push(`/* Renesas RA PLL configuration */`);
				lines.push(`R_SYSTEM->PLLCR = R_SYSTEM_PLLCR_PLLM_Msk & ((${best.pll.m} - 1U) << R_SYSTEM_PLLCR_PLLM_Pos)`);
				lines.push(`                | R_SYSTEM_PLLCR_PLLN_Msk & ((${best.pll.n} - 1U) << R_SYSTEM_PLLCR_PLLN_Pos)`);
				lines.push(`                | R_SYSTEM_PLLCR_PLLP_Msk & ((${best.pll.p === 1 ? 0 : best.pll.p === 2 ? 1 : 3}U) << R_SYSTEM_PLLCR_PLLP_Pos);`);
				lines.push(`R_SYSTEM->PLLCR2 = 0U; /* enable PLL */`);
				lines.push(`FSP_HARDWARE_REGISTER_WAIT(R_SYSTEM->OSCSF_b.PLLSF, 1U);`);
			} else {
				// STM32
				lines.push(`RCC->PLLCFGR = (${best.pll.m} << RCC_PLLCFGR_PLLM_Pos)`);
				lines.push(`             | (${best.pll.n} << RCC_PLLCFGR_PLLN_Pos)`);
				lines.push(`             | (${(best.pll.p / 2) - 1} << RCC_PLLCFGR_PLLP_Pos)`);
				lines.push(`             | (${best.pll.q} << RCC_PLLCFGR_PLLQ_Pos)`);
				lines.push(`             | RCC_PLLCFGR_PLLSRC_HSE;`);
				lines.push(`FLASH->ACR = FLASH_ACR_LATENCY_${best.flashWaitStates}WS | FLASH_ACR_PRFTEN | FLASH_ACR_ICEN | FLASH_ACR_DCEN;`);
			}

			lines.push('```');
			return lines.join('\n');
		},
	};
}


function _fwGetClockConstraints(session: IFirmwareSessionService, validator: ClockTreeValidatorService, solver: ClockTreeSolver): IVoidInternalTool {
	return {
		name: 'fw_get_clock_constraints',
		description: 'Return the complete clock constraint table for the active MCU family: PLL input range, VCO range, SYSCLK max, APB limits, flash wait state table, and peripheral clock requirements. Use before configuring clocks to understand the boundaries.',
		params: {},
		execute: async () => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const family = s.mcuConfig?.family ?? 'STM32F4';
			const fam = family.toUpperCase();
			const c = validator.getConstraints(family);
			const fixedNote = solver.getFixedClockNote(family);

			let mLabel = 'PLLM'; let nLabel = 'PLLN'; let pLabel = 'PLLP values'; let qLabel = 'PLLQ';
			if (fam.startsWith('RP20')) { mLabel = 'REFDIV'; nLabel = 'FBDIV'; pLabel = 'POSTDIV1 values'; qLabel = 'POSTDIV2'; }
			else if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) { mLabel = 'REFCLK_DIV'; nLabel = 'LDR'; pLabel = 'PLLP values'; qLabel = 'LDRFRAC'; }
			else if (fam.startsWith('MK') || fam.startsWith('KINETIS')) { mLabel = 'PRDIV'; nLabel = 'VDIV'; pLabel = 'Core div'; qLabel = 'N/A'; }
			else if (fam.startsWith('TMS320') || fam.startsWith('C2000')) { mLabel = 'N/A'; nLabel = 'IMULT'; pLabel = 'ODIV values'; qLabel = 'N/A'; }
			else if (fam.startsWith('TC') || fam.startsWith('AURIX')) { mLabel = 'PDIV'; nLabel = 'NDIV'; pLabel = 'K2DIV values'; qLabel = 'K3DIV'; }

			const lines: string[] = [
				`Clock constraints for ${c.family}:`,
				fixedNote ? `NOTE: ${fixedNote.split('\n')[0]}` : '',
				'',
				'PLL Configuration Limits:',
				`  ${fam.startsWith('RP20') ? 'XTAL' : 'Oscillator'} range: ${c.hseRange[0]}-${c.hseRange[1]} MHz`,
				`  PLL input range: ${c.pllInputRange[0]}-${c.pllInputRange[1]} MHz`,
				`  VCO range:       ${c.vcoRange[0]}-${c.vcoRange[1]} MHz`,
				`  ${mLabel.padEnd(14)}: ${c.mRange[0]}-${c.mRange[1]}`,
				`  ${nLabel.padEnd(14)}: ${c.nRange[0]}-${c.nRange[1]}`,
				`  ${pLabel.padEnd(14)}: ${c.pValues.slice(0, 8).join(', ')}${c.pValues.length > 8 ? '...' : ''}`,
				`  ${qLabel.padEnd(14)}: ${c.qRange[0]}-${c.qRange[1]}`,
				'',
				'Bus Frequency Limits:',
				`  SYSCLK max: ${c.sysclkMax} MHz`,
				`  APB1 max:   ${c.apb1Max} MHz`,
				`  APB2 max:   ${c.apb2Max} MHz`,
				'',
				'Flash Wait States:',
			].filter(l => l !== '');

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
