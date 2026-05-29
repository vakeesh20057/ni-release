/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Memory layout agent tools
 *
 * Generates linker scripts, analyzes memory budget, and detects
 * stack overflow risk. All from MCU database memory maps.
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { LinkerScriptGenerator } from '../memory/linkerScriptGenerator.js';

export function buildMemoryTools(session: IFirmwareSessionService): IVoidInternalTool[] {
	const generator = new LinkerScriptGenerator(session);

	return [
		_fwGenerateLinkerScript(session, generator),
		_fwMemoryLayout(session),
		_fwCheckStackOverflowRisk(session),
	];
}


function _fwGenerateLinkerScript(session: IFirmwareSessionService, generator: LinkerScriptGenerator): IVoidInternalTool {
	return {
		name: 'fw_generate_linker_script',
		description: 'Generate a complete GNU linker script (.ld) for the active MCU. Computes memory regions from the MCU database (FLASH, RAM, CCM/DTCM if applicable), sets stack/heap sizes based on RTOS configuration, and adds DMA-safety comments for non-DMA-accessible regions. Output is ready to save as STM32xxx_FLASH.ld.',
		params: {
			stackSize: { description: 'Stack size in bytes. Default: 2048 (0x800) for FreeRTOS, 1024 (0x400) for bare-metal.' },
			heapSize: { description: 'Heap size in bytes. Default: 16384 (0x4000) for FreeRTOS, 512 (0x200) for bare-metal.' },
			rtos: { description: 'RTOS in use: "freertos", "zephyr", or "none". Adjusts stack/heap defaults.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive || !s.mcuConfig) { return 'No active firmware session with MCU configured.'; }

			const config: any = {};
			if (typeof args.stackSize === 'number') { config.stackSize = args.stackSize; }
			if (typeof args.heapSize === 'number') { config.heapSize = args.heapSize; }
			if (args.rtos) { config.rtos = args.rtos; }

			return generator.generate(config);
		},
	};
}


function _fwMemoryLayout(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_memory_layout',
		description: 'Show the complete memory layout for the active MCU: all memory regions with origin, size, attributes, and DMA accessibility. Includes warnings about non-DMA-accessible regions (CCM RAM on STM32F4, DTCM on F7/H7) where placing DMA buffers would silently fail.',
		params: {},
		execute: async () => {
			const s = session.session;
			if (!s.isActive || !s.mcuConfig) { return 'No active firmware session.'; }

			const mcu = s.mcuConfig;
			const family = mcu.family?.toUpperCase() ?? '';
			const lines = [
				`Memory layout for ${mcu.family} ${mcu.variant}:`,
				'',
				'Region        Origin       Size         DMA    Notes',
				'──────────────────────────────────────────────────────────────────',
				`FLASH         0x08000000   ${(mcu.flashSize / 1024).toString().padStart(5)}K       n/a    Code + read-only data`,
				`RAM           0x20000000   ${(mcu.ramSize / 1024).toString().padStart(5)}K       YES    Main SRAM (data, bss, heap, stack)`,
			];

			// Add family-specific regions
			if (family.startsWith('STM32F4') && mcu.ramSize > 128 * 1024) {
				lines.push(`CCMRAM        0x10000000      64K       NO     Core-Coupled Memory (CPU only)`);
				lines.push('');
				lines.push('WARNING: CCMRAM is NOT accessible by DMA. Never place DMA buffers');
				lines.push('         in CCMRAM. Use __attribute__((section(".ccmram"))) only for');
				lines.push('         CPU-intensive data (lookup tables, stack for computations).');
			}

			if (family.startsWith('STM32F7')) {
				lines.push(`DTCM          0x20000000     128K       NO     Data TCM (CPU only, zero-wait-state)`);
				lines.push(`SRAM1         0x20020000     240K       YES    Main SRAM`);
				lines.push(`SRAM2         0x2007C000      16K       YES    SRAM2 (backup-domain accessible)`);
				lines.push('');
				lines.push('WARNING: DTCM at 0x20000000 is NOT DMA-accessible on STM32F7.');
				lines.push('         Place DMA buffers in SRAM1 (0x20020000+) explicitly.');
			}

			if (family.startsWith('STM32H7')) {
				lines.push(`DTCM          0x20000000     128K       NO     Data TCM (CPU only)`);
				lines.push(`AXI_SRAM      0x24000000     512K       YES    AXI SRAM (DMA-accessible)`);
				lines.push(`SRAM1         0x30000000     128K       YES    SRAM1 (D2 domain)`);
				lines.push(`SRAM2         0x30020000     128K       YES    SRAM2 (D2 domain)`);
				lines.push(`SRAM3         0x30040000      32K       YES    SRAM3 (D2 domain)`);
				lines.push(`SRAM4         0x38000000      64K       YES    SRAM4 (D3 domain, backup)`);
				lines.push('');
				lines.push('WARNING: STM32H7 has complex memory domains. DMA1/DMA2 can only');
				lines.push('         access D2 SRAM (0x30000000). MDMA can access all domains.');
				lines.push('         Place Ethernet/USB buffers in SRAM1/SRAM2.');
			}

			if (family.startsWith('NRF52')) {
				lines.push(`RAM           0x20000000   ${(mcu.ramSize / 1024).toString().padStart(5)}K       YES    Main RAM`);
				lines.push('');
				lines.push('NOTE: nRF52 EasyDMA requires buffers in RAM (not flash/const).');
				lines.push('      SPI/UART/I2S buffers must be in RAM, not .rodata.');
			}

			lines.push('');
			lines.push(`Total FLASH: ${(mcu.flashSize / 1024).toFixed(0)} KB`);
			lines.push(`Total RAM:   ${(mcu.ramSize / 1024).toFixed(0)} KB`);
			lines.push('');
			lines.push('Use fw_generate_linker_script to generate the .ld file for this layout.');

			return lines.join('\n');
		},
	};
}


