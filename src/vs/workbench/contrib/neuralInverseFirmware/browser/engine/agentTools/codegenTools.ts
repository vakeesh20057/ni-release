/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Code generation agent tools — Phase 3
 *
 * Deterministic peripheral initialization code generation from SVD register data.
 * All generated code uses correct register names and offsets from session.registerMaps,
 * adds inline comments citing register name, offset, and bit position, and applies
 * MISRA C patterns (volatile, explicit cast, no magic numbers) when a compliance
 * framework is active.
 *
 * These tools are NOT LLM-based — they produce exact, cite-annotated output from
 * the hardware register map already loaded into the session.
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPeripheralRegisterMap } from '../../../common/firmwareTypes.js';


export function buildCodegenTools(sessionService: IFirmwareSessionService): IVoidInternalTool[] {
	return [
		_fwGeneratePeripheralInit(sessionService),
		_fwGenerateISR(sessionService),
		_fwGenerateDMAConfig(sessionService),
		_fwGenerateClockConfig(sessionService),
		_fwGenerateGPIOConfig(sessionService),
		_fwGenerateRTOSTask(sessionService),
	];
}


// ─── Tool implementations ─────────────────────────────────────────────────────

function _fwGeneratePeripheralInit(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_peripheral_init',
		description: 'Generate a peripheral initialization function in C from the SVD register map loaded in the session. Uses correct register names, offsets, and bit positions with inline comments. Applies MISRA C patterns (volatile pointer, explicit cast) when a compliance framework is active.',
		params: {
			peripheral: { description: 'Peripheral name as it appears in the register map, e.g. "USART1", "SPI2", "TIM3", "ADC1"' },
			options: { description: 'Optional JSON object with peripheral-specific options, e.g. {"baudRate": 115200, "mode": "async", "wordLength": 8, "stopBits": 1, "parity": "none"} for UART; {"clockDiv": 4, "mode": 0} for SPI; {"period": 1000, "prescaler": 7999} for timer' },
			language: { description: '"c" (default) or "rust"' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const periph = (args.peripheral as string | undefined)?.toUpperCase();
			if (!periph) { return 'Provide peripheral name, e.g. "USART1", "SPI2", "TIM3".'; }

			const regMap = s.registerMaps?.find(m => m.name.toUpperCase() === periph || m.groupName?.toUpperCase() === periph);
			if (!regMap) {
				const available = s.registerMaps?.map(m => m.name).join(', ') ?? 'none loaded';
				return `Peripheral "${periph}" not found in session register maps.\nAvailable: ${available}\n\nLoad a datasheet or SVD file first with fw_upload_datasheet.`;
			}

			const lang = (args.language as string | undefined) ?? 'c';
			const isMisra = s.complianceFrameworks?.some(f => f.startsWith('misra') || f === 'cert-c');
			let options: Record<string, any> = {};
			if (args.options) {
				try { options = typeof args.options === 'string' ? JSON.parse(args.options) : args.options; } catch { /* ignore */ }
			}

			return _generatePeriphInit(regMap, periph, lang, isMisra ?? false, options, s.mcuConfig?.family ?? '');
		},
	};
}


function _fwGenerateISR(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_isr',
		description: 'Generate an interrupt service routine (ISR) skeleton from the SVD interrupt table. Includes NVIC enable call, interrupt flag clear-first pattern (required by Cortex-M), and volatile flag for signaling to main loop. Uses exact interrupt names and IRQ numbers from the SVD.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1", "TIM3", "DMA1_Stream0"' },
			interruptName: { description: 'Specific interrupt name from SVD if the peripheral has multiple (e.g. "USART1_IRQn"). Auto-selected from first interrupt if omitted.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const periph = (args.peripheral as string | undefined)?.toUpperCase();
			if (!periph) { return 'Provide peripheral name, e.g. "USART1", "TIM3".'; }

			const regMap = s.registerMaps?.find(m => m.name.toUpperCase() === periph || m.groupName?.toUpperCase() === periph);
			if (!regMap) {
				return `Peripheral "${periph}" not found in session register maps. Load SVD or datasheet first.`;
			}

			const interrupts = regMap.interrupts ?? [];
			let irq = interrupts[0];
			if (args.interruptName) {
				const found = interrupts.find(i => i.name.toUpperCase() === (args.interruptName as string).toUpperCase());
				if (found) { irq = found; }
			}

			return _generateISR(regMap, irq, s.mcuConfig?.family ?? '');
		},
	};
}


function _fwGenerateDMAConfig(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_dma_config',
		description: 'Generate DMA channel/stream configuration code for a peripheral. Sets MSIZE/PSIZE, MINC/PINC, transfer direction, priority, and enables the stream. Uses register addresses from the SVD.',
		params: {
			peripheral: { description: 'Source/destination peripheral, e.g. "USART1", "SPI2", "ADC1"' },
			direction: { description: '"mem-to-periph" (TX) or "periph-to-mem" (RX). Default: "periph-to-mem"' },
			dataSize: { description: 'Data element size in bits: 8 (default), 16, or 32' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const periph = (args.peripheral as string | undefined)?.toUpperCase() ?? '';
			const dir = (args.direction as string | undefined) ?? 'periph-to-mem';
			const dataSize = typeof args.dataSize === 'number' ? args.dataSize : 8;

			const regMap = s.registerMaps?.find(m => m.name.toUpperCase() === periph || m.groupName?.toUpperCase() === periph);
			const dmaRegMap = s.registerMaps?.find(m => m.name.startsWith('DMA'));

			return _generateDMAConfig(periph, dir, dataSize, regMap, dmaRegMap, s.mcuConfig?.family ?? '');
		},
	};
}


function _fwGenerateClockConfig(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_clock_config',
		description: 'Generate a complete clock tree initialization function: HSE/HSI selection, PLL configuration, wait-for-lock, SYSCLK switch, AHB/APB prescalers, and flash wait states. Uses RCC register definitions from the SVD.',
		params: {
			targetMHz: { description: 'Target SYSCLK frequency in MHz. Defaults to session MCU maximum clock speed.' },
			source: { description: 'Clock source: "hse" (external crystal) or "hsi" (internal oscillator). Default: "hse"' },
			hseMHz: { description: 'HSE crystal frequency in MHz. Default: 8' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const targetMHz = typeof args.targetMHz === 'number' ? args.targetMHz : (s.mcuConfig?.clockMHz ?? 168);
			const source = (args.source as string | undefined) ?? 'hse';
			const hseMHz = typeof args.hseMHz === 'number' ? args.hseMHz : 8;

			const rccMap = s.registerMaps?.find(m => m.name === 'RCC' || m.groupName === 'RCC');
			return _generateClockConfig(targetMHz, source, hseMHz, rccMap, s.mcuConfig?.family ?? '', s.mcuConfig?.variant ?? '');
		},
	};
}


function _fwGenerateGPIOConfig(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_gpio_config',
		description: 'Generate GPIO pin configuration code (MODER, OTYPER, OSPEEDR, PUPDR, and AFR writes) with register offsets from the SVD. Correct alternate function numbers are sourced from the AF register enumerated values.',
		params: {
			pin: { description: 'GPIO pin in port-number format, e.g. "PA9", "PB6", "PC13"' },
			mode: { description: '"input", "output", "alternate" (for peripheral), or "analog". Default: "output"' },
			speed: { description: '"low", "medium", "high", or "very-high". Default: "medium"' },
			pull: { description: '"none", "up", or "down". Default: "none"' },
			af: { description: 'Alternate function number 0–15. Required when mode is "alternate". Auto-detected from SVD AF register if omitted.' },
			outputType: { description: '"push-pull" (default) or "open-drain"' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const pin = args.pin as string | undefined;
			if (!pin) { return 'Provide pin in port-number format, e.g. "PA9", "PB6".'; }

			const pinMatch = pin.toUpperCase().match(/^P([A-K])(\d+)$/);
			if (!pinMatch) { return `Invalid pin format "${pin}". Use PA9, PB6, PC13, etc.`; }

			const port = pinMatch[1];
			const pinNum = parseInt(pinMatch[2]);

			const mode = (args.mode as string | undefined) ?? 'output';
			const speed = (args.speed as string | undefined) ?? 'medium';
			const pull = (args.pull as string | undefined) ?? 'none';
			const af = typeof args.af === 'number' ? args.af : undefined;
			const outputType = (args.outputType as string | undefined) ?? 'push-pull';

			const gpioMap = s.registerMaps?.find(m => m.name === `GPIO${port}` || m.groupName === 'GPIO');
			const rccMap = s.registerMaps?.find(m => m.name === 'RCC');

			return _generateGPIOConfig(port, pinNum, mode, speed, pull, af, outputType, gpioMap, rccMap, s.mcuConfig?.family ?? '');
		},
	};
}


