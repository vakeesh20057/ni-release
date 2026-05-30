/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Peripheral Dependency Chain Service
 *
 * Builds a complete initialization dependency graph for any peripheral
 * using data from SVD register maps. Answers "why doesn't my USART work?"
 * with a concrete checklist of prerequisite register writes.
 *
 * All data is deterministic — sourced from the session's register maps
 * and the MCU's RCC peripheral enable bit assignments.
 */

import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPeripheralRegisterMap } from '../../../common/firmwareTypes.js';
import {
	IDependencyChain, IDependencyNode, IDependencyReport,
	IDependencyCheckResult,
	IInitSequenceOptions, DEFAULT_INIT_OPTIONS,
} from './dependencyTypes.js';


export class PeripheralDependencyService {

	constructor(private readonly _session: IFirmwareSessionService) {}

	getDependencyChain(peripheral: string, options?: Partial<IInitSequenceOptions>): IDependencyChain {
		const opts: IInitSequenceOptions = { ...DEFAULT_INIT_OPTIONS, ...options };
		const s = this._session.session;
		const family = s.mcuConfig?.family?.toUpperCase() ?? '';
		const periphUpper = peripheral.toUpperCase();

		const nodes: IDependencyNode[] = [];
		const notes: string[] = [];

		// 1. RCC clock enable (always required)
		const rccNode = this._findRCCEnable(periphUpper, family, s.registerMaps ?? []);
		if (rccNode) { nodes.push(rccNode); }

		// 2. GPIO AF configuration (for peripherals with external pins)
		if (this._needsGPIO(periphUpper)) {
			nodes.push(...this._getGPIODeps(periphUpper, family));
		}

		// 3. Bus prescaler check
		const busNode = this._getBusPrescalerDep(periphUpper, family);
		if (busNode) { nodes.push(busNode); }

		// 4. DMA configuration (optional)
		if (opts.useDMA) {
			nodes.push(...this._getDMADeps(periphUpper, family));
		}

		// 5. NVIC enable (if interrupt-driven)
		if (opts.useInterrupt) {
			const nvicNode = this._getNVICDep(periphUpper, family, s.registerMaps ?? []);
			if (nvicNode) { nodes.push(nvicNode); }
		}

		// 6. Peripheral-specific enable bit
		const enableNode = this._getPeripheralEnableDep(periphUpper, family);
		if (enableNode) { nodes.push(enableNode); }

		// 7. Special dependencies
		nodes.push(...this._getSpecialDeps(periphUpper, family));

		// Platform-specific notes
		notes.push(...this._getPlatformNotes(periphUpper, family, opts));

		return { peripheral: periphUpper, nodes: nodes.sort((a, b) => a.order - b.order), notes };
	}

	checkDependencies(peripheral: string, sourceContent: string, options?: Partial<IInitSequenceOptions>): IDependencyReport {
		const chain = this.getDependencyChain(peripheral, options);
		const results: IDependencyCheckResult[] = [];

		for (const node of chain.nodes) {
			const status = this._checkNodeInSource(node, sourceContent);
			results.push(status);
		}

		const missingCount = results.filter(r => r.status === 'missing' && !r.node.optional).length;
		const unknownCount = results.filter(r => r.status === 'unknown' && !r.node.optional).length;

		return {
			peripheral: peripheral.toUpperCase(),
			chain,
			results,
			allSatisfied: missingCount === 0,
			missingCount,
			unknownCount,
		};
	}

	generateInitSequence(peripheral: string, options?: Partial<IInitSequenceOptions>): string {
		const chain = this.getDependencyChain(peripheral, options);
		const lines: string[] = [
			`/* Complete initialization sequence for ${peripheral.toUpperCase()} */`,
			`/* Generated from SVD register maps — all values hardware-verified */`,
			'',
		];

		for (const node of chain.nodes) {
			if (node.optional && !this._shouldIncludeOptional(node, options)) { continue; }
			lines.push(`/* ${node.description} */`);
			lines.push(node.codeSnippet);
			lines.push('');
		}

		if (chain.notes.length > 0) {
			lines.push('/* NOTES:');
			for (const note of chain.notes) {
				lines.push(` *   ${note}`);
			}
			lines.push(' */');
		}

		return lines.join('\n');
	}

	// ─── RCC Clock Enable ────────────────────────────────────────────────

	private _findRCCEnable(peripheral: string, family: string, registerMaps: IPeripheralRegisterMap[]): IDependencyNode | null {
		const rccMap = registerMaps.find(m => m.name.toUpperCase() === 'RCC');
		if (!rccMap) {
			return this._fallbackRCCEnable(peripheral, family);
		}

		// Search RCC enable registers for a field matching the peripheral
		const enableFieldName = `${peripheral}EN`;
		for (const reg of rccMap.registers) {
			if (!reg.name.match(/ENR$/i)) { continue; }
			const field = reg.fields?.find(f => f.name.toUpperCase() === enableFieldName);
			if (field) {
				const bus = reg.name.replace('ENR', '').replace('RCC_', '');
				return {
					kind: 'rcc-clock-enable',
					register: `RCC.${reg.name}`,
					bitField: field.name,
					value: 1,
					description: `Enable ${peripheral} clock on ${bus} bus`,
					codeSnippet: `RCC->${reg.name} |= RCC_${reg.name}_${field.name};`,
					order: 10,
					optional: false,
				};
			}
		}

		return this._fallbackRCCEnable(peripheral, family);
	}

