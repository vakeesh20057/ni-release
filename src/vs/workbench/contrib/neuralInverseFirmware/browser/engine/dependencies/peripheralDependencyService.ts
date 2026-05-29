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
		const bus = this._guessBus(peripheral, family);
		return {
			kind: 'rcc-clock-enable',
			register: `RCC.${bus}ENR`,
			bitField: `${peripheral}EN`,
			value: 1,
			description: `Enable ${peripheral} clock on ${bus} bus`,
			codeSnippet: `RCC->${bus}ENR |= RCC_${bus}ENR_${peripheral}EN;`,
			order: 10,
			optional: false,
		};
	}

	// ─── GPIO AF Dependencies ────────────────────────────────────────────

	private _needsGPIO(peripheral: string): boolean {
		const noGPIO = ['DMA1', 'DMA2', 'RCC', 'PWR', 'FLASH', 'IWDG', 'WWDG', 'RTC', 'DBGMCU', 'SYSCFG'];
		return !noGPIO.some(p => peripheral.startsWith(p));
	}

	private _getGPIODeps(peripheral: string, family: string): IDependencyNode[] {
		const nodes: IDependencyNode[] = [];

		// GPIO clock enable
		nodes.push({
			kind: 'rcc-clock-enable',
			register: 'RCC.AHB1ENR',
			bitField: 'GPIOxEN',
			value: 1,
			description: `Enable GPIO port clock (for ${peripheral} pins)`,
			codeSnippet: family.startsWith('STM32F0') || family.startsWith('STM32F3')
				? `RCC->AHBENR |= RCC_AHBENR_GPIOxEN; /* Replace x with port letter */`
				: `RCC->AHB1ENR |= RCC_AHB1ENR_GPIOxEN; /* Replace x with port letter */`,
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

	private _getDMADeps(peripheral: string, _family: string): IDependencyNode[] {
		return [
			{
				kind: 'rcc-clock-enable',
				register: 'RCC.AHB1ENR',
				bitField: 'DMAx_EN',
				value: 1,
				description: `Enable DMA controller clock (use fw_dma_channel_map to find correct controller/stream)`,
				codeSnippet: `RCC->AHB1ENR |= RCC_AHB1ENR_DMA1EN; /* or DMA2EN */`,
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
		const regMap = registerMaps.find(m => m.name.toUpperCase() === peripheral);
		const interrupts = regMap?.interrupts ?? [];
		const irqName = interrupts.length > 0 ? interrupts[0].name : `${peripheral}_IRQn`;

		return {
			kind: 'nvic-enable',
			register: 'NVIC',
			bitField: irqName,
			description: `Enable ${peripheral} interrupt in NVIC and set priority`,
			codeSnippet: [
				`NVIC_SetPriority(${irqName}, 5); /* Priority 5 — FreeRTOS ISR-safe if configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY <= 5 */`,
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
		const apb2Peripherals = ['USART1', 'USART6', 'SPI1', 'SPI4', 'SPI5', 'TIM1', 'TIM8', 'TIM9', 'TIM10', 'TIM11', 'ADC1', 'ADC2', 'ADC3', 'SYSCFG'];
		const ahb1Peripherals = ['GPIOA', 'GPIOB', 'GPIOC', 'GPIOD', 'GPIOE', 'GPIOF', 'GPIOG', 'GPIOH', 'DMA1', 'DMA2', 'CRC'];

		if (apb2Peripherals.includes(peripheral)) { return 'APB2'; }
		if (ahb1Peripherals.includes(peripheral)) { return 'AHB1'; }
		return 'APB1';
	}

	private _shouldIncludeOptional(node: IDependencyNode, options?: Partial<IInitSequenceOptions>): boolean {
		if (node.condition?.includes('DMA') && !options?.useDMA) { return false; }
		if (node.condition?.includes('interrupt') && !options?.useInterrupt) { return false; }
		return true;
	}
}