function _fwGenerateRTOSTask(session: IFirmwareSessionService): IVoidInternalTool {
	return {
		name: 'fw_generate_rtos_task',
		description: 'Generate an RTOS task skeleton. For FreeRTOS: xTaskCreate call, task function with ISR-safe patterns, osSemaphoreWait or xQueueReceive loop. For Zephyr: K_THREAD_DEFINE macro and thread function. RTOS type is auto-detected from session.',
		params: {
			taskName: { description: 'Task/thread name, e.g. "sensor_read", "uart_tx"' },
			stackSize: { description: 'Stack size in words (FreeRTOS) or bytes (Zephyr). Default: 256 words / 1024 bytes.' },
			priority: { description: 'Task priority. FreeRTOS: number (higher = higher priority). Zephyr: number (lower = higher priority). Default: 5.' },
			syncPrimitive: { description: '"queue" (default), "semaphore", or "none"' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const taskName = (args.taskName as string | undefined) ?? 'my_task';
			const stackSize = typeof args.stackSize === 'number' ? args.stackSize : undefined;
			const priority = typeof args.priority === 'number' ? args.priority : undefined;
			const sync = (args.syncPrimitive as string | undefined) ?? 'queue';

			const rtos = s.rtos ?? _detectRTOS(s.complianceFrameworks ?? [], s.projectInfo?.buildSystem ?? '');
			return _generateRTOSTask(taskName, rtos, stackSize, priority, sync);
		},
	};
}


// ─── Code generators ──────────────────────────────────────────────────────────

function _generatePeriphInit(
	regMap: IPeripheralRegisterMap,
	periph: string,
	lang: string,
	misra: boolean,
	options: Record<string, any>,
	family: string,
): string {
	const baseAddr = `0x${regMap.baseAddress.toString(16).toUpperCase().padStart(8, '0')}`;
	const funcName = `${periph.toLowerCase()}_init`;
	const lines: string[] = [];

	if (lang === 'rust') {
		return _generateRustPeriphInit(regMap, periph, baseAddr, options, family);
	}

	// C generation
	lines.push(`/* Auto-generated ${periph} initialization */`);
	lines.push(`/* SVD source: ${regMap.source ?? 'session'} — base address: ${baseAddr} */`);
	lines.push('');

	if (misra) {
		lines.push(`/* MISRA C:2012 Rule 11.4 — cast through volatile pointer */`);
		lines.push(`#define ${periph}_BASE  (${baseAddr}UL)`);
		lines.push(`#define ${periph}_REG(offset) (*((volatile uint32_t *)(${periph}_BASE + (offset))))`);
	} else {
		lines.push(`#define ${periph}_BASE  (${baseAddr}UL)`);
		lines.push(`#define REG32(addr) (*((volatile uint32_t *)(addr)))`);
	}
	lines.push('');

	// Register defines from SVD
	const keyRegs = regMap.registers.slice(0, 12);
	for (const reg of keyRegs) {
		const regOffset = `0x${reg.addressOffset.toString(16).toUpperCase().padStart(3, '0')}`;
		const macroName = misra
			? `${periph}_${reg.name}`
			: `${periph}_${reg.name}`;
		lines.push(`#define ${macroName.padEnd(32)} ${periph}_REG(${regOffset}UL)  /* ${reg.description ?? reg.name} */`);
	}
	if (regMap.registers.length > 12) {
		lines.push(`/* ... ${regMap.registers.length - 12} more registers — see SVD for full list */`);
	}
	lines.push('');

	// Init function
	lines.push(`void ${funcName}(void)`);
	lines.push(`{`);

	// RCC clock enable hint
	lines.push(`    /* 1. Enable peripheral clock in RCC */`);
	lines.push(`    /* RCC->APB1ENR |= RCC_APB1ENR_${periph}EN; */`);
	lines.push('');

	// Write key registers based on peripheral type
	_appendCRegisterInits(lines, regMap, periph, options, misra);

	lines.push(`}`);

	// Add bit field helpers for key registers
	const crRegs = regMap.registers.filter(r => r.name.match(/^(CR|CR1|CR2|CR3|SR|CCR|SMCR)/));
	if (crRegs.length > 0 && crRegs[0].fields && crRegs[0].fields.length > 0) {
		lines.push('');
		lines.push(`/* Key bit field positions for ${periph}_${crRegs[0].name} */`);
		for (const field of crRegs[0].fields.slice(0, 8)) {
			lines.push(`#define ${periph}_${crRegs[0].name}_${field.name}_Pos  (${field.bitOffset}U)`);
			lines.push(`#define ${periph}_${crRegs[0].name}_${field.name}_Msk  (0x${((1 << field.bitWidth) - 1).toString(16).toUpperCase()}UL << ${field.bitOffset}U)`);
		}
	}

	return lines.join('\n');
}


function _appendCRegisterInits(
	lines: string[],
	regMap: IPeripheralRegisterMap,
	periph: string,
	options: Record<string, any>,
	misra: boolean,
): void {
	const cr1 = regMap.registers.find(r => r.name === 'CR1' || r.name === 'CR');
	const brr = regMap.registers.find(r => r.name === 'BRR' || r.name === 'BAUDRATE');
	const srReg = regMap.registers.find(r => r.name === 'SR' || r.name === 'ISR');

	if (srReg) {
		lines.push(`    /* Clear any pending flags in ${periph}_${srReg.name} before enabling */`);
		lines.push(`    (void)${periph}_${srReg.name}; /* read-clear */`);
		lines.push('');
	}

	if (brr && options.baudRate) {
		const baud = parseInt(options.baudRate);
		// USART BRR: integer divider for OVER8=0 is simply fCK / baudRate
		// For F4/F7/H7 at typical APB clock frequencies, produce correct compile-time expr
		lines.push(`    /* 2. Set baud rate: ${baud} bps */`);
		lines.push(`    /* BRR = fAPB_CLK / BAUD (for OVER8=0, default) */`);
		lines.push(`    /* Example values: 8 MHz → ${Math.round(8000000 / baud)}, 16 MHz → ${Math.round(16000000 / baud)}, 48 MHz → ${Math.round(48000000 / baud)}, 84 MHz → ${Math.round(84000000 / baud)} */`);
		lines.push(`    /* Replace PERIPH_CLK_HZ with the actual APB clock for this peripheral */`);
		lines.push(`    #define PERIPH_CLK_HZ  (84000000UL) /* adjust: APB1 or APB2 clock */`);
		lines.push(`    ${periph}_${brr.name} = (uint32_t)(PERIPH_CLK_HZ / ${baud}UL);`);
		lines.push(`    #undef PERIPH_CLK_HZ`);
		lines.push('');
	}

	if (cr1) {
		lines.push(`    /* 3. Configure ${cr1.description ?? cr1.name} */`);
		const activeFields = cr1.fields?.filter(f => f.name !== 'RESERVED').slice(0, 6) ?? [];
		if (activeFields.length > 0) {
			const fieldStr = activeFields.map(f => `${f.name}=(0U<<${f.bitOffset}U)`).join(' | ');
			lines.push(`    ${periph}_${cr1.name} = ${fieldStr};`);
			for (const f of activeFields) {
				lines.push(`    /* ${f.name}[${f.bitOffset + f.bitWidth - 1}:${f.bitOffset}]: ${f.description ?? f.name} */`);
			}
		} else {
			lines.push(`    ${periph}_${cr1.name} = 0x0000UL;`);
		}
		lines.push('');
	}

	lines.push(`    /* 4. Enable peripheral */`);
	if (cr1) {
		const enField = cr1.fields?.find(f => f.name === 'UE' || f.name === 'EN' || f.name === 'SPE' || f.name === 'TEN' || f.name === 'CEN');
		if (enField) {
			lines.push(`    ${periph}_${cr1.name} |= (1UL << ${enField.bitOffset}U); /* ${enField.name}: ${enField.description ?? 'enable'} */`);
		} else {
			lines.push(`    /* Set enable bit in ${periph}_${cr1.name} */`);
		}
	}
}


function _generateRustPeriphInit(
	regMap: IPeripheralRegisterMap,
	periph: string,
	baseAddr: string,
	options: Record<string, any>,
	family: string,
): string {
	const crate = family.toUpperCase().startsWith('STM32') ? `stm32${family.slice(5, 7).toLowerCase()}xx` : 'pac';
	const periphLower = periph.toLowerCase();
	const funcName = `${periphLower}_init`;
	const lines: string[] = [
		`// Auto-generated ${periph} initialization — Rust PAC pattern`,
		`// SVD base address: ${baseAddr}`,
		`// Crate: ${crate} (add to Cargo.toml: ${crate} = { features = ["${family.toLowerCase()}"] })`,
		``,
		`use ${crate}::{Peripherals};`,
		``,
		`pub fn ${funcName}(dp: &mut Peripherals) {`,
		`    let ${periphLower} = &dp.${periph.toUpperCase()};`,
		``,
	];

	// RCC clock enable
	lines.push(`    // 1. Enable peripheral clock`);
	lines.push(`    dp.RCC.apb1enr().modify(|_, w| w.${periphLower}en().enabled());`);
	lines.push(`    let _ = dp.RCC.apb1enr().read(); // read-back for clock settle`);
	lines.push(``);

	// Register writes from SVD
	const keyRegs = regMap.registers.filter(r => r.name.match(/^(CR|CR1|CR2|BRR|SMCR|CCR)/) && !r.name.startsWith('RESERVED'));
	for (const reg of keyRegs.slice(0, 6)) {
		lines.push(`    // ${reg.name}: ${reg.description ?? ''}`);
		const activeFields = reg.fields?.filter(f => !f.name.includes('RESERVED')).slice(0, 4) ?? [];
		if (activeFields.length > 0) {
			const modifyExpr = activeFields.map(f => `w.${f.name.toLowerCase()}().bits(0)`).join('\n        .');
			lines.push(`    ${periphLower}.${reg.name.toLowerCase()}().modify(|_, w| unsafe {`);
			lines.push(`        w.${modifyExpr}`);
			lines.push(`    });`);
		} else {
			lines.push(`    ${periphLower}.${reg.name.toLowerCase()}().reset();`);
		}
		if (options.baudRate && reg.name === 'BRR') {
			const baud = parseInt(options.baudRate);
			lines.push(`    // BRR = PERIPH_CLK / BAUD. E.g. 84 MHz / ${baud} = ${Math.round(84000000 / baud)}`);
			lines.push(`    ${periphLower}.brr().write(|w| unsafe { w.bits(84_000_000u32 / ${baud}u32) });`);
		}
		lines.push(``);
	}

	// Enable bit
	const cr1 = regMap.registers.find(r => r.name === 'CR1');
	const enField = cr1?.fields?.find(f => ['UE', 'SPE', 'PE', 'CEN', 'ADON', 'EN'].includes(f.name));
	if (enField && cr1) {
		lines.push(`    // Enable ${periph} (must be last)`);
		lines.push(`    ${periphLower}.cr1().modify(|_, w| w.${enField.name.toLowerCase()}().enabled());`);
	}

	lines.push(`}`);
	return lines.join('\n');
}


function _generateISR(regMap: IPeripheralRegisterMap, irq: { name: string; value: number; description?: string } | undefined, family?: string): string {
	const fam = (family ?? '').toUpperCase();
	const periph = regMap.name;

	// nRF: uses GPIOTE events + EasyDMA, no NVIC_SetPriority for most peripherals
	if (fam.startsWith('NRF')) {
		const irqName = irq?.name ?? `${periph}_IRQHandler`;
		return [
			`/* nRF ISR skeleton for ${periph} */`,
			`/* nRF peripherals use event-task model; interrupt via SHORTS or direct IRQ */`,
			``,
			`static volatile uint8_t ${periph.toLowerCase()}_event = 0U;`,
			``,
			`void ${irqName.replace(/_IRQn$/, '_IRQHandler')}(void)`,
			`{`,
			`    /* Clear event register FIRST to prevent re-entry */`,
			`    NRF_${periph.toUpperCase()}->EVENTS_READY = 0;  /* clear event (adjust to actual event) */`,
			`    (void)NRF_${periph.toUpperCase()}->EVENTS_READY; /* pipeline flush */`,
			`    ${periph.toLowerCase()}_event = 1U;`,
			`}`,
			``,
			`/* In init: NVIC_SetPriority(${irq?.name ?? `${periph}_IRQn`}, ${irq?.value ?? 7}); */`,
			`/*          NVIC_EnableIRQ(${irq?.name ?? `${periph}_IRQn`});           */`,
			`/* Note: nRF interrupt priorities are 0-7 (3-bit). FreeRTOS uses 2-7. */`,
		].join('\n');
	}
	// C2000: uses PIE (Peripheral Interrupt Expansion), not NVIC
	if (fam.startsWith('TMS320') || fam.startsWith('C2000')) {
		const handlerName = `${periph.toLowerCase()}_isr`;
		return [
			`/* C2000 ISR skeleton for ${periph} */`,
			`/* C2000 uses PIE (Peripheral Interrupt Expansion), not NVIC */`,
			``,
			`static volatile uint16_t ${periph.toLowerCase()}_flag = 0U;`,
			``,
			`__interrupt void ${handlerName}(void)`,
			`{`,
			`    /* Clear interrupt flag in peripheral */`,
			`    ${periph.toUpperCase()}regs.${periph.toUpperCase()}CTL.bit.INT_CLR = 1;`,
			`    /* Acknowledge PIE group interrupt (find group from PIE vector table) */`,
			`    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;  /* adjust group number */`,
			`    ${periph.toLowerCase()}_flag = 1U;`,
			`}`,
			``,
			`/* In init: */`,
			`/* PieVectTable.${periph.toUpperCase()}_INT = &${handlerName}; */`,
			`/* PieCtrlRegs.PIEIER1.bit.INTx1 = 1;  // adjust PIE group/bit */`,
			`/* IER |= M_INT1;                       // enable CPU interrupt group */`,
			`/* EINT;                                // enable global interrupts */`,
		].join('\n');
	}
	// AURIX: uses SRC (Service Request Control), not NVIC
	if (fam.startsWith('TC2') || fam.startsWith('TC3') || fam.startsWith('AURIX')) {
		const handlerName = `${periph.toLowerCase()}_isr`;
		return [
			`/* AURIX ISR skeleton for ${periph} */`,
			`/* AURIX TriCore uses SRC (Service Request Control) registers, not NVIC */`,
			``,
			`static volatile uint8_t ${periph.toLowerCase()}_flag = 0U;`,
			``,
			`IFX_INTERRUPT(${handlerName}, 0, ISR_PRIORITY_${periph.toUpperCase()})`,
			`{`,
			`    /* Clear interrupt flag */`,
			`    /* ${periph.toUpperCase()}_${regMap.registers.find(r => r.name === 'ISR' || r.name === 'SR')?.name ?? 'SR'}.U = 0; */`,
			`    ${periph.toLowerCase()}_flag = 1U;`,
			`}`,
			``,
			`/* In init (iLLD): */`,
			`/* IfxSrc_init(&SRC_${periph.toUpperCase()}, IfxSrc_Tos_cpu0, ISR_PRIORITY_${periph.toUpperCase()}); */`,
			`/* IfxSrc_enable(&SRC_${periph.toUpperCase()}); */`,
			`#define ISR_PRIORITY_${periph.toUpperCase()}  50  /* 0..255, higher = higher priority on TriCore */`,
		].join('\n');
	}
	const irqName = irq?.name ?? `${periph}_IRQn`;
	const irqNum = irq?.value ?? 0;
	const handlerName = irqName.replace(/_IRQn$/, '_IRQHandler');

	const sr = regMap.registers.find(r => r.name === 'SR' || r.name === 'ISR' || r.name === 'INTFR');
	const clearReg = regMap.registers.find(r => r.name === 'ICR' || r.name === 'IFCR' || r.name === 'SR');
	const baseAddr = `0x${regMap.baseAddress.toString(16).toUpperCase().padStart(8, '0')}`;

	return [
		`/* Auto-generated ISR for ${periph} — IRQn ${irqNum}: ${irq?.description ?? irqName} */`,
		`/* SVD source: ${regMap.source ?? 'session'} — ${periph} base: ${baseAddr} */`,
		'',
		`/* Volatile flag — set in ISR, cleared in main loop */`,
		`static volatile uint8_t ${periph.toLowerCase()}_event_flag = 0U;`,
		'',
		`void ${handlerName}(void)`,
		`{`,
		`    /* Cortex-M rule: clear interrupt flag FIRST to prevent re-entry */`,
		sr ? `    uint32_t sr = ${periph}_${sr.name}; /* capture status */` : `    /* Read status register */`,
		clearReg && clearReg.name !== sr?.name
			? `    ${periph}_${clearReg.name} = 0xFFFFFFFFUL; /* clear all pending flags */`
			: sr ? `    (void)sr; /* flag cleared by reading SR */` : `    /* Clear pending flags */`,
		'',
		`    /* Signal main context — ISR-safe write */`,
		`    ${periph.toLowerCase()}_event_flag = 1U;`,
		``,
		`    /* TODO: add peripheral-specific handling here */`,
		`    /* e.g. read data register, write to ring buffer, update state machine */`,
		`}`,
		'',
		`/* In your init function: */`,
		`/* NVIC_SetPriority(${irqName}, ${irqNum > 8 ? 8 : irqNum}U); */`,
		`/* NVIC_EnableIRQ(${irqName});                              */`,
	].join('\n');
}


function _generateDMAConfig(
	periph: string,
	dir: string,
	dataSize: number,
	periphMap: IPeripheralRegisterMap | undefined,
	dmaMap: IPeripheralRegisterMap | undefined,
	family: string,
): string {
	const fam = family.toUpperCase();

	// ── Non-STM32 DMA: provide SDK-based correct code ──────────────────────────
	if (fam.startsWith('NRF')) {
		return [
			`/* nRF EasyDMA for ${periph} — ${dir} */`,
			`/* nRF peripherals (UARTE, SPIM, TWIM, SAADC) have built-in EasyDMA */`,
			`/* No separate DMA controller needed — configure directly on the peripheral */`,
			``,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, uint32_t len)`,
			`{`,
			dir === 'mem-to-periph'
				? `    NRF_${periph.toUpperCase()}->TXD.PTR = (uint32_t)buf;\n    NRF_${periph.toUpperCase()}->TXD.MAXCNT = len;`
				: `    NRF_${periph.toUpperCase()}->RXD.PTR = (uint32_t)buf;\n    NRF_${periph.toUpperCase()}->RXD.MAXCNT = len;`,
			`    /* Trigger transfer task: NRF_${periph.toUpperCase()}->TASKS_${dir === 'mem-to-periph' ? 'STARTTX' : 'STARTRX'} = 1; */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('RP20')) {
		const ch = 0;
		return [
			`/* RP2040 DMA for ${periph} — ${dir} (pico-sdk) */`,
			`#include "hardware/dma.h"`,
			``,
			`static int dma_chan_${periph.toLowerCase()};`,
			``,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, uint32_t len)`,
			`{`,
			`    dma_chan_${periph.toLowerCase()} = dma_claim_unused_channel(true);`,
			`    dma_channel_config cfg = dma_channel_get_default_config(dma_chan_${periph.toLowerCase()});`,
			`    channel_config_set_transfer_data_size(&cfg, DMA_SIZE_${dataSize === 16 ? '16' : dataSize === 32 ? '32' : '8'});`,
			`    channel_config_set_dreq(&cfg, DREQ_${periph.toUpperCase()}${dir === 'mem-to-periph' ? '_TX' : '_RX'});`,
			dir === 'mem-to-periph'
				? `    channel_config_set_read_increment(&cfg, true);\n    channel_config_set_write_increment(&cfg, false);`
				: `    channel_config_set_read_increment(&cfg, false);\n    channel_config_set_write_increment(&cfg, true);`,
			`    dma_channel_configure(dma_chan_${periph.toLowerCase()}, &cfg,`,
			dir === 'mem-to-periph'
				? `        &${periph.toUpperCase()}_HW->dr,   /* write to peripheral DR */\n        buf,                           /* read from buffer */`
				: `        buf,                           /* write to buffer */\n        &${periph.toUpperCase()}_HW->dr,   /* read from peripheral DR */`,
			`        len, true); /* trigger immediately */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('ESP32') || fam.startsWith('ESP8266')) {
		return [
			`/* ESP32 GDMA for ${periph} — ${dir} (esp-idf) */`,
			`#include "esp_intr_alloc.h"`,
			`#include "hal/gdma_hal.h"`,
			`#include "driver/${periph.toLowerCase()}.h"`,
			``,
			`/* ESP-IDF peripherals with DMA (SPI, I2S, UART, I2C) use DMA internally */`,
			`/* Configure via the high-level driver: */`,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, size_t len)`,
			`{`,
			`    /* SPI example: */`,
			`    spi_transaction_t t = { .length = len * 8, .tx_buffer = ${dir === 'mem-to-periph' ? 'buf' : 'NULL'}, .rx_buffer = ${dir === 'periph-to-mem' ? 'buf' : 'NULL'} };`,
			`    ESP_ERROR_CHECK(spi_device_transmit(spi_handle, &t));`,
			`    /* For UART DMA: use uart_write_bytes() / uart_read_bytes() which use GDMA internally */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
		return [
			`/* SAM DMAC for ${periph} — ${dir} */`,
			`#include "sam.h"`,
			``,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, uint32_t len)`,
			`{`,
			`    /* Enable DMAC clock */`,
			`    MCLK->AHBMASK.bit.DMAC_ = 1;`,
			`    DMAC->CTRL.bit.SWRST = 1;`,
			`    DMAC->BASEADDR.reg = (uint32_t)&descriptor_section;`,
			`    DMAC->WRBADDR.reg  = (uint32_t)&writeback_section;`,
			`    DMAC->CTRL.reg     = DMAC_CTRL_DMAENABLE | DMAC_CTRL_LVLEN(0xf);`,
			`    /* Configure channel and descriptor (BTCNT, SRCADDR, DSTADDR, BTCTRL) */`,
			`    /* Use ASF4: dma_descriptor_init() and dma_transfer_start() */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
		return [
			`/* Kinetis eDMA for ${periph} — ${dir} (KSDK2) */`,
			`#include "fsl_edma.h"`,
			`#include "fsl_dmamux.h"`,
			``,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, uint32_t len)`,
			`{`,
			`    edma_handle_t dmaHandle;`,
			`    edma_transfer_config_t transferConfig;`,
			`    DMAMUX_SetSource(DMAMUX0, 0, kDmaRequestMux0${periph.toUpperCase()}${dir === 'mem-to-periph' ? 'Tx' : 'Rx'});`,
			`    DMAMUX_EnableChannel(DMAMUX0, 0);`,
			`    EDMA_CreateHandle(&dmaHandle, DMA0, 0);`,
			`    EDMA_PrepareTransfer(&transferConfig, ${dir === 'mem-to-periph' ? `buf, sizeof(uint8_t), (void*)&${periph}_DR, sizeof(uint8_t)` : `(void*)&${periph}_DR, sizeof(uint8_t), buf, sizeof(uint8_t)`}, len, kEDMA_MemoryToMemory);`,
			`    EDMA_SubmitTransfer(&dmaHandle, &transferConfig);`,
			`    EDMA_StartTransfer(&dmaHandle);`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
		return [
			`/* EFR32/EFM32 LDMA for ${periph} — ${dir} (emlib) */`,
			`#include "em_ldma.h"`,
			``,
			`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint8_t* buf, uint32_t len)`,
			`{`,
			`    LDMA_TransferCfg_t cfg = LDMA_TRANSFER_CFG_PERIPHERAL(ldmaPeripheralSignal_${periph.toUpperCase()}_${dir === 'mem-to-periph' ? 'TXBL' : 'RXDATAV'});`,
			`    LDMA_Descriptor_t desc = ${dir === 'mem-to-periph' ? `LDMA_DESCRIPTOR_SINGLE_M2P_BYTE(buf, &${periph.toUpperCase()}->TXDATA, len)` : `LDMA_DESCRIPTOR_SINGLE_P2M_BYTE(&${periph.toUpperCase()}->RXDATA, buf, len)`};`,
			`    LDMA_StartTransfer(0, &cfg, &desc);`,
			`}`,
		].join('\n');
	}

	const isSTM32F4 = fam.startsWith('STM32F4') || fam.startsWith('STM32F7');
	const dmaStyle = isSTM32F4 ? 'stream' : 'channel';

	const msizeMap: Record<number, string> = { 8: '0b00', 16: '0b01', 32: '0b10' };
	const msize = msizeMap[dataSize] ?? '0b00';
	const dirBit = dir === 'mem-to-periph' ? '0b01' : '0b00';
	const streamNum = _dmaStreamForPeriph(periph, dir, family);

	const lines: string[] = [
		`/* Auto-generated DMA configuration for ${periph} ${dir} */`,
		`/* Family: ${family} — DMA style: ${dmaStyle} */`,
		'',
	];

	if (dmaStyle === 'stream') {
		// STM32F4/F7 DMA stream registers
		lines.push(`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint32_t periph_addr, uint32_t mem_addr, uint32_t len)`);
		lines.push(`{`);
		lines.push(`    /* 1. Enable DMA clock: RCC->AHB1ENR |= RCC_AHB1ENR_DMA1EN; */`);
		lines.push(`    /* 2. Disable stream before config */`);
		lines.push(`    DMA1_Stream${streamNum}->CR &= ~DMA_SxCR_EN;`);
		lines.push(`    while (DMA1_Stream${streamNum}->CR & DMA_SxCR_EN) {} /* wait for disable */`);
		lines.push(`    /* 3. Clear interrupt flags */`);
		lines.push(`    DMA1->LIFCR = 0x3D << (${streamNum < 4 ? streamNum * 6 : (streamNum - 4) * 6}U); /* clear all flags for stream ${streamNum} */`);
		lines.push(`    /* 4. Configure addresses */`);
		lines.push(`    DMA1_Stream${streamNum}->PAR  = periph_addr; /* peripheral address */`);
		lines.push(`    DMA1_Stream${streamNum}->M0AR = mem_addr;    /* memory address */`);
		lines.push(`    DMA1_Stream${streamNum}->NDTR = len;         /* data count */`);
		lines.push(`    /* 5. Configure stream: dir=${dir}, MSIZE=${dataSize}b, PSIZE=${dataSize}b, MINC=1, PINC=0 */`);
		lines.push(`    DMA1_Stream${streamNum}->CR = `);
		lines.push(`        (${_dmaChannelForPeriph(periph, dir, family)}UL << DMA_SxCR_CHSEL_Pos) | /* channel selection */`);
		lines.push(`        (${msize}UL << DMA_SxCR_MSIZE_Pos)  | /* memory data size: ${dataSize}-bit */`);
		lines.push(`        (${msize}UL << DMA_SxCR_PSIZE_Pos)  | /* periph data size: ${dataSize}-bit */`);
		lines.push(`        (${dirBit}UL << DMA_SxCR_DIR_Pos)   | /* direction: ${dir} */`);
		lines.push(`        DMA_SxCR_MINC                       | /* memory increment mode */`);
		lines.push(`        DMA_SxCR_TCIE;                        /* transfer complete interrupt */`);
		lines.push(`    /* 6. Enable stream */`);
		lines.push(`    DMA1_Stream${streamNum}->CR |= DMA_SxCR_EN;`);
		lines.push(`}`);
	} else {
		// STM32F0/F1/G0/G4 DMA channel registers
		lines.push(`void dma_config_${periph.toLowerCase()}_${dir.replace('-', '_')}(uint32_t periph_addr, uint32_t mem_addr, uint32_t len)`);
		lines.push(`{`);
		lines.push(`    /* 1. Enable DMA clock: RCC->AHBENR |= RCC_AHBENR_DMA1EN; */`);
		lines.push(`    /* 2. Disable channel before config */`);
		lines.push(`    DMA1_Channel${streamNum}->CCR &= ~DMA_CCR_EN;`);
		lines.push(`    /* 3. Configure addresses */`);
		lines.push(`    DMA1_Channel${streamNum}->CPAR  = periph_addr;`);
		lines.push(`    DMA1_Channel${streamNum}->CMAR  = mem_addr;`);
		lines.push(`    DMA1_Channel${streamNum}->CNDTR = len;`);
		lines.push(`    /* 4. Configure channel: dir=${dir}, MSIZE=${dataSize}b, PSIZE=${dataSize}b, MINC=1, PINC=0 */`);
		lines.push(`    DMA1_Channel${streamNum}->CCR =`);
		lines.push(`        (${msize}UL << DMA_CCR_MSIZE_Pos) | /* memory data size: ${dataSize}-bit */`);
		lines.push(`        (${msize}UL << DMA_CCR_PSIZE_Pos) | /* periph data size: ${dataSize}-bit */`);
		lines.push(`        ${dir === 'mem-to-periph' ? 'DMA_CCR_DIR |' : '          '} /* direction: ${dir} */`);
		lines.push(`        DMA_CCR_MINC |                       /* memory increment mode */`);
		lines.push(`        DMA_CCR_TCIE;                        /* transfer complete interrupt */`);
		lines.push(`    /* 5. Enable channel */`);
		lines.push(`    DMA1_Channel${streamNum}->CCR |= DMA_CCR_EN;`);
		lines.push(`}`);
	}

	if (periphMap) {
		const drReg = periphMap.registers.find(r => r.name === 'DR' || r.name === 'TDR' || r.name === 'RDR' || r.name === 'DATA');
		if (drReg) {
			lines.push('');
			lines.push(`/* ${periph} data register address for PAR: */`);
			lines.push(`/* ${periph}_BASE + 0x${drReg.addressOffset.toString(16).toUpperCase()} = ${periph}_${drReg.name} */`);
		}
	}

	return lines.join('\n');
}


function _generateClockConfig(
	targetMHz: number,
	source: string,
	hseMHz: number,
	rccMap: IPeripheralRegisterMap | undefined,
	family: string,
	variant: string,
): string {
	const fam = family.toUpperCase();

	// ── Non-STM32: provide correct family-specific guidance ────────────────────
	if (fam.startsWith('NRF')) {
		return [
			`/* nRF52/53/91: no runtime PLL configuration — clock is fixed at reset */`,
			`/* Start HFXO (external 32 MHz crystal) for lowest jitter: */`,
			`void clock_init(void) {`,
			`    NRF_CLOCK->HFCLKCTRL = CLOCK_HFCLKCTRL_HCLK32M_Div1 << CLOCK_HFCLKCTRL_HCLK32M_Pos;`,
			`    NRF_CLOCK->EVENTS_HFCLKSTARTED = 0;`,
			`    NRF_CLOCK->TASKS_HFCLKSTART = 1;`,
			`    while (!NRF_CLOCK->EVENTS_HFCLKSTARTED) {}`,
			`    /* CPU now at 64 MHz (nRF52) or 128 MHz (nRF5340 App core) */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('RP20')) {
		const clampedMHz = Math.min(targetMHz, fam.startsWith('RP2350') ? 150 : 133);
		return [
			`/* RP2040/RP2350: configure PLL via pico-sdk */`,
			`#include "pico/stdlib.h"`,
			`#include "hardware/clocks.h"`,
			`#include "hardware/pll.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Set system clock to ${clampedMHz} MHz */`,
			`    set_sys_clock_khz(${clampedMHz * 1000}U, true);`,
			`    /* Or manually configure PLL: */`,
			`    /* pll_init(pll_sys, 1, ${clampedMHz <= 133 ? 1500 : clampedMHz * 12} * MHZ, 6, ${Math.round((clampedMHz <= 133 ? 1500 : clampedMHz * 12) / clampedMHz)}); */`,
			`    /* clock_configure(clk_sys, CLOCKS_CLK_SYS_CTRL_SRC_VALUE_CLKSRC_CLK_SYS_AUX, */`,
			`    /*     CLOCKS_CLK_SYS_CTRL_AUXSRC_VALUE_CLKSRC_PLL_SYS, ${clampedMHz}MHZ, ${clampedMHz}MHZ); */`,
			`    /* stdio_init_all() configures USB/UART with new clock */`,
			`    stdio_init_all();`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('ESP32') || fam.startsWith('ESP8266')) {
		return [
			`/* ESP32: clock is managed by esp-idf power management */`,
			`#include "esp_pm.h"`,
			``,
			`void clock_init(void) {`,
			`    esp_pm_config_t pm_config = {`,
			`        .max_freq_mhz = ${Math.min(targetMHz, 240)},`,
			`        .min_freq_mhz = 80,`,
			`        .light_sleep_enable = false,`,
			`    };`,
			`    ESP_ERROR_CHECK(esp_pm_configure(&pm_config));`,
			`    /* Or set CPU frequency without power management: */`,
			`    /* esp_clk_tree_src_get_freq_hz(SOC_MOD_CLK_CPU, ...); */`,
			`    /* rtc_clk_cpu_freq_set_config(&config); */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
		const clampedMHz = Math.min(targetMHz, 180);
		return [
			`/* Kinetis MCG PLL: use KSDK2 BOARD_BootClockRUN() or configure MCG manually */`,
			`/* Target: ${clampedMHz} MHz core clock */`,
			`void clock_init(void) {`,
			`    /* Step 1: Transition MCG to FBE mode (external oscillator) */`,
			`    MCG->C2 = MCG_C2_RANGE0(2) | MCG_C2_EREFS0_MASK; /* high-freq ext osc */`,
			`    MCG->C1 = MCG_C1_CLKS(2) | MCG_C1_FRDIV(3) | MCG_C1_IRCLKEN_MASK;`,
			`    while (!(MCG->S & MCG_S_OSCINIT0_MASK)) {} /* wait osc */`,
			`    while ((MCG->S & MCG_S_CLKST_MASK) != MCG_S_CLKST(2)) {} /* FBE mode */`,
			`    /* Step 2: Configure PLL (use Kinetis Clock Tool or BOARD_BootClockRUN) */`,
			`    MCG->C5 = MCG_C5_PRDIV0(${Math.max(0, hseMHz - 1)}); /* PRDIV = ${hseMHz} → 1 MHz ref */`,
			`    MCG->C6 = MCG_C6_PLLS_MASK | MCG_C6_VDIV0(${Math.min(clampedMHz * 2 - 24, 31)}); /* VDIV */`,
			`    while (!(MCG->S & MCG_S_PLLST_MASK)) {}`,
			`    while (!(MCG->S & MCG_S_LOCK0_MASK)) {}`,
			`    /* Step 3: Switch to PLL (PEE mode) */`,
			`    MCG->C1 = MCG_C1_CLKS(0) | MCG_C1_FRDIV(3);`,
			`    while ((MCG->S & MCG_S_CLKST_MASK) != MCG_S_CLKST(3)) {}`,
			`    SystemCoreClock = ${clampedMHz}000000UL;`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
		const clampedMHz = Math.min(targetMHz, 120);
		return [
			`/* SAM D/E/C/L: configure DPLL or DFLL48M via CMSIS/ASF */`,
			`#include "sam.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Enable XOSC if using external crystal */`,
			`    OSCCTRL->XOSCCTRL[0].reg = OSCCTRL_XOSCCTRL_STARTUP(6)`,
			`                             | OSCCTRL_XOSCCTRL_CFDPRESC(4)`,
			`                             | OSCCTRL_XOSCCTRL_ENALC`,
			`                             | OSCCTRL_XOSCCTRL_XTALEN | OSCCTRL_XOSCCTRL_ENABLE;`,
			`    while (!OSCCTRL->STATUS.bit.XOSCRDY0) {}`,
			`    /* Configure DPLL: target ${clampedMHz} MHz */`,
			`    OSCCTRL->Dpll[0].DPLLRATIO.reg = OSCCTRL_DPLLRATIO_LDR(${Math.round(clampedMHz / hseMHz) - 1}) | OSCCTRL_DPLLRATIO_LDRFRAC(0);`,
			`    OSCCTRL->Dpll[0].DPLLCTRLB.reg = OSCCTRL_DPLLCTRLB_REFCLK_XOSC0;`,
			`    OSCCTRL->Dpll[0].DPLLCTRLA.reg = OSCCTRL_DPLLCTRLA_ENABLE;`,
			`    while (!OSCCTRL->Dpll[0].DPLLSTATUS.bit.CLKRDY) {}`,
			`    /* Switch GCLK0 (main clock) to DPLL */`,
			`    GCLK->GENCTRL[0].reg = GCLK_GENCTRL_SRC_DPLL0 | GCLK_GENCTRL_GENEN;`,
			`    while (GCLK->SYNCBUSY.bit.GENCTRL0) {}`,
			`    SystemCoreClock = ${clampedMHz}000000UL;`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
		const clampedMHz = Math.min(targetMHz, 80);
		return [
			`/* EFR32/EFM32: configure HFXO and HFRCO via EMLib CMU driver */`,
			`#include "em_cmu.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Enable HFXO (${hseMHz} MHz external crystal) */`,
			`    CMU_HFXOInit_TypeDef hfxoInit = CMU_HFXOINIT_DEFAULT;`,
			`    CMU_HFXOInit(&hfxoInit);`,
			`    CMU_OscillatorEnable(cmuOsc_HFXO, true, true);`,
			`    /* Configure HFRCO or DPLL to ${clampedMHz} MHz */`,
			`    CMU_HFRCOBandSet(cmuHFRCOFreq_${clampedMHz <= 38 ? '38' : '72'}M0Hz);`,
			`    CMU_ClockSelectSet(cmuClock_HF, cmuSelect_HFRCO);`,
			`    SystemCoreClockUpdate();`,
			`    /* SystemCoreClock = ${clampedMHz}000000UL (approximate) */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
		return [
			`/* Renesas RA: clock is configured via FSP (Flexible Software Package) */`,
			`/* Use r_cgc module in e2 studio or configure CGC registers directly. */`,
			`#include "bsp_api.h"`,
			``,
			`void clock_init(void) {`,
			`    /* FSP configures clock in SystemInit() via bsp_clock_init() */`,
			`    /* To change at runtime: use R_CGC_ClockCfg or modify clk_cfg in bsp_cfg.h */`,
			`    /* MOSC enable: */`,
			`    R_SYSTEM->MOSCCR = 0x00U;  /* enable MOSC */`,
			`    FSP_HARDWARE_REGISTER_WAIT(R_SYSTEM->OSCSF_b.MOSCSF, 1U);`,
			`    /* PLL configuration → target ${Math.min(targetMHz, 200)} MHz */`,
			`    /* Set PLLCCR/PLLCR registers — see RA6M5 UM section 8.2 */`,
			`    /* Recommended: configure via FSP project settings (clocks tab in e2 studio) */`,
			`    SystemCoreClock = ${Math.min(targetMHz, 200)}000000UL;`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('TMS320') || fam.startsWith('C2000')) {
		return [
			`/* TI C2000: configure SYSPLL via Device_initGPIO and SysCtl_setClock */`,
			`#include "driverlib.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Disable watchdog */`,
			`    SysCtl_disableWatchdog();`,
			`    /* Set SYSCLK to ${Math.min(targetMHz, 200)} MHz */`,
			`    SysCtl_setClock(SYSCTL_OSCSRC_XTAL   /* XTAL osc */`,
			`                  | SYSCTL_IMULT_${Math.min(Math.round(targetMHz / 10), 40)}         /* IMULT */`,
			`                  | SYSCTL_REFDIV_2`,
			`                  | SYSCTL_ODIV_1`,
			`                  | SYSCTL_SYSDIV_1`,
			`                  | SYSCTL_PLL_ENABLE`,
			`                  | SYSCTL_DCC_BASE_0);`,
			`    /* Verify with SysCtl_getClock(DEVICE_OSCSRC_FREQ) */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('ATMEGA') || fam.startsWith('ATTINY') || fam.startsWith('AVR')) {
		return [
			`/* AVR: clock source and frequency are set by fuse bits, not runtime registers */`,
			`/* No clock_init() needed at runtime — the MCU boots at the fuse-selected frequency */`,
			``,
			`/* Common fuse settings for ${hseMHz} MHz crystal (avrdude -U lfuse:w:0xFF:m):`,
			` *   LFUSE = 0xFF → full-swing crystal, 16k CK startup`,
			` *   HFUSE = 0xD9 → BOOTSZ=00, no EESAVE, no watchdog, SPI enabled`,
			` *   EFUSE = 0xFF → BOD disabled`,
			` */`,
			``,
			`/* If using internal RC oscillator (LFUSE=0x62 for 8 MHz): */`,
			`/* CLKPR = (1 << CLKPCE);  // unlock CLKPR */`,
			`/* CLKPR = (0 << CLKPS3) | (0 << CLKPS2) | (0 << CLKPS1) | (0 << CLKPS0); // /1 prescaler */`,
		].join('\n');
	}
	if (fam.startsWith('MIMXRT')) {
		return [
			`/* i.MX RT: clock configured via CCM (Clock Controller Module) */`,
			`/* Use MCUXpresso Config Tools or NXP SDK BOARD_BootClockRUN() */`,
			`#include "clock_config.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Generated function from MCUXpresso Config Tools */`,
			`    BOARD_BootClockRUN(); /* configures ARM PLL, AHB, IPG clocks */`,
			`    /* ARM PLL: fARM_PLL = 24 MHz * DIV_SELECT * 2 */`,
			`    /* CCM->CACRR = ARM_PODF (post-divider for core clock) */`,
			`    /* SystemCoreClock = ${Math.min(targetMHz, 1000)}000000UL after BOARD_BootClockRUN */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('LPC')) {
		return [
			`/* NXP LPC: configure PLL via SYSCON (LPC55) or LPC clock source */`,
			`#include "fsl_clock.h"`,
			``,
			`void clock_init(void) {`,
			`    /* Use MCUXpresso Config Tools or SDK BOARD_BootClockPLL150M() */`,
			`    BOARD_BootClockPLL150M();`,
			`    /* Or manually: */`,
			`    /* CLOCK_SetupFROHFClocking(96000000U); */`,
			`    /* CLOCK_SetPLL0Freq(SYSPLL0_MSEL, SYSPLL0_PDIV_FLAG); */`,
			`    /* SystemCoreClockUpdate(); */`,
			`}`,
		].join('\n');
	}
	if (fam.startsWith('TC2') || fam.startsWith('TC3') || fam.startsWith('AURIX')) {
		return [
			`/* AURIX TC2xx/TC3xx: PLL configured in startup code (Lauterbach FLASH.prog or iLLD) */`,
			`/* Use iLLD Ifx_Cfg_PllCfg structure in IfxScuCcu_config.h */`,
			`#include "IfxScuCcu.h"`,
			``,
			`void clock_init(void) {`,
			`    /* iLLD clock configuration */`,
			`    IfxScuCcu_Config ccuConfig;`,
			`    IfxScuCcu_initConfig(&ccuConfig);`,
			`    ccuConfig.pllCfg.pllInputClockSelection = IfxScu_SYSPLLCON0_INSEL_osc0;`,
			`    /* Modify NDIV/PDIV/K2 in ccuConfig.pllCfg for target ${Math.min(targetMHz, 480)} MHz */`,
			`    IfxScuCcu_init(&ccuConfig);`,
			`}`,
		].join('\n');
	}

	const rccSource = rccMap ? `/* RCC base: 0x${rccMap.baseAddress.toString(16).toUpperCase()} */` : '';
	const inputMHz = source === 'hse' ? hseMHz : (fam.startsWith('STM32F1') ? 8 : 16);
	const srcEnable = source === 'hse' ? `RCC->CR |= RCC_CR_HSEON;` : `RCC->CR |= RCC_CR_HSION;`;
	const srcReady = source === 'hse' ? `while (!(RCC->CR & RCC_CR_HSERDY)) {}` : `while (!(RCC->CR & RCC_CR_HSIRDY)) {}`;

	// H7 uses a completely different PLL structure (PLL1..PLL3, DIVM, DIVN, DIVP as fields)
	if (fam.startsWith('STM32H7')) {
		return _generateClockConfigH7(targetMHz, source, inputMHz, rccSource, variant, rccMap);
	}

	// G0/L0/L1/F0: no PLL multiplier PLLP field, simpler PLL
	if (fam.startsWith('STM32F0') || fam.startsWith('STM32G0') || fam.startsWith('STM32L0') || fam.startsWith('STM32L1')) {
		return _generateClockConfigF0(targetMHz, source, inputMHz, family, variant, rccSource);
	}

	// F1/F2/F3: PLL with PLLMUL enum (x2..x16) not PLLN/PLLP fields
	if (fam.startsWith('STM32F1') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')) {
		return _generateClockConfigF1(targetMHz, source, inputMHz, family, variant, rccSource);
	}

	// G4 / L4 / L4+ / L5: similar to F4 but PLLR output, different max/APB
	const isL4 = fam.startsWith('STM32L4') || fam.startsWith('STM32L5');
	const isG4 = fam.startsWith('STM32G4');
	if (isL4 || isG4) {
		return _generateClockConfigG4L4(targetMHz, source, inputMHz, family, variant, rccSource, isL4);
	}

	// F4 / F7: classic PLLN/PLLM/PLLP/PLLQ structure
	const maxMHz = fam.startsWith('STM32F7') ? 216 : 168;
	const clampedMHz = Math.min(targetMHz, maxMHz);
	const pllm = inputMHz;
	const pllp = 2;
	const plln = clampedMHz * pllp;
	const pllq = Math.max(2, Math.ceil(plln / 48));

	// Flash wait states from RM0090/RM0385 (3.3V supply)
	const flashWS = clampedMHz <= 30 ? 0 : clampedMHz <= 60 ? 1 : clampedMHz <= 90 ? 2 :
		clampedMHz <= 120 ? 3 : clampedMHz <= 150 ? 4 : clampedMHz <= 180 ? 5 : 6;

	const apb1MHz = Math.floor(clampedMHz / 4);
	const apb2MHz = Math.floor(clampedMHz / 2);

	return [
		`/* Auto-generated clock configuration for ${family} ${variant} */`,
		`/* Target: ${clampedMHz} MHz SYSCLK from ${source.toUpperCase()} @ ${inputMHz} MHz */`,
		rccSource,
		'',
		`void system_clock_config(void)`,
		`{`,
		`    /* ── 1. Enable ${source.toUpperCase()} ─────────────────────────────────────── */`,
		`    ${srcEnable}`,
		`    ${srcReady} /* wait for oscillator ready */`,
		'',
		`    /* ── 2. Voltage regulator: scale 1 for max performance ─────────── */`,
		`    RCC->APB1ENR |= RCC_APB1ENR_PWREN;`,
		`    PWR->CR |= PWR_CR_VOS; /* VOS = 0b11: scale 1 (required for >${fam.startsWith('STM32F7') ? 168 : 144} MHz) */`,
		'',
		`    /* ── 3. PLL: SYSCLK = (${inputMHz} MHz * ${plln}) / (${pllm} * ${pllp}) = ${clampedMHz} MHz ── */`,
		`    /* VCO: ${inputMHz}/${pllm} * ${plln} = ${plln} MHz (valid: 100–432 MHz) */`,
		`    /* PLLQ: VCO / ${pllq} = ${Math.round(plln / pllq)} MHz (USB/SDIO/RNG: target 48 MHz) */`,
		`    RCC->PLLCFGR = (${pllm}UL  << RCC_PLLCFGR_PLLM_Pos)             /* PLLM = ${pllm} */`,
		`                 | (${plln}UL  << RCC_PLLCFGR_PLLN_Pos)             /* PLLN = ${plln} */`,
		`                 | (${pllp / 2 - 1}UL  << RCC_PLLCFGR_PLLP_Pos)             /* PLLP = ${pllp} (00b) */`,
		`                 | (${pllq}UL  << RCC_PLLCFGR_PLLQ_Pos)             /* PLLQ = ${pllq} */`,
		source === 'hse'
			? `                 | RCC_PLLCFGR_PLLSRC_HSE;                        /* PLL source: HSE */`
			: `                 ; /* PLL source: HSI16 */`,
		'',
		`    /* ── 4. Enable PLL and wait for lock ───────────────────────────── */`,
		`    RCC->CR |= RCC_CR_PLLON;`,
		`    while (!(RCC->CR & RCC_CR_PLLRDY)) {} /* PLL lock typically < 100 µs */`,
		'',
		`    /* ── 5. Flash latency (must be set BEFORE switching to higher SYSCLK) */`,
		`    /* At ${clampedMHz} MHz, 3.3V: ${flashWS} wait states — RM0090 Table 10 */`,
		`    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY)`,
		`               | FLASH_ACR_LATENCY_${flashWS}WS`,
		`               | FLASH_ACR_PRFTEN   /* prefetch enable */`,
		`               | FLASH_ACR_ICEN     /* instruction cache */`,
		`               | FLASH_ACR_DCEN;    /* data cache */`,
		`    while ((FLASH->ACR & FLASH_ACR_LATENCY) != FLASH_ACR_LATENCY_${flashWS}WS) {}`,
		'',
		`    /* ── 6. AHB / APB prescalers ────────────────────────────────────── */`,
		`    /* AHB  = SYSCLK / 1  = ${clampedMHz} MHz  (HPRE_DIV1) */`,
		`    /* APB1 = SYSCLK / 4  = ${apb1MHz} MHz  (PPRE1_DIV4, max ${fam.startsWith('STM32F7') ? 54 : 42} MHz) */`,
		`    /* APB2 = SYSCLK / 2  = ${apb2MHz} MHz  (PPRE2_DIV2, max ${fam.startsWith('STM32F7') ? 108 : 84} MHz) */`,
		`    RCC->CFGR = RCC_CFGR_HPRE_DIV1 | RCC_CFGR_PPRE1_DIV4 | RCC_CFGR_PPRE2_DIV2;`,
		'',
		`    /* ── 7. Switch SYSCLK source to PLL ─────────────────────────────── */`,
		`    RCC->CFGR |= RCC_CFGR_SW_PLL;`,
		`    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {}`,
		'',
		`    /* ── 8. Update CMSIS SystemCoreClock ─────────────────────────────── */`,
		`    SystemCoreClock = ${clampedMHz}000000UL;`,
		`}`,
	].join('\n');
}


function _generateClockConfigH7(
	targetMHz: number,
	source: string,
	inputMHz: number,
	rccSource: string,
	variant: string,
	_rccMap: IPeripheralRegisterMap | undefined,
): string {
	const clampedMHz = Math.min(targetMHz, 480);
	// H7: DIVM1 divides HSE to PLL1 ref (1–16 MHz), DIVN1 x (4–512), DIVP1 is /2..128
	const divm = inputMHz;      // 1 MHz ref
	const divp = 2;
	const divn = clampedMHz * divp;
	const flashWS = clampedMHz <= 70 ? 0 : clampedMHz <= 140 ? 1 : clampedMHz <= 210 ? 2 : clampedMHz <= 275 ? 3 : 4;

	return [
		`/* Auto-generated clock configuration for STM32H7 ${variant} */`,
		`/* Target: ${clampedMHz} MHz CPU from ${source.toUpperCase()} @ ${inputMHz} MHz */`,
		rccSource,
		'',
		`void system_clock_config(void)`,
		`{`,
		`    /* ── 1. Enable ${source.toUpperCase()} ─────────────────────────────────────── */`,
		source === 'hse'
			? `    RCC->CR |= RCC_CR_HSEON;\n    while (!(RCC->CR & RCC_CR_HSERDY)) {}`
			: `    RCC->CR |= RCC_CR_HSION;\n    while (!(RCC->CR & RCC_CR_HSIRDY)) {}`,
		'',
		`    /* ── 2. Voltage scaling: VOS0 (fastest) requires SYSCLK > 300 MHz ── */`,
		`    RCC->APB4ENR |= RCC_APB4ENR_SYSCFGEN;`,
		`    SYSCFG->PWRCR |= SYSCFG_PWRCR_ODEN; /* overdrive for VOS0 */`,
		`    PWR->D3CR = (PWR->D3CR & ~PWR_D3CR_VOS) | (0x3UL << PWR_D3CR_VOS_Pos); /* VOS1 */`,
		`    while (!(PWR->D3CR & PWR_D3CR_VOSRDY)) {}`,
		'',
		`    /* ── 3. PLL1 config: fVCO = ${inputMHz}/${divm} * ${divn} = ${divn} MHz, fP = fVCO/${divp} = ${clampedMHz} MHz ── */`,
		`    RCC->PLLCKSELR = (${divm}UL << RCC_PLLCKSELR_DIVM1_Pos)`,
		`                   | ${source === 'hse' ? 'RCC_PLLCKSELR_PLLSRC_HSE' : 'RCC_PLLCKSELR_PLLSRC_HSI'};`,
		`    RCC->PLL1DIVR  = ((${divn - 1}UL) << RCC_PLL1DIVR_N1_Pos)  /* DIVN1 = ${divn}, written as N-1 */`,
		`                   | ((${divp - 1}UL) << RCC_PLL1DIVR_P1_Pos)  /* DIVP1 = ${divp}, written as P-1 */`,
		`                   | (1UL            << RCC_PLL1DIVR_Q1_Pos)  /* DIVQ1 = 2 */`,
		`                   | (1UL            << RCC_PLL1DIVR_R1_Pos); /* DIVR1 = 2 */`,
		`    RCC->PLLCFGR  |= RCC_PLLCFGR_PLL1FRACEN; /* enable fractional (even if FRACN=0) */`,
		`    RCC->PLLCFGR  |= RCC_PLLCFGR_DIVP1EN;    /* enable P output */`,
		'',
		`    /* ── 4. Enable PLL1 ──────────────────────────────────────────────── */`,
		`    RCC->CR |= RCC_CR_PLL1ON;`,
		`    while (!(RCC->CR & RCC_CR_PLL1RDY)) {}`,
		'',
		`    /* ── 5. Flash latency: ${flashWS} WS at ${clampedMHz} MHz (RM0433 Table 17) ── */`,
		`    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY)`,
		`               | FLASH_ACR_LATENCY_${flashWS}WS`,
		`               | FLASH_ACR_WRHIGHFREQ_1; /* programming delay for > 285 MHz */`,
		`    while ((FLASH->ACR & FLASH_ACR_LATENCY) != FLASH_ACR_LATENCY_${flashWS}WS) {}`,
		'',
		`    /* ── 6. D1/D2/D3 core/bus prescalers ───────────────────────────── */`,
		`    /* D1CPRE = /1  → CPU  = ${clampedMHz} MHz */`,
		`    /* D1HPRE = /2  → AXI  = ${Math.round(clampedMHz / 2)} MHz (AHB3, max 240 MHz) */`,
		`    /* D2PRE1 = /2  → APB1 = ${Math.round(clampedMHz / 4)} MHz (max 120 MHz) */`,
		`    /* D2PRE2 = /2  → APB2 = ${Math.round(clampedMHz / 4)} MHz (max 120 MHz) */`,
		`    /* D3PRE  = /2  → APB4 = ${Math.round(clampedMHz / 4)} MHz (max 120 MHz) */`,
		`    RCC->D1CFGR = RCC_D1CFGR_D1CPRE_DIV1 | RCC_D1CFGR_HPRE_DIV2 | RCC_D1CFGR_D1PPRE_DIV2;`,
		`    RCC->D2CFGR = RCC_D2CFGR_D2PPRE1_DIV2 | RCC_D2CFGR_D2PPRE2_DIV2;`,
		`    RCC->D3CFGR = RCC_D3CFGR_D3PPRE_DIV2;`,
		'',
		`    /* ── 7. Switch SYSCLK to PLL1P ──────────────────────────────────── */`,
		`    RCC->CFGR |= RCC_CFGR_SW_PLL1;`,
		`    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL1) {}`,
		'',
		`    /* ── 8. Update CMSIS SystemCoreClock ─────────────────────────────── */`,
		`    SystemCoreClock = ${clampedMHz}000000UL;`,
		`}`,
	].join('\n');
}


function _generateClockConfigF0(
	targetMHz: number,
	source: string,
	inputMHz: number,
	family: string,
	variant: string,
	rccSource: string,
): string {
	// F0/G0/L0: PLL input is HSI/2 (4 MHz) or HSE, output = input * PLLMUL (x2..x16)
	const clampedMHz = Math.min(targetMHz, 48);
	const hsiDiv2 = source === 'hsi' ? 4 : inputMHz; // F0 HSI/2 for PLL
	const pllmul = Math.round(clampedMHz / hsiDiv2);
	const flashWS = clampedMHz <= 24 ? 0 : 1;
	const fam = family.toUpperCase();
	const isG0 = fam.startsWith('STM32G0');

	return [
		`/* Auto-generated clock configuration for ${family} ${variant} */`,
		`/* Target: ${clampedMHz} MHz SYSCLK from ${source.toUpperCase()} */`,
		rccSource,
		'',
		`void system_clock_config(void)`,
		`{`,
		`    /* ── 1. Enable HSI (always on by default on reset, but ensure) ──── */`,
		source === 'hse'
			? `    RCC->CR |= RCC_CR_HSEON;\n    while (!(RCC->CR & RCC_CR_HSERDY)) {}`
			: `    /* HSI is on by default on F0/G0 reset */`,
		'',
		`    /* ── 2. Flash latency (${flashWS} WS at ${clampedMHz} MHz) ─────────────── */`,
		`    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY) | FLASH_ACR_LATENCY_${flashWS}WS;`,
		'',
		`    /* ── 3. PLL: SYSCLK = ${source === 'hsi' ? 'HSI/2' : 'HSE'} (${hsiDiv2} MHz) * PLLMUL(${pllmul}) = ${clampedMHz} MHz ── */`,
		isG0
			? [
				`    /* G0: PLLM/N/R structure (use PLLCFGR) */`,
				`    RCC->PLLCFGR = (1UL << RCC_PLLCFGR_PLLM_Pos)             /* PLLM = 2 */`,
				`                 | (${pllmul * 2}UL << RCC_PLLCFGR_PLLN_Pos) /* PLLN = ${pllmul * 2} */`,
				`                 | (1UL << RCC_PLLCFGR_PLLR_Pos)             /* PLLR = 2 (div by R+1) */`,
				source === 'hse' ? `                 | RCC_PLLCFGR_PLLSRC_HSE;` : `                 | RCC_PLLCFGR_PLLSRC_HSI;`,
				`    RCC->PLLCFGR |= RCC_PLLCFGR_PLLREN; /* enable PLLR output */`,
			].join('\n')
			: [
				`    RCC->CFGR &= ~(RCC_CFGR_PLLSRC | RCC_CFGR_PLLMUL);`,
				source === 'hse'
					? `    RCC->CFGR |= RCC_CFGR_PLLSRC_HSE_PREDIV | (((${pllmul} - 2U) & 0xFU) << 18U);`
					: `    RCC->CFGR |= RCC_CFGR_PLLSRC_HSI_DIV2   | (((${pllmul} - 2U) & 0xFU) << 18U);`,
			].join('\n'),
		'',
		`    /* ── 4. Enable PLL ─────────────────────────────────────────────── */`,
		`    RCC->CR |= RCC_CR_PLLON;`,
		`    while (!(RCC->CR & RCC_CR_PLLRDY)) {}`,
		'',
		`    /* ── 5. Switch to PLL ──────────────────────────────────────────── */`,
		`    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;`,
		`    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {}`,
		'',
		`    SystemCoreClock = ${clampedMHz}000000UL;`,
		`}`,
	].join('\n');
}


function _generateClockConfigF1(
	targetMHz: number,
	source: string,
	inputMHz: number,
	family: string,
	variant: string,
	rccSource: string,
): string {
	// F1/F2/F3: max 72/120/72 MHz, PLL uses PLLMUL enum
	const maxMHz = family.toUpperCase().startsWith('STM32F2') ? 120 : 72;
	const clampedMHz = Math.min(targetMHz, maxMHz);
	const pllPrediv = source === 'hse' ? Math.max(1, Math.round(inputMHz / 1)) : 1; // HSE/PREDIV
	const pllInput = source === 'hse' ? inputMHz / pllPrediv : 8; // HSI/2 = 4 MHz for F1
	const pllmul = Math.round(clampedMHz / pllInput);
	const flashWS = clampedMHz <= 24 ? 0 : clampedMHz <= 48 ? 1 : 2;
	const apb1Pre = clampedMHz > 36 ? 2 : 1;

	return [
		`/* Auto-generated clock configuration for ${family} ${variant} */`,
		`/* Target: ${clampedMHz} MHz SYSCLK from ${source.toUpperCase()} */`,
		rccSource,
		'',
		`void system_clock_config(void)`,
		`{`,
		source === 'hse'
			? `    RCC->CR |= RCC_CR_HSEON;\n    while (!(RCC->CR & RCC_CR_HSERDY)) {}`
			: `    /* HSI (8 MHz) on by default */`,
		'',
		`    /* Flash latency: ${flashWS} WS at ${clampedMHz} MHz */`,
		`    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY) | ${flashWS}U | FLASH_ACR_PRFTBE;`,
		'',
		`    /* AHB/APB prescalers before switching clock source */`,
		`    RCC->CFGR = RCC_CFGR_HPRE_DIV1        /* AHB = ${clampedMHz} MHz */`,
		`              | ${apb1Pre > 1 ? 'RCC_CFGR_PPRE1_DIV2' : 'RCC_CFGR_PPRE1_DIV1'}     /* APB1 = ${Math.round(clampedMHz / apb1Pre)} MHz (max 36 MHz) */`,
		`              | RCC_CFGR_PPRE2_DIV1;       /* APB2 = ${clampedMHz} MHz */`,
		'',
		`    /* PLL: ${source === 'hse' ? `HSE/${pllPrediv}` : 'HSI/2'} (${pllInput} MHz) * ${pllmul} = ${clampedMHz} MHz */`,
		source === 'hse' && pllPrediv > 1
			? `    RCC->CFGR2 = (${pllPrediv - 1}UL); /* PREDIV1 = ${pllPrediv} */`
			: ``,
		`    RCC->CFGR |= (((${pllmul} - 2U) & 0xFU) << 18U)  /* PLLMUL = ${pllmul} */`,
		source === 'hse'
			? `              | RCC_CFGR_PLLSRC_HSE_PREDIV;`
			: `              | RCC_CFGR_PLLSRC_HSI_DIV2;`,
		'',
		`    RCC->CR |= RCC_CR_PLLON;`,
		`    while (!(RCC->CR & RCC_CR_PLLRDY)) {}`,
		'',
		`    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;`,
		`    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {}`,
		'',
		`    SystemCoreClock = ${clampedMHz}000000UL;`,
		`}`,
	].filter(l => l !== undefined).join('\n');
}


function _generateClockConfigG4L4(
	targetMHz: number,
	source: string,
	inputMHz: number,
	family: string,
	variant: string,
	rccSource: string,
	isL4: boolean,
): string {
	// G4: max 170 MHz. L4: max 80 MHz. Both use PLLM/N/P/Q/R structure with PLLR as main output
	const maxMHz = isL4 ? 80 : 170;
	const clampedMHz = Math.min(targetMHz, maxMHz);
	const pllm = inputMHz;    // 1 MHz VCO input
	const pllr = 2;
	const plln = clampedMHz * pllr;
	const pllq = Math.max(2, Math.ceil(plln / 48));
	// G4 flash WS: 0WS ≤34, 1WS ≤68, 2WS ≤102, 3WS ≤136, 4WS ≤170 MHz
	// L4 flash WS: 0WS ≤16, 1WS ≤32, 2WS ≤48, 3WS ≤64, 4WS ≤80 MHz
	const wsTable = isL4
		? [[16, 0], [32, 1], [48, 2], [64, 3], [80, 4]] as [number, number][]
		: [[34, 0], [68, 1], [102, 2], [136, 3], [170, 4]] as [number, number][];
	const flashWS = (wsTable.find(([max]) => clampedMHz <= max) ?? [0, 4])[1];
	const srcEnable = source === 'hse' ? `RCC->CR |= RCC_CR_HSEON;\n    while (!(RCC->CR & RCC_CR_HSERDY)) {}` : `/* HSI16 on by default */`;

	return [
		`/* Auto-generated clock configuration for ${family} ${variant} */`,
		`/* Target: ${clampedMHz} MHz from ${source.toUpperCase()} @ ${inputMHz} MHz */`,
		rccSource,
		'',
		`void system_clock_config(void)`,
		`{`,
		`    ${srcEnable}`,
		'',
		`    /* Voltage scaling: Range 1 (required for > ${isL4 ? 26 : 150} MHz) */`,
		isL4
			? `    PWR->CR1 = (PWR->CR1 & ~PWR_CR1_VOS) | PWR_CR1_VOS_0; /* Range 1 */`
			: `    PWR->CR1 = (PWR->CR1 & ~PWR_CR1_VOS) | PWR_CR1_VOS_0; /* Boost mode for >150 MHz on G4 */`,
		isL4
			? `    while (PWR->SR2 & PWR_SR2_VOSF) {} /* wait VOSF cleared */`
			: `    PWR->CR5 &= ~PWR_CR5_R1MODE; /* clear for boost mode (>150 MHz) */`,
		'',
		`    /* Flash latency: ${flashWS} WS at ${clampedMHz} MHz */`,
		`    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY)`,
		`               | FLASH_ACR_LATENCY_${flashWS}WS`,
		`               | FLASH_ACR_PRFTEN | FLASH_ACR_ICEN | FLASH_ACR_DCEN;`,
		`    while ((FLASH->ACR & FLASH_ACR_LATENCY) != FLASH_ACR_LATENCY_${flashWS}WS) {}`,
		'',
		`    /* PLL: SYSCLK = ${inputMHz}/${pllm} * ${plln} / ${pllr} = ${clampedMHz} MHz (via PLLR) */`,
		`    RCC->PLLCFGR = (${pllm - 1}UL << RCC_PLLCFGR_PLLM_Pos)   /* PLLM = ${pllm} (written as M-1) */`,
		`                 | (${plln}UL    << RCC_PLLCFGR_PLLN_Pos)   /* PLLN = ${plln} */`,
		`                 | (${pllr / 2 - 1}UL    << RCC_PLLCFGR_PLLR_Pos)   /* PLLR = ${pllr} (written as R/2-1) */`,
		`                 | (${pllq / 2 - 1}UL    << RCC_PLLCFGR_PLLQ_Pos)   /* PLLQ = ${pllq} */`,
		`                 | RCC_PLLCFGR_PLLREN                        /* enable PLLR output (SYSCLK) */`,
		source === 'hse'
			? `                 | RCC_PLLCFGR_PLLSRC_HSE;`
			: `                 | RCC_PLLCFGR_PLLSRC_HSI;`,
		'',
		`    RCC->CR |= RCC_CR_PLLON;`,
		`    while (!(RCC->CR & RCC_CR_PLLRDY)) {}`,
		'',
		`    /* Switch SYSCLK to PLL R output */`,
		`    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;`,
		`    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {}`,
		'',
		`    SystemCoreClock = ${clampedMHz}000000UL;`,
		`}`,
	].join('\n');
}


function _generateGPIOConfig(
	port: string,
	pinNum: number,
	mode: string,
	speed: string,
	pull: string,
	af: number | undefined,
	outputType: string,
	gpioMap: IPeripheralRegisterMap | undefined,
	rccMap: IPeripheralRegisterMap | undefined,
	family: string,
): string {
	const modeVal: Record<string, number> = { input: 0, output: 1, alternate: 2, analog: 3 };
	const speedVal: Record<string, number> = { low: 0, medium: 1, high: 2, 'very-high': 3 };
	const pullVal: Record<string, number> = { none: 0, up: 1, down: 2 };
	const otVal = outputType === 'open-drain' ? 1 : 0;

	const mBits = modeVal[mode] ?? 1;
	const sBits = speedVal[speed] ?? 1;
	const pBits = pullVal[pull] ?? 0;

	const fam = family.toUpperCase();
	const baseAddr = gpioMap ? `0x${gpioMap.baseAddress.toString(16).toUpperCase()}` : `GPIO${port}_BASE`;

	// ── Non-STM32 families: completely different GPIO hardware ────────────
	if (fam.startsWith('NRF')) {
		const pinNote = `P${port === 'B' ? '1' : '0'}.${pinNum}`;
		return [
			`/* nRF GPIO config: ${pinNote} as ${mode}${af !== undefined ? ` function ${af}` : ''} */`,
			`/* nRF uses NRF_P0/NRF_P1 GPIO block — no RCC enable needed */`,
			'',
			`static inline void gpio_config_${pinNote.replace('.', '_')}(void)`,
			`{`,
			mode === 'output'
				? `    NRF_P${port === 'B' ? '1' : '0'}->DIRSET = (1UL << ${pinNum}U);`
				: `    NRF_P${port === 'B' ? '1' : '0'}->DIRCLR = (1UL << ${pinNum}U);`,
			`    NRF_P${port === 'B' ? '1' : '0'}->PIN_CNF[${pinNum}U] =`,
			`        (${mode === 'output' ? 'GPIO_PIN_CNF_DIR_Output' : 'GPIO_PIN_CNF_DIR_Input'} << GPIO_PIN_CNF_DIR_Pos)`,
			mode !== 'output' ? `        | (GPIO_PIN_CNF_INPUT_Connect << GPIO_PIN_CNF_INPUT_Pos)` : '',
			pull === 'up'   ? `        | (GPIO_PIN_CNF_PULL_Pullup   << GPIO_PIN_CNF_PULL_Pos)` : '',
			pull === 'down' ? `        | (GPIO_PIN_CNF_PULL_Pulldown << GPIO_PIN_CNF_PULL_Pos)` : '',
			af !== undefined ? `        | (${af}UL << GPIO_PIN_CNF_DRIVE_Pos) /* drive strength */` : '',
			`        ;`,
			`}`,
		].filter(l => l !== '').join('\n');
	}
	if (fam.startsWith('RP20')) {
		return [
			`/* RP2040 GPIO config: GPIO${pinNum} as ${mode}${af !== undefined ? ` function ${af}` : ''} */`,
			`/* RP2040 SDK: gpio_init + gpio_set_function */`,
			'',
			`static inline void gpio_config_gpio${pinNum}(void)`,
			`{`,
			`    gpio_init(${pinNum}U);`,
			mode === 'output'
				? `    gpio_set_dir(${pinNum}U, GPIO_OUT);`
				: `    gpio_set_dir(${pinNum}U, GPIO_IN);`,
			pull === 'up'   ? `    gpio_pull_up(${pinNum}U);` : '',
			pull === 'down' ? `    gpio_pull_down(${pinNum}U);` : '',
			af !== undefined
				? `    gpio_set_function(${pinNum}U, ${af}U); /* GPIO_FUNC_SPI=1, GPIO_FUNC_UART=2, GPIO_FUNC_I2C=3, GPIO_FUNC_PWM=4 */`
				: `    /* gpio_set_function(${pinNum}U, GPIO_FUNC_xxx); — set when attaching to peripheral */`,
			`}`,
		].filter(l => l !== '').join('\n');
	}
	if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
		const portLetter = String.fromCharCode(65 + (pinNum >> 5));
		const realPin = pinNum & 31;
		return [
			`/* Kinetis GPIO config: PT${portLetter}${realPin} as ${mode}${af !== undefined ? ` MUX${af}` : ''} */`,
			`/* Kinetis uses PORT_PCR (pin control register) for mux + drive strength */`,
			'',
			`static inline void gpio_config_pt${portLetter.toLowerCase()}${realPin}(void)`,
			`{`,
			`    /* Enable clock gate for PORT${portLetter} */`,
			`    SIM->SCGC5 |= SIM_SCGC5_PORT${portLetter}_MASK;`,
			`    /* Set pin MUX: 0=analog, 1=GPIO, 2-7=ALT */`,
			`    PORT${portLetter}->PCR[${realPin}U] = PORT_PCR_MUX(${af ?? 1}U)`,
			pull === 'up'   ? `                         | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK /* pull-up */` : '',
			pull === 'down' ? `                         | PORT_PCR_PE_MASK /* pull-down */` : '',
			`                         ;`,
			mode === 'output'
				? `    PT${portLetter}->PDDR |=  (1UL << ${realPin}U); /* output */`
				: `    PT${portLetter}->PDDR &= ~(1UL << ${realPin}U); /* input */`,
			`}`,
		].filter(l => l !== '').join('\n');
	}
	if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
		const grp = port === 'B' ? '1' : '0';
		return [
			`/* SAM GPIO config: P${port}${pinNum} as ${mode}${af !== undefined ? ` MUX${String.fromCharCode(65 + af)}` : ''} */`,
			'',
			`static inline void gpio_config_p${port.toLowerCase()}${pinNum}(void)`,
			`{`,
			`    /* Enable PORT clock */`,
			`    MCLK->APBBMASK.bit.PORT_ = 1;`,
			af !== undefined
				? [
					`    /* Enable peripheral MUX and set function */`,
					`    PORT->Group[${grp}U].PINCFG[${pinNum}U].bit.PMUXEN = 1;`,
					`    if (${pinNum} & 1) PORT->Group[${grp}U].PMUX[${pinNum}>>1].bit.PMUXO = ${af}U;`,
					`    else              PORT->Group[${grp}U].PMUX[${pinNum}>>1].bit.PMUXE = ${af}U;`,
					`    /* MUX values: A=0(EIC), B=1(REF/ADC/DAC), C=2(SERCOM), D=3(SERCOM-ALT), E=4(TC/TCC), F=5(TCC-ALT), G=6(I2S), H=7(USB), ... */`,
				].join('\n')
				: [
					mode === 'output'
						? `    PORT->Group[${grp}U].DIRSET.reg = (1UL << ${pinNum}U);`
						: `    PORT->Group[${grp}U].DIRCLR.reg = (1UL << ${pinNum}U);`,
					pull === 'up'   ? `    PORT->Group[${grp}U].OUTSET.reg = (1UL << ${pinNum}U); /* pull-up requires INEN+PULLEN in PINCFG */` : '',
					pull === 'down' ? `    PORT->Group[${grp}U].OUTCLR.reg = (1UL << ${pinNum}U);` : '',
					`    PORT->Group[${grp}U].PINCFG[${pinNum}U].bit.INEN = ${mode === 'input' ? 1 : 0}U;`,
				].join('\n'),
			`}`,
		].filter(l => l !== '').join('\n');
	}
	if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
		return [
			`/* Renesas RA GPIO config: P${port}${pinNum.toString().padStart(2, '0')} as ${mode}${af !== undefined ? ` PSEL${af}` : ''} */`,
			`/* RA uses PmnPFS registers — FSP API is preferred */`,
			'',
			`static inline void gpio_config_p${port.toLowerCase()}${pinNum.toString().padStart(2, '0')}(void)`,
			`{`,
			`    /* Write pin function select register */`,
			`    R_PFS->PORT[${parseInt(port, 36) - 9}U].PIN[${pinNum}U].PmnPFS = `,
			af !== undefined
				? `        (1U << R_PFS_PORT_PIN_PmnPFS_PMR_Pos)   /* peripheral mode */`
				: `        (${mode === 'output' ? '1' : '0'}U << R_PFS_PORT_PIN_PmnPFS_PDR_Pos) /* direction */`,
			pull === 'up'   ? `        | (1U << R_PFS_PORT_PIN_PmnPFS_PCR_Pos) /* pull-up */` : '',
			af !== undefined
				? `        | ((uint32_t)${af}U << R_PFS_PORT_PIN_PmnPFS_PSEL_Pos); /* peripheral select */`
				: `        ;`,
			`}`,
		].filter(l => l !== '').join('\n');
	}
	if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
		return [
			`/* EFR32 GPIO config: P${port}${pinNum} as ${mode}${af !== undefined ? ` loc ${af}` : ''} */`,
			`/* EFR32 uses CMU_ClockEnable(cmuClock_GPIO) + GPIO_PinModeSet */`,
			'',
			`static inline void gpio_config_p${port.toLowerCase()}${pinNum}(void)`,
			`{`,
			`    CMU_ClockEnable(cmuClock_GPIO, true);`,
			mode === 'output'
				? `    GPIO_PinModeSet(gpioPort${port}, ${pinNum}U, gpioModePushPull, ${outputType === 'open-drain' ? 'gpioModeWiredAnd' : 'gpioModePushPull'}, 0U);`
				: pull !== 'none'
					? `    GPIO_PinModeSet(gpioPort${port}, ${pinNum}U, ${pull === 'up' ? 'gpioModeInputPull' : 'gpioModeInputPullFilter'}, 1U);`
					: `    GPIO_PinModeSet(gpioPort${port}, ${pinNum}U, gpioModeInput, 0U);`,
			af !== undefined
				? `    /* Route to peripheral via ROUTEPEN/ROUTELOC0: see RM for ${port}${pinNum} location */`
				: '',
			`}`,
		].filter(l => l !== '').join('\n');
	}

	// STM32F1 uses completely different GPIO register layout (CRL/CRH, no MODER/AFR)
	if (fam.startsWith('STM32F1')) {
		return _generateGPIOConfigF1(port, pinNum, mode, speed, pull, af, outputType, baseAddr, rccMap);
	}

	// Clock enable register differs by family
	let gpioClock: string;
	if (fam.startsWith('STM32F0') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')) {
		gpioClock = `RCC->AHBENR |= RCC_AHBENR_GPIO${port}EN;`;
	} else if (fam.startsWith('STM32G0') || fam.startsWith('STM32L0') || fam.startsWith('STM32L1')) {
		gpioClock = `RCC->IOPENR |= RCC_IOPENR_GPIO${port}EN;`;
	} else if (fam.startsWith('STM32H7')) {
		gpioClock = `RCC->AHB4ENR |= RCC_AHB4ENR_GPIO${port}EN;`;
	} else if (fam.startsWith('STM32L4') || fam.startsWith('STM32L5') || fam.startsWith('STM32G4')) {
		gpioClock = `RCC->AHB2ENR |= RCC_AHB2ENR_GPIO${port}EN;  /* GPIO is on AHB2 for L4/G4 */`;
	} else {
		gpioClock = `RCC->AHB1ENR |= RCC_AHB1ENR_GPIO${port}EN;`;
	}

	const lines = [
		`/* Auto-generated GPIO config: P${port}${pinNum} as ${mode}${af !== undefined ? `, AF${af}` : ''} */`,
		`/* GPIO${port} base: ${baseAddr} */`,
		'',
		`void gpio_config_p${port.toLowerCase()}${pinNum}(void)`,
		`{`,
		`    /* 1. Enable GPIO${port} clock */`,
		`    ${gpioClock}`,
		'',
		`    /* 2. Mode: ${mode} (MODER[${pinNum * 2 + 1}:${pinNum * 2}] = 0b${mBits.toString(2).padStart(2, '0')}) */`,
		`    GPIO${port}->MODER &= ~(0x3UL << (${pinNum}U * 2U));`,
		`    GPIO${port}->MODER |=  (${mBits}UL << (${pinNum}U * 2U));`,
	];

	if (mode === 'output' || mode === 'alternate') {
		lines.push('');
		lines.push(`    /* 3. Output type: ${outputType} (OTYPER[${pinNum}] = ${otVal}) */`);
		lines.push(`    GPIO${port}->OTYPER ${otVal ? '|=' : '&= ~'}(0x1UL << ${pinNum}U);`);
		lines.push('');
		lines.push(`    /* 4. Output speed: ${speed} (OSPEEDR[${pinNum * 2 + 1}:${pinNum * 2}] = ${sBits}) */`);
		lines.push(`    GPIO${port}->OSPEEDR &= ~(0x3UL << (${pinNum}U * 2U));`);
		lines.push(`    GPIO${port}->OSPEEDR |=  (${sBits}UL << (${pinNum}U * 2U));`);
	}

	if (pull !== 'none') {
		lines.push('');
		lines.push(`    /* 5. Pull: ${pull} (PUPDR[${pinNum * 2 + 1}:${pinNum * 2}] = ${pBits}) */`);
		lines.push(`    GPIO${port}->PUPDR &= ~(0x3UL << (${pinNum}U * 2U));`);
		lines.push(`    GPIO${port}->PUPDR |=  (${pBits}UL << (${pinNum}U * 2U));`);
	}

	if (mode === 'alternate' && af !== undefined) {
		const afrIdx = pinNum < 8 ? 0 : 1;
		const afrBit = (pinNum % 8) * 4;
		lines.push('');
		lines.push(`    /* 6. Alternate function: AF${af} — AFR[${afrIdx}] bits [${afrBit + 3}:${afrBit}] */`);
		lines.push(`    GPIO${port}->AFR[${afrIdx}U] &= ~(0xFUL << ${afrBit}U);`);
		lines.push(`    GPIO${port}->AFR[${afrIdx}U] |=  (${af}UL  << ${afrBit}U);`);
	}

	lines.push(`}`);
	return lines.join('\n');
}


function _generateRTOSTask(
	taskName: string,
	rtos: string,
	stackSize: number | undefined,
	priority: number | undefined,
	sync: string,
): string {
	if (rtos === 'zephyr') {
		const stack = stackSize ?? 1024;
		const prio = priority ?? 5;
		return [
			`/* Auto-generated Zephyr thread skeleton: ${taskName} */`,
			'',
			`#include <zephyr/kernel.h>`,
			'',
			`/* Stack and thread definitions */`,
			`K_THREAD_STACK_DEFINE(${taskName}_stack, ${stack}U);`,
			`static struct k_thread ${taskName}_thread_data;`,
			sync === 'queue' ? `K_MSGQ_DEFINE(${taskName}_msgq, sizeof(uint32_t), 8U, 4U);` : '',
			sync === 'semaphore' ? `K_SEM_DEFINE(${taskName}_sem, 0U, 1U);` : '',
			'',
			`static void ${taskName}_thread(void *p1, void *p2, void *p3)`,
			`{`,
			`    ARG_UNUSED(p1); ARG_UNUSED(p2); ARG_UNUSED(p3);`,
			'',
			`    while (1) {`,
			sync === 'queue' ? `        uint32_t msg;\n        k_msgq_get(&${taskName}_msgq, &msg, K_FOREVER);` : '',
			sync === 'semaphore' ? `        k_sem_take(&${taskName}_sem, K_FOREVER);` : '',
			sync === 'none' ? `        k_sleep(K_MSEC(10U));` : '',
			`        /* TODO: ${taskName} work here */`,
			`    }`,
			`}`,
			'',
			`/* Call from main() to start the thread */`,
			`void ${taskName}_init(void)`,
			`{`,
			`    k_thread_create(&${taskName}_thread_data, ${taskName}_stack,`,
			`                    K_THREAD_STACK_SIZEOF(${taskName}_stack),`,
			`                    ${taskName}_thread, NULL, NULL, NULL,`,
			`                    ${prio}, 0U, K_NO_WAIT);`,
			`    k_thread_name_set(&${taskName}_thread_data, "${taskName}");`,
			`}`,
		].filter(l => l !== '').join('\n');
	}

	// FreeRTOS (default)
	const stack = stackSize ?? 256;
	const prio = priority ?? 5;

	return [
		`/* Auto-generated FreeRTOS task skeleton: ${taskName} */`,
		'',
		`#include "FreeRTOS.h"`,
		`#include "task.h"`,
		sync === 'queue' ? `#include "queue.h"` : '',
		sync === 'semaphore' ? `#include "semphr.h"` : '',
		'',
		sync === 'queue' ? `static QueueHandle_t ${taskName}_queue;` : '',
		sync === 'semaphore' ? `static SemaphoreHandle_t ${taskName}_sem;` : '',
		sync !== 'none' ? `static TaskHandle_t ${taskName}_handle;` : '',
		'',
		`static void ${taskName}_task(void *pvParameters)`,
		`{`,
		`    (void)pvParameters;`,
		'',
		`    for (;;) {`,
		sync === 'queue' ? `        uint32_t msg;\n        if (xQueueReceive(${taskName}_queue, &msg, portMAX_DELAY) == pdTRUE) {` : '',
		sync === 'semaphore' ? `        xSemaphoreTake(${taskName}_sem, portMAX_DELAY);` : '',
		sync === 'none' ? `        vTaskDelay(pdMS_TO_TICKS(10U));` : '',
		`        /* TODO: ${taskName} work here */`,
		sync === 'queue' ? `        }` : '',
		`    }`,
		`}`,
		'',
		`/* Call from main() before vTaskStartScheduler() */`,
		`void ${taskName}_init(void)`,
		`{`,
		sync === 'queue' ? `    ${taskName}_queue = xQueueCreate(8U, sizeof(uint32_t));` : '',
		sync === 'semaphore' ? `    ${taskName}_sem = xSemaphoreCreateBinary();` : '',
		`    xTaskCreate(`,
		`        ${taskName}_task,`,
		`        "${taskName}",`,
		`        ${stack}U,   /* stack depth in words */`,
		`        NULL,`,
		`        ${prio}U,    /* priority */`,
		sync !== 'none' ? `        &${taskName}_handle` : `        NULL`,
		`    );`,
		`}`,
	].filter(l => l !== '').join('\n');
}


function _generateGPIOConfigF1(
	port: string,
	pinNum: number,
	mode: string,
	speed: string,
	pull: string,
	af: number | undefined,
	outputType: string,
	baseAddr: string,
	rccMap: IPeripheralRegisterMap | undefined,
): string {
	// F1: GPIO configured via CRL (pins 0-7) or CRH (pins 8-15)
	// CNF[1:0] + MODE[1:0] per pin in 4-bit nibbles
	// MODE: 00=input, 01=output 10MHz, 10=output 2MHz, 11=output 50MHz
	// In input: CNF 00=analog, 01=floating, 10=pull-up/down
	// In output: CNF 00=push-pull, 01=open-drain, 10=AF push-pull, 11=AF open-drain
	const crReg = pinNum < 8 ? 'CRL' : 'CRH';
	const shift = (pinNum % 8) * 4;

	let modeVal: number; // 2-bit MODE field
	let cnfVal: number;  // 2-bit CNF field

	if (mode === 'input') {
		modeVal = 0; // input mode
		if (pull === 'none') { cnfVal = 1; }  // floating input
		else { cnfVal = 2; }                   // pull-up/pull-down input
	} else if (mode === 'analog') {
		modeVal = 0;
		cnfVal = 0; // analog mode
	} else if (mode === 'alternate') {
		modeVal = speed === 'low' ? 1 : speed === 'medium' ? 2 : 3;
		cnfVal = outputType === 'open-drain' ? 3 : 2; // AF OD or AF PP
	} else {
		// output
		modeVal = speed === 'low' ? 1 : speed === 'medium' ? 2 : 3;
		cnfVal = outputType === 'open-drain' ? 1 : 0; // GP OD or GP PP
	}

	const nibble = (cnfVal << 2) | modeVal;
	const gpioClock = rccMap ? `RCC->APB2ENR |= RCC_APB2ENR_IOP${port}EN;` : `/* RCC->APB2ENR |= RCC_APB2ENR_IOP${port}EN; */`;

	const lines = [
		`/* Auto-generated GPIO config: P${port}${pinNum} (STM32F1) as ${mode}${af !== undefined ? ` AF${af}` : ''} */`,
		`/* GPIO${port} base: ${baseAddr} */`,
		`/* NOTE: STM32F1 uses CRL/CRH registers (not MODER/AFR like F4) */`,
		'',
		`void gpio_config_p${port.toLowerCase()}${pinNum}(void)`,
		`{`,
		`    /* 1. Enable GPIO${port} clock (F1: all GPIO on APB2) */`,
		`    ${gpioClock}`,
		'',
		`    /* 2. Configure ${crReg}[${shift + 3}:${shift}]: CNF=${cnfVal} MODE=${modeVal} */`,
		`    GPIO${port}->${crReg} &= ~(0xFUL << ${shift}U);`,
		`    GPIO${port}->${crReg} |=  (0x${nibble.toString(16).toUpperCase()}UL << ${shift}U);  /* CNF=${cnfVal.toString(2).padStart(2, '0')}b MODE=${modeVal.toString(2).padStart(2, '0')}b */`,
	];

	if (mode === 'input' && pull !== 'none') {
		lines.push('');
		lines.push(`    /* 3. ${pull === 'up' ? 'Pull-up' : 'Pull-down'} via ODR bit */`);
		lines.push(`    GPIO${port}->ODR ${pull === 'up' ? '|=' : '&= ~'}(1UL << ${pinNum}U);`);
	}

	if (mode === 'alternate') {
		lines.push('');
		lines.push(`    /* Note: F1 does not have AFR register. AFIO->MAPR remapping may be needed. */`);
		lines.push(`    /* Use AFIO->MAPR to remap peripherals if using non-default pin assignments. */`);
		if (af !== undefined) {
			lines.push(`    /* Alternate function AF${af} — check RM0008 Table 5 for AFIO_MAPR bits for this peripheral */`);
		}
	}

	lines.push(`}`);
	return lines.join('\n');
}


// ─── DMA lookup helpers ───────────────────────────────────────────────────────

function _dmaStreamForPeriph(periph: string, dir: string, family: string): number {
	// STM32F4/F7 DMA stream numbers for common peripherals
	const map: Record<string, Record<string, number>> = {
		'USART1': { 'periph-to-mem': 2, 'mem-to-periph': 7 },
		'USART2': { 'periph-to-mem': 5, 'mem-to-periph': 6 },
		'SPI1':   { 'periph-to-mem': 2, 'mem-to-periph': 3 },
		'SPI2':   { 'periph-to-mem': 3, 'mem-to-periph': 4 },
		'I2C1':   { 'periph-to-mem': 0, 'mem-to-periph': 6 },
		'ADC1':   { 'periph-to-mem': 0, 'mem-to-periph': 0 },
	};
	return map[periph]?.[dir] ?? 0;
}

function _dmaChannelForPeriph(periph: string, dir: string, _family: string): number {
	// STM32F4/F7 DMA channel selection for common peripherals
	const map: Record<string, number> = {
		'USART1': 4, 'USART2': 4, 'SPI1': 3, 'SPI2': 0, 'I2C1': 1, 'ADC1': 0,
	};
	return map[periph] ?? 0;
}

function _detectRTOS(frameworks: string[], buildSystem: string): string {
	if (buildSystem === 'zephyr') { return 'zephyr'; }
	return 'freertos';
}