function _fwCheckStackOverflowRisk(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_check_stack_overflow_risk',
		description: 'Analyze stack overflow risk based on configured stack size, RTOS task stacks, and available RAM. Returns risk level (safe/tight/overflow-likely) with recommendations. For detailed per-function stack analysis, use fw_analyze_stack_usage after building.',
		params: {
			mainStackSize: { description: 'Main stack size in bytes. Default: 2048.' },
			taskCount: { description: 'Number of FreeRTOS/Zephyr tasks. Default: 0 (bare-metal).' },
			taskStackSize: { description: 'Default per-task stack size in bytes. Default: 512.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive || !s.mcuConfig) { return 'No active firmware session.'; }

			const ramSize = s.mcuConfig.ramSize;
			const mainStack = typeof args.mainStackSize === 'number' ? args.mainStackSize : 2048;
			const taskCount = typeof args.taskCount === 'number' ? args.taskCount : 0;
			const taskStack = typeof args.taskStackSize === 'number' ? args.taskStackSize : 512;
			const rtos = s.rtos ?? 'none';

			const totalStackNeeded = mainStack + (taskCount * taskStack);
			const overheadEstimate = ramSize * 0.1; // .data + .bss ~10% estimate
			const heapEstimate = rtos === 'freertos' ? 16384 : 512;
			const totalNeeded = totalStackNeeded + overheadEstimate + heapEstimate;
			const remaining = ramSize - totalNeeded;
			const usagePercent = (totalNeeded / ramSize) * 100;

			let riskLevel: string;
			let recommendation: string;

			if (remaining < 0) {
				riskLevel = 'OVERFLOW LIKELY';
				recommendation = `RAM budget exceeded by ${Math.abs(remaining)} bytes. Reduce task count, stack sizes, or heap.`;
			} else if (usagePercent > 90) {
				riskLevel = 'TIGHT';
				recommendation = `Only ${remaining} bytes free (${(100 - usagePercent).toFixed(1)}%). Consider reducing heap or task stacks. Enable stack overflow detection.`;
			} else if (usagePercent > 75) {
				riskLevel = 'MODERATE';
				recommendation = `${remaining} bytes free. Adequate for typical use but enable configCHECK_FOR_STACK_OVERFLOW in FreeRTOS.`;
			} else {
				riskLevel = 'SAFE';
				recommendation = `${remaining} bytes free (${(100 - usagePercent).toFixed(1)}% headroom). Stack allocation is conservative.`;
			}

			const lines = [
				`Stack overflow risk: ${riskLevel}`,
				'',
				`MCU RAM: ${ramSize} bytes (${(ramSize / 1024).toFixed(0)} KB)`,
				'',
				'Estimated RAM budget:',
				`  Main stack:     ${mainStack} bytes`,
			];

			if (taskCount > 0) {
				lines.push(`  Task stacks:    ${taskCount} x ${taskStack} = ${taskCount * taskStack} bytes`);
			}

			lines.push(`  .data + .bss:   ~${Math.round(overheadEstimate)} bytes (estimated)`);
			lines.push(`  Heap:           ${heapEstimate} bytes`);
			lines.push(`  ────────────────────────────`);
			lines.push(`  Total needed:   ${Math.round(totalNeeded)} bytes (${usagePercent.toFixed(1)}%)`);
			lines.push(`  Remaining:      ${Math.round(remaining)} bytes`);
			lines.push('');
			lines.push(`Recommendation: ${recommendation}`);

			if (rtos === 'freertos') {
				lines.push('');
				lines.push('FreeRTOS tips:');
				lines.push('  - Set configCHECK_FOR_STACK_OVERFLOW = 2 during development');
				lines.push('  - Use uxTaskGetStackHighWaterMark() to measure actual usage');
				lines.push('  - Minimum task stack: 128 bytes (no printf/float), 512+ with printf');
			}

			return lines.join('\n');
		},
	};
}