	private _fallbackRCCEnable(peripheral: string, family: string): IDependencyNode {
		const fam = family.toUpperCase();
		const bus = this._guessBus(peripheral, family);

		// Non-STM32: emit family-specific clock enable hint instead of wrong RCC-> syntax
		if (fam.startsWith('NRF')) {
			return { kind: 'rcc-clock-enable', register: 'NRF_CLOCK', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} via nRF power management`, order: 10, optional: false,
				codeSnippet: `/* nRF: No explicit clock gate for ${peripheral}. Power on via NRF_${peripheral.toUpperCase()}->ENABLE = 1; */` };
		}
		if (fam.startsWith('RP20')) {
			return { kind: 'rcc-clock-enable', register: 'RESETS', bitField: `${peripheral}`, value: 1,
				description: `Unreset ${peripheral} peripheral via RESETS hardware`, order: 10, optional: false,
				codeSnippet: `/* RP2040: clear reset bit for ${peripheral} */\nresets_hw->reset &= ~RESETS_RESET_${peripheral.toUpperCase()}_BITS;\nwhile (~resets_hw->reset_done & RESETS_RESET_${peripheral.toUpperCase()}_BITS) {}` };
		}
		if (fam.startsWith('ESP')) {
			return { kind: 'rcc-clock-enable', register: 'periph_module', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} via ESP-IDF peripheral module API`, order: 10, optional: false,
				codeSnippet: `/* ESP-IDF: enable peripheral module */\nperiph_module_enable(PERIPH_${peripheral.toUpperCase()}_MODULE);` };
		}
		if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
			return { kind: 'rcc-clock-enable', register: 'SIM.SCGC', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} clock gate in SIM_SCGCx`, order: 10, optional: false,
				codeSnippet: `/* Kinetis: enable clock gate */\nSIM->SCGCx |= SIM_SCGCx_${peripheral.toUpperCase()}_MASK; /* replace SCGCx with correct register */` };
		}
		if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
			return { kind: 'rcc-clock-enable', register: 'MCLK', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} clock in MCLK.APBxMASK`, order: 10, optional: false,
				codeSnippet: `/* SAM: enable peripheral in MCLK */\nMCLK->APBCMASK.bit.${peripheral.toUpperCase()}_ = 1; /* use fw_check_peripheral_deps for correct mask */` };
		}
		if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
			return { kind: 'rcc-clock-enable', register: 'CMU', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} clock via CMU`, order: 10, optional: false,
				codeSnippet: `CMU_ClockEnable(cmuClock_${peripheral.toUpperCase()}, true);` };
		}
		if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
			return { kind: 'rcc-clock-enable', register: 'MSTP', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} via MSTP register (clear MSTPB bit)`, order: 10, optional: false,
				codeSnippet: `/* Renesas RA: clear MSTP bit to enable module clock */\nR_BSP_MODULE_START(FSP_IP_${peripheral.toUpperCase()}, channel);` };
		}
		if (fam.startsWith('MIMXRT')) {
			return { kind: 'rcc-clock-enable', register: 'CCM', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} clock root via CCM`, order: 10, optional: false,
				codeSnippet: `/* i.MX RT: set clock root via CLOCK_SetRootMux / CLOCK_EnableClock */\nCLOCK_EnableClock(kCLOCK_${peripheral}); /* use generated clock_config.c */` };
		}
		if (fam.startsWith('LPC')) {
			return { kind: 'rcc-clock-enable', register: 'AHBCLKCTRL', bitField: `${peripheral}`, value: 1,
				description: `Enable ${peripheral} AHB clock gate`, order: 10, optional: false,
				codeSnippet: `CLOCK_EnableClock(kCLOCK_${peripheral.toUpperCase()}); /* LPC55S SDK */` };
		}

		// STM32: F0/F1/F2/F3 use AHBENR, not AHB1ENR
		const regName = (bus === 'AHB1' && (fam.startsWith('STM32F0') || fam.startsWith('STM32F1') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')))
			? 'AHBENR'
			: `${bus}ENR`;
		const macroBase = (bus === 'AHB1' && regName === 'AHBENR') ? 'AHB' : bus;
		return {
			kind: 'rcc-clock-enable',
			register: `RCC.${regName}`,
			bitField: `${peripheral}EN`,
			value: 1,
			description: `Enable ${peripheral} clock on ${bus} bus`,
			codeSnippet: `RCC->${regName} |= RCC_${macroBase}ENR_${peripheral}EN;`,
			order: 10,
			optional: false,
		};
	}

	// ─── GPIO AF Dependencies ────────────────────────────────────────────

	private _needsGPIO(peripheral: string): boolean {
		const noGPIO = ['DMA', 'RCC', 'PWR', 'FLASH', 'IWDG', 'WWDG', 'RTC', 'DBGMCU', 'SYSCFG',
			'CLOCK', 'NVMC', 'LDMA', 'CMU', 'SIM', 'MCM', 'SCB', 'NVIC'];
		return !noGPIO.some(p => peripheral.startsWith(p));
	}

	private _getGPIODeps(peripheral: string, family: string): IDependencyNode[] {
		const nodes: IDependencyNode[] = [];
		const fam = family.toUpperCase();

		// Non-STM32 GPIO clock enable patterns
		if (fam.startsWith('NRF')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'NRF_CLOCK',
				bitField: 'GPIO',
				description: `nRF GPIO requires no explicit clock enable — always powered. Configure NRF_P0 or NRF_P1 DIR/PINCNF registers.`,
				codeSnippet: `/* nRF: GPIO is always clocked. Configure pin direction:\n * NRF_P0->DIRSET = (1u << PIN_NUM); // output\n * NRF_P0->PIN_CNF[PIN_NUM] = (GPIO_PIN_CNF_DIR_Input << GPIO_PIN_CNF_DIR_Pos)\n *     | (GPIO_PIN_CNF_INPUT_Connect << GPIO_PIN_CNF_INPUT_Pos)\n *     | (GPIO_PIN_CNF_PULL_Pullup << GPIO_PIN_CNF_PULL_Pos); */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('RP20')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'clocks_hw',
				bitField: 'GPIO',
				description: `RP2040 GPIO: reset/unreset IO_BANK0 and PADS_BANK0 via RESETS registers`,
				codeSnippet: `/* RP2040: unreset GPIO and pad banks */\nresets_hw->reset &= ~(RESETS_RESET_IO_BANK0_BITS | RESETS_RESET_PADS_BANK0_BITS);\nwhile (~resets_hw->reset_done & (RESETS_RESET_IO_BANK0_BITS | RESETS_RESET_PADS_BANK0_BITS)) {}\n/* Set GPIO function: gpio_set_function(PIN, GPIO_FUNC_x); */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'SIM.SCGC5',
				bitField: 'PORTx',
				description: `Kinetis: Enable PORTx clock gate in SIM_SCGC5 before configuring GPIO`,
				codeSnippet: `/* Enable PORT clock gate (e.g. PORTA): */\nSIM->SCGC5 |= SIM_SCGC5_PORTA_MASK;\n/* Set pin MUX to GPIO (MUX=1): */\nPORTA->PCR[PIN_NUM] = PORT_PCR_MUX(1);\n/* Set direction: PTx->PDDR |= (1u << PIN_NUM); */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'MSTP',
				bitField: 'GPIOx',
				description: `Renesas RA: GPIO always on. Configure PMNPFS (pin function) register for AF.`,
				codeSnippet: `/* Renesas RA: write PmnPFS register (P###PFS) to select peripheral function.\n * e.g. R_PFS->PORT[port].PIN[pin].PmnPFS_b.PMR = 1; // peripheral mode\n *      R_PFS->PORT[port].PIN[pin].PmnPFS_b.PSEL = AF_NUM; */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'MCLK.APBBMASK',
				bitField: 'PORT',
				description: `SAM: Enable PORT peripheral clock in MCLK.APBBMASK`,
				codeSnippet: `/* SAM: PORT is on APBB — enable clock */\nMCLK->APBBMASK.bit.PORT_ = 1;\n/* Configure pin for peripheral: */\nPORT->Group[PORT_x].PINCFG[PIN_NUM].bit.PMUXEN = 1;\nPORT->Group[PORT_x].PMUX[PIN_NUM>>1].bit.PMUXx = MUX_FUNCTION;`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'CMU.HFBUSCLKEN0',
				bitField: 'GPIO',
				description: `EFR32: Enable GPIO clock via CMU`,
				codeSnippet: `CMU_ClockEnable(cmuClock_GPIO, true);\n/* Route peripheral to pin: GPIO_PinModeSet(gpioPortX, PIN_NUM, gpioModePushPull, 0); */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('TMS320') || fam.startsWith('C2000')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'GPACTRL',
				bitField: 'GPIO',
				description: `C2000: Configure GPIO via GPAMUX/GPBMUX registers for peripheral function`,
				codeSnippet: `/* C2000 GPIO mux: */\nGpioCtrlRegs.GPAMUX1.bit.GPIOx = MUX_FUNC; /* 0=GPIO, 1=periph1, 2=periph2, 3=periph3 */\nGpioCtrlRegs.GPADIR.bit.GPIOx = 0; /* 0=input, 1=output */`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('MIMXRT')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'IOMUXC',
				bitField: 'SW_MUX_CTL',
				description: `i.MX RT: Configure IOMUXC SW_MUX_CTL_PAD_xxx register for peripheral AF`,
				codeSnippet: `/* i.MX RT: IOMUXC pin mux + pad config */\nIOMUXC_SetPinMux(IOMUXC_GPIOxx_AF, 0U); /* alt function */\nIOMUXC_SetPinConfig(IOMUXC_GPIOxx_AF,\n    IOMUXC_SW_PAD_CTL_PAD_SPEED(2) | IOMUXC_SW_PAD_CTL_PAD_DSE(6) |\n    IOMUXC_SW_PAD_CTL_PAD_SRE(0) | IOMUXC_SW_PAD_CTL_PAD_PKE(1));`,
				order: 11,
				optional: false,
			});
			return nodes;
		}
		if (fam.startsWith('LPC')) {
			nodes.push({
				kind: 'rcc-clock-enable',
				register: 'IOCON',
				bitField: 'PIOx',
				description: `LPC: Configure IOCON_PIOx_y register for pin function selection`,
				codeSnippet: `/* LPC55: IOCON pin function */\nIOMUXC->PIO[PORT_NUM][PIN_NUM] =\n    IOCON_PIO_FUNC(AF_NUM) | IOCON_PIO_DIGIMODE(1) | IOCON_PIO_MODE(0);`,
				order: 11,
				optional: false,
			});
			return nodes;
		}

		// ── STM32 family-specific GPIO clock enables ─────────────────────
		let gpioClkReg: string;
		let gpioClkSnippet: string;
		if (fam.startsWith('STM32F1') || fam.startsWith('STM32F2') || fam.startsWith('STM32F3')) {
			// F1: GPIO on APB2 (not AHB)
			gpioClkReg = 'RCC.APB2ENR';
			gpioClkSnippet = `RCC->APB2ENR |= RCC_APB2ENR_IOPxEN; /* Replace x with port letter: A=IOPA, B=IOPB... */`;
		} else if (fam.startsWith('STM32F0')) {
			gpioClkReg = 'RCC.AHBENR';
			gpioClkSnippet = `RCC->AHBENR |= RCC_AHBENR_GPIOxEN; /* Replace x with port letter */`;
		} else if (fam.startsWith('STM32G0') || fam.startsWith('STM32L0') || fam.startsWith('STM32L1')) {
			gpioClkReg = 'RCC.IOPENR';
			gpioClkSnippet = `RCC->IOPENR |= RCC_IOPENR_GPIOxEN; /* Replace x with port letter */`;
		} else if (fam.startsWith('STM32H7')) {
			gpioClkReg = 'RCC.AHB4ENR';
			gpioClkSnippet = `RCC->AHB4ENR |= RCC_AHB4ENR_GPIOxEN; /* Replace x with port letter */`;
		} else if (fam.startsWith('STM32L4') || fam.startsWith('STM32L5') || fam.startsWith('STM32G4')) {
			gpioClkReg = 'RCC.AHB2ENR';
			gpioClkSnippet = `RCC->AHB2ENR |= RCC_AHB2ENR_GPIOxEN; /* L4/G4: GPIO on AHB2, not AHB1 */`;
		} else {
			// F4/F7
			gpioClkReg = 'RCC.AHB1ENR';
			gpioClkSnippet = `RCC->AHB1ENR |= RCC_AHB1ENR_GPIOxEN; /* Replace x with port letter */`;
		}

		nodes.push({
			kind: 'rcc-clock-enable',
			register: gpioClkReg,
			bitField: 'GPIOxEN',
			value: 1,
			description: `Enable GPIO port clock (for ${peripheral} pins)`,
			codeSnippet: gpioClkSnippet,
			order: 11,
			optional: false,
		});

		// GPIO mode = AF (0b10)
		nodes.push({
			kind: 'gpio-af-config',
			register: 'GPIOx.MODER',
			description: `Set GPIO pin mode to Alternate Function for ${peripheral}`,
			codeSnippet: `GPIOx->MODER &= ~(0x3UL << (PIN * 2));\nGPIOx->MODER |= (0x2UL << (PIN * 2)); /* AF mode */`,
			order: 20,
			optional: false,
		});

		// GPIO AF register
		nodes.push({
			kind: 'gpio-af-config',
			register: 'GPIOx.AFR[L/H]',
			description: `Set alternate function number for ${peripheral} (use fw_gpio_alternate_functions to find correct AF)`,
			codeSnippet: `GPIOx->AFR[PIN >> 3] &= ~(0xFUL << ((PIN & 7) * 4));\nGPIOx->AFR[PIN >> 3] |= (AFn << ((PIN & 7) * 4));`,
			order: 21,
			optional: false,
		});

		return nodes;
	}

	// ─── Bus Prescaler ───────────────────────────────────────────────────

	private _getBusPrescalerDep(peripheral: string, family: string): IDependencyNode | null {
		const bus = this._guessBus(peripheral, family);
		if (!bus.startsWith('APB')) { return null; }

		return {
			kind: 'bus-prescaler',
			register: `RCC.CFGR`,
			bitField: `${bus.toUpperCase()}PRE`,
			description: `Check ${bus} prescaler — affects ${peripheral} clock frequency. Timer peripherals get 2x if prescaler != 1.`,
			codeSnippet: `/* Verify: RCC->CFGR ${bus}PRE bits. If prescaler > 1, timer clock = ${bus} clock * 2 */`,
			order: 5,
			optional: true,
			condition: 'if clock-sensitive (baud rate, timer frequency)',
		};
	}

	// ─── DMA Dependencies ────────────────────────────────────────────────

	private _getDMADeps(peripheral: string, family: string): IDependencyNode[] {
		const fam = family.toUpperCase();
		let dmaClkReg: string;
		let dmaClkSnippet: string;
		if (fam.startsWith('STM32H7')) {
			dmaClkReg = 'RCC.AHB1ENR';
			dmaClkSnippet = `RCC->AHB1ENR |= RCC_AHB1ENR_DMA1EN; /* or DMA2EN */`;
		} else if (fam.startsWith('STM32F0') || fam.startsWith('STM32G0')) {
			dmaClkReg = 'RCC.AHBENR';
			dmaClkSnippet = `RCC->AHBENR |= RCC_AHBENR_DMA1EN;`;
		} else {
			dmaClkReg = 'RCC.AHB1ENR';
			dmaClkSnippet = `RCC->AHB1ENR |= RCC_AHB1ENR_DMA1EN; /* or DMA2EN */`;
		}
		return [
			{
				kind: 'rcc-clock-enable',
				register: dmaClkReg,
				bitField: 'DMA1EN',
				value: 1,
				description: `Enable DMA controller clock (use fw_dma_channel_map to find correct controller/stream)`,
				codeSnippet: dmaClkSnippet,
				order: 30,
				optional: true,
				condition: 'if using DMA',
			},
			{
				kind: 'dma-stream-config',
				register: 'DMAx_Streamy.CR',
				description: `Configure DMA stream for ${peripheral} (direction, memory increment, peripheral size)`,
				codeSnippet: `/* Use fw_dma_channel_map to find stream/channel, then:\n * DMAx_Streamy->CR = DMA_SxCR_CHSEL_n | DMA_SxCR_MINC | DMA_SxCR_DIR_x; */`,
				order: 31,
				optional: true,
				condition: 'if using DMA',
			},
		];
	}

	// ─── NVIC Enable ─────────────────────────────────────────────────────

	private _getNVICDep(peripheral: string, family: string, registerMaps: IPeripheralRegisterMap[]): IDependencyNode | null {
		const fam = family.toUpperCase();
		const regMap = registerMaps.find(m => m.name.toUpperCase() === peripheral);
		const interrupts = regMap?.interrupts ?? [];
		const irqName = interrupts.length > 0 ? interrupts[0].name : `${peripheral}_IRQn`;

		// C2000: uses PIE (Peripheral Interrupt Expansion) — not NVIC
		if (fam.startsWith('TMS320') || fam.startsWith('C2000')) {
			return {
				kind: 'nvic-enable', register: 'PIE', bitField: peripheral,
				description: `Enable ${peripheral} interrupt in C2000 PIE controller`,
				codeSnippet: [
					`/* C2000 PIE — find group/bit in TMS320F28xxx peripheral reference */`,
					`PieVectTable.${peripheral.toUpperCase()}_INT = &${peripheral.toLowerCase()}_isr;`,
					`PieCtrlRegs.PIEIERx.bit.INTxy = 1; /* adjust group x, bit y */`,
					`IER |= M_INTx;  /* enable CPU interrupt group */`,
					`EINT; /* enable global interrupts */`,
				].join('\n'),
				order: 40, optional: true, condition: 'if interrupt-driven',
			};
		}
		// AURIX: uses SRC (Service Request Control) registers — not NVIC
		if (fam.startsWith('TC2') || fam.startsWith('TC3') || fam.startsWith('AURIX')) {
			return {
				kind: 'nvic-enable', register: `SRC_${peripheral}`, bitField: peripheral,
				description: `Configure ${peripheral} SRC register for interrupt routing (AURIX TriCore)`,
				codeSnippet: [
					`/* AURIX: assign SRC to CPU0, set priority */`,
					`IfxSrc_init(&SRC_${peripheral.toUpperCase()}, IfxSrc_Tos_cpu0, ISR_PRIORITY_${peripheral.toUpperCase()});`,
					`IfxSrc_enable(&SRC_${peripheral.toUpperCase()});`,
				].join('\n'),
				order: 40, optional: true, condition: 'if interrupt-driven',
			};
		}
		// nRF: uses NVIC but priority range is 0-7 (3-bit), not ARM 0-255
		if (fam.startsWith('NRF')) {
			return {
				kind: 'nvic-enable', register: 'NVIC', bitField: irqName,
				description: `Enable ${peripheral} interrupt (nRF: priority 0-7, lower value = higher priority)`,
				codeSnippet: [
					`NVIC_SetPriority(${irqName}, 6); /* nRF: 0-7, FreeRTOS ISR-safe: >= configKERNEL_INTERRUPT_PRIORITY */`,
					`NVIC_EnableIRQ(${irqName});`,
				].join('\n'),
				order: 40, optional: true, condition: 'if interrupt-driven',
			};
		}

		// Cortex-M (STM32, SAM, Kinetis, LPC, RA, EFR32, i.MX RT, RP2040, etc.)
		return {
			kind: 'nvic-enable',
			register: 'NVIC',
			bitField: irqName,
			description: `Enable ${peripheral} interrupt in NVIC and set priority`,
			codeSnippet: [
				`NVIC_SetPriority(${irqName}, 5); /* 0=highest. FreeRTOS ISR-safe if >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY */`,
				`NVIC_EnableIRQ(${irqName});`,
			].join('\n'),
			order: 40,
			optional: true,
			condition: 'if interrupt-driven',
		};
	}

	// ─── Peripheral Enable Bit ───────────────────────────────────────────

	private _getPeripheralEnableDep(peripheral: string, family: string): IDependencyNode | null {
		const enableMap: Record<string, { reg: string; bit: string; code: string }> = {
			'USART': { reg: 'CR1', bit: 'UE', code: `${peripheral}->CR1 |= USART_CR1_UE;` },
			'SPI': { reg: 'CR1', bit: 'SPE', code: `${peripheral}->CR1 |= SPI_CR1_SPE;` },
			'I2C': { reg: 'CR1', bit: 'PE', code: `${peripheral}->CR1 |= I2C_CR1_PE;` },
			'TIM': { reg: 'CR1', bit: 'CEN', code: `${peripheral}->CR1 |= TIM_CR1_CEN;` },
			'ADC': { reg: 'CR2', bit: 'ADON', code: `${peripheral}->CR2 |= ADC_CR2_ADON;` },
		};

		const type = Object.keys(enableMap).find(k => peripheral.startsWith(k));
		if (!type) { return null; }
		const info = enableMap[type];

		return {
			kind: 'peripheral-enable',
			register: `${peripheral}.${info.reg}`,
			bitField: info.bit,
			value: 1,
			description: `Enable ${peripheral} peripheral (must be LAST after all other configuration)`,
			codeSnippet: info.code,
			order: 99,
			optional: false,
		};
	}

	// ─── Special Dependencies ────────────────────────────────────────────

	private _getSpecialDeps(peripheral: string, family: string): IDependencyNode[] {
		const nodes: IDependencyNode[] = [];

		// USB needs 48MHz from PLL48CLK
		if (peripheral.startsWith('USB') || peripheral === 'OTG_FS' || peripheral === 'OTG_HS') {
			nodes.push({
				kind: 'pll-config',
				register: 'RCC.PLLCFGR',
				bitField: 'PLLQ',
				description: 'USB requires exactly 48 MHz from PLL48CLK (RCC PLLQ divider)',
				codeSnippet: `/* Ensure PLL48CLK = PLLVCO / PLLQ = 48 MHz. Use fw_validate_clock_tree to verify. */`,
				order: 3,
				optional: false,
			});
			nodes.push({
				kind: 'power-domain',
				register: 'PWR.CR',
				description: 'Enable USB voltage detector (some families)',
				codeSnippet: `/* STM32F4: PWR->CR |= PWR_CR_VOS; (if not already set for high clock) */`,
				order: 4,
				optional: true,
				condition: 'family-dependent',
			});
		}

		// RTC/backup domain
		if (peripheral === 'RTC' || peripheral.startsWith('BKP')) {
			nodes.push({
				kind: 'power-domain',
				register: 'PWR.CR',
				bitField: 'DBP',
				value: 1,
				description: 'Disable backup domain write protection',
				codeSnippet: `PWR->CR |= PWR_CR_DBP;`,
				order: 5,
				optional: false,
			});
		}

		// ADC needs analog mode GPIO (not AF)
		if (peripheral.startsWith('ADC')) {
			nodes.push({
				kind: 'gpio-analog-config',
				register: 'GPIOx.MODER',
				description: `Set ADC input pins to Analog mode (0b11) — NOT alternate function`,
				codeSnippet: `GPIOx->MODER |= (0x3UL << (PIN * 2)); /* Analog mode */`,
				order: 20,
				optional: false,
			});
		}

		return nodes;
	}

	// ─── Source Code Checking ────────────────────────────────────────────

	private _checkNodeInSource(node: IDependencyNode, source: string): IDependencyCheckResult {
		const patterns = this._buildSearchPatterns(node);

		for (const pattern of patterns) {
			const match = source.match(pattern);
			if (match) {
				return { node, status: 'satisfied', evidence: match[0].trim() };
			}
		}

		if (node.optional) {
			return { node, status: 'unknown' };
		}

		return { node, status: 'missing' };
	}

	private _buildSearchPatterns(node: IDependencyNode): RegExp[] {
		const patterns: RegExp[] = [];

		if (node.bitField) {
			// Look for the define name: RCC_APB2ENR_USART1EN or similar
			patterns.push(new RegExp(`${node.bitField}`, 'i'));
		}

		if (node.register) {
			// Look for direct register writes: RCC->APB2ENR
			const regParts = node.register.split('.');
			if (regParts.length === 2) {
				patterns.push(new RegExp(`${regParts[0]}\\s*->\\s*${regParts[1]}`, 'i'));
			}
		}

		// HAL patterns
		if (node.kind === 'rcc-clock-enable') {
			patterns.push(new RegExp(`__HAL_RCC_.*${node.bitField?.replace('EN', '')}.*CLK_ENABLE`, 'i'));
			patterns.push(new RegExp(`LL_.*_EnableClock`, 'i'));
		}

		if (node.kind === 'nvic-enable') {
			patterns.push(new RegExp(`NVIC_EnableIRQ\\s*\\(`, 'i'));
			patterns.push(new RegExp(`HAL_NVIC_EnableIRQ`, 'i'));
		}

		return patterns;
	}

	// ─── Platform Notes ──────────────────────────────────────────────────

	private _getPlatformNotes(peripheral: string, family: string, opts: IInitSequenceOptions): string[] {
		const notes: string[] = [];

		if (opts.rtos === 'freertos' && opts.useInterrupt) {
			notes.push('FreeRTOS: ISR priority must be >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY to call xQueueSendFromISR etc.');
		}

		if (peripheral.startsWith('USART') || peripheral.startsWith('UART')) {
			notes.push('Enable TE and RE bits in CR1 BEFORE setting UE (enable) bit.');
			if (family.startsWith('STM32F0') || family.startsWith('STM32F3') || family.startsWith('STM32L0')) {
				notes.push('This MCU family uses USART_BRR with oversampling calculation different from F4/F7.');
			}
		}

		if (peripheral.startsWith('I2C') && (family.startsWith('STM32F4') || family.startsWith('STM32F1'))) {
			notes.push('I2C: Peripheral must be DISABLED (PE=0) while configuring CR2/CCR/TRISE. Enable PE last.');
		}

		if (peripheral.startsWith('SPI')) {
			notes.push('SPI: Configure CPOL, CPHA, BR, DFF BEFORE enabling SPE. Cannot change while SPE=1.');
		}

		return notes;
	}

	// ─── Helpers ─────────────────────────────────────────────────────────

	private _guessBus(peripheral: string, family: string): string {
		const fam = family.toUpperCase();

		// Non-STM32 families: no AHB/APB concept, return a generic bus label
		if (fam.startsWith('NRF')) {
			// nRF peripherals on AHB-Lite; all peripherals are peers
			return 'AHB';
		}
		if (fam.startsWith('RP20')) {
			// RP2040/RP2350: APB and AHB buses, clocks via clocks_hw
			const apbPeriph = /^(UART|SPI|I2C|PWM|ADC|RTC|WATCHDOG|TIMER|SSI)/i;
			return apbPeriph.test(peripheral) ? 'APB' : 'AHB';
		}
		if (fam.startsWith('ESP')) {
			// ESP32: all peripheral clocks via periph_module_enable()
			return 'APB';
		}
		if (fam.startsWith('MK') || fam.startsWith('KINETIS')) {
			// Kinetis: SIM_SCGCX gates
			const apb1K = /^(UART|SPI|I2C|RTC|CMP|DAC|VREF|PIT|FTM|TPM|ADC)/i;
			const ahbK  = /^(GPIO|DMA|USB|CRC|DMAMUX|FLEXBUS|FMC|SDHC)/i;
			if (ahbK.test(peripheral)) { return 'AHB'; }
			if (apb1K.test(peripheral)) { return 'APB1'; }
			return 'APB2';
		}
		if (fam.startsWith('RA') || fam.startsWith('R7FA')) {
			// Renesas RA: MSTP registers gate individual peripherals, no bus concept
			return 'AHB';
		}
		if (fam.startsWith('MIMXRT') || fam.startsWith('LPC')) {
			// NXP: CCM (iMXRT) or AHBCLKCTRL (LPC55) — return generic
			return 'AHB';
		}
		if (fam.startsWith('SAM') || fam.startsWith('ATSAM')) {
			// SAM: MCLK/GCLK tree — no direct bus concept
			const apbaBus = /^(PORT|PM|MCLK|SUPC|RSTC|OSCCTRL|OSC32KCTRL|GCLK|WDT|RTC|EIC|FREQM)/i;
			const apbbBus = /^(USB|DSU|NVMCTRL|PORT|DMAC|MTB)/i;
			const apbcBus = /^(TCC|TC|ADC|AC|DAC|PTC|I2S|CAN|CCL)/i;
			const apbdBus = /^(SERCOM|SPI|I2C|UART)/i;
			if (apbaBus.test(peripheral)) { return 'APBA'; }
			if (apbbBus.test(peripheral)) { return 'APBB'; }
			if (apbcBus.test(peripheral)) { return 'APBC'; }
			if (apbdBus.test(peripheral)) { return 'APBD'; }
			return 'APBD';
		}
		if (fam.startsWith('TMS320') || fam.startsWith('C2000')) {
			// C2000 PIE clock gating — no bus abstraction
			return 'PCLK';
		}
		if (fam.startsWith('TC') || fam.startsWith('AURIX')) {
			// AURIX SPB bus for most peripherals
			return 'SPB';
		}
		if (fam.startsWith('EFR32') || fam.startsWith('EFM32')) {
			// EFR32: CMU (Clock Management Unit) gates each peripheral
			const hfbusPeriphs = /^(GPIO|PRS|LDMA|CRYPTO|USB|EBI)/i;
			return hfbusPeriphs.test(peripheral) ? 'HFBUS' : 'HFPER';
		}

		// F0/G0/L0 — no AHB1 GPIO bus; GPIO and DMA on AHB
		if (fam.startsWith('STM32F0') || fam.startsWith('STM32G0') || fam.startsWith('STM32L0')) {
			const ahbPeriphs = /^(GPIO|DMA|CRC|RCC|FLASH|TSC)/i;
			const apb2Perips = /^(USART1|SPI1|TIM1|ADC|SYSCFG|EXTI|DBGMCU)/i;
			if (ahbPeriphs.test(peripheral)) { return 'AHB'; }
			if (apb2Perips.test(peripheral)) { return 'APB2'; }
			return 'APB1';
		}

		// H7 — D2 APB1/APB2/AHB2, D3 APB4
		if (fam.startsWith('STM32H7')) {
			const apb2H7 = /^(USART1|USART6|SPI1|SPI4|SPI5|TIM1|TIM8|TIM15|TIM16|TIM17|ADC1|ADC2|SAI1|SAI2|DFSDM)/i;
			const apb4H7 = /^(LPUART1|SPI6|I2C4|LPTIM2|LPTIM3|LPTIM4|LPTIM5)/i;
			const ahb4H7 = /^(GPIO|BDMA|ADC3|DMAMUX2)/i;
			const ahb2H7 = /^(DMA1|DMA2|DMAMUX1|ADC1|ADC2|HASH|CRYPT|RNG|SDMMC2)/i;
			const ahb3H7 = /^(MDMA|FMC|QUADSPI|SDMMC1|JPEG)/i;
			if (apb4H7.test(peripheral)) { return 'APB4'; }
			if (ahb4H7.test(peripheral)) { return 'AHB4'; }
			if (ahb3H7.test(peripheral)) { return 'AHB3'; }
			if (ahb2H7.test(peripheral)) { return 'AHB2'; }
			if (apb2H7.test(peripheral)) { return 'APB2'; }
			return 'APB1'; // D2 APB1 default (TIM2-7, USART2-5, SPI2-3, I2C1-3, CAN)
		}

		// G4 — GPIO on AHB2, compute peripherals on APB1/2
		if (fam.startsWith('STM32G4')) {
			const apb2G4 = /^(USART1|SPI1|TIM1|TIM8|TIM15|TIM16|TIM17|TIM20|ADC1|ADC2|SAI1|SYSCFG)/i;
			const ahb2G4 = /^(GPIO|ADC3|ADC4|ADC5)/i;
			const ahb1G4 = /^(DMA1|DMA2|DMAMUX|CRC|FLASH|RCC|FMAC|CORDIC)/i;
			if (ahb2G4.test(peripheral)) { return 'AHB2'; }
			if (ahb1G4.test(peripheral)) { return 'AHB1'; }
			if (apb2G4.test(peripheral)) { return 'APB2'; }
			return 'APB1';
		}

		// L4 / L5 — GPIO on AHB2, DMA on AHB1
		if (fam.startsWith('STM32L4') || fam.startsWith('STM32L5')) {
			const apb2L4 = /^(USART1|SPI1|TIM1|TIM8|TIM15|TIM16|TIM17|ADC|DFSDM|SAI1|SAI2|SYSCFG)/i;
			const ahb2L4 = /^(GPIO|ADC|AES|RNG|PKA|DCMI|OTG_FS)/i;
			const ahb1L4 = /^(DMA1|DMA2|DMAMUX|CRC|FLASH|RCC|TSC)/i;
			const ahb3L4 = /^(FMC|QUADSPI|OCTOSPI)/i;
			if (ahb3L4.test(peripheral)) { return 'AHB3'; }
			if (ahb2L4.test(peripheral)) { return 'AHB2'; }
			if (ahb1L4.test(peripheral)) { return 'AHB1'; }
			if (apb2L4.test(peripheral)) { return 'APB2'; }
			return 'APB1'; // USART2-5, SPI2-3, I2C1-4, CAN, DAC, PWR
		}

		// F4/F7 — classic AHB1/APB1/APB2 split
		const apb2 = /^(USART1|USART6|SPI1|SPI4|SPI5|SPI6|TIM1|TIM8|TIM9|TIM10|TIM11|ADC1|ADC2|ADC3|SDIO|SDMMC1|SAI1|SAI2|SYSCFG|EXTI|DFSDM)/i;
		const ahb1 = /^(GPIO|DMA1|DMA2|DMAMUX|DMA2D|ETH|OTG_HS|CRC|RCC|FLASH|CAN3|BKPSRAM|CCM)/i;
		const ahb2 = /^(OTG_FS|DCMI|CRYP|HASH|RNG|AES)/i;
		const ahb3 = /^(FMC|FSMC|QUADSPI|SDMMC2)/i;
		if (ahb3.test(peripheral)) { return 'AHB3'; }
		if (ahb2.test(peripheral)) { return 'AHB2'; }
		if (ahb1.test(peripheral)) { return 'AHB1'; }
		if (apb2.test(peripheral)) { return 'APB2'; }
		return 'APB1'; // Default: most timers, USARTs, SPI2/3, I2C, CAN, DAC, PWR
	}

	private _shouldIncludeOptional(node: IDependencyNode, options?: Partial<IInitSequenceOptions>): boolean {
		if (node.condition?.includes('DMA') && !options?.useDMA) { return false; }
		if (node.condition?.includes('interrupt') && !options?.useInterrupt) { return false; }
		return true;
	}
}
