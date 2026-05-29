/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DependencyKind =
	| 'rcc-clock-enable'    // RCC APBx/AHBx peripheral clock enable bit
	| 'gpio-af-config'      // GPIO alternate function + mode config
	| 'gpio-analog-config'  // GPIO analog mode (ADC/DAC)
	| 'dma-stream-config'   // DMA stream/channel setup
	| 'nvic-enable'         // NVIC interrupt enable + priority set
	| 'bus-prescaler'       // APB prescaler affecting peripheral clock
	| 'pll-config'          // PLL configuration (USB, I2S)
	| 'power-domain'        // PWR domain enable (backup, USB)
	| 'peripheral-enable'   // Peripheral-specific enable bit (e.g. UE in USART)
	;

export interface IDependencyNode {
	kind: DependencyKind;
	register: string;          // Full register path: "RCC.APB2ENR"
	bitField?: string;         // Specific field: "USART1EN"
	value?: number;            // Expected value, e.g. 1 for enable
	description: string;       // Human-readable: "Enable USART1 clock on APB2 bus"
	codeSnippet: string;       // Ready-to-paste C code
	order: number;             // Execution order (lower = earlier)
	optional: boolean;         // e.g. DMA is optional for USART
	condition?: string;        // When this dep applies: "if using DMA", "if interrupt-driven"
}

export interface IDependencyChain {
	peripheral: string;        // e.g. "USART1"
	nodes: IDependencyNode[];
	notes: string[];           // Platform-specific warnings
}

export type DependencyStatus = 'satisfied' | 'missing' | 'unknown';

export interface IDependencyCheckResult {
	node: IDependencyNode;
	status: DependencyStatus;
	evidence?: string;         // e.g. "Found RCC->APB2ENR |= ... at main.c:42"
}

export interface IDependencyReport {
	peripheral: string;
	chain: IDependencyChain;
	results: IDependencyCheckResult[];
	allSatisfied: boolean;
	missingCount: number;
	unknownCount: number;
}

export interface IInitSequenceOptions {
	useDMA: boolean;
	useInterrupt: boolean;
	useHAL: boolean;           // HAL vs LL/bare-register
	rtos?: 'freertos' | 'zephyr' | 'none';
}

export const DEFAULT_INIT_OPTIONS: IInitSequenceOptions = {
	useDMA: false,
	useInterrupt: true,
	useHAL: false,
	rtos: 'none',
};
