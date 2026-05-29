/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILinkerScriptConfig {
	flashOrigin: number;
	flashSize: number;
	ramOrigin: number;
	ramSize: number;
	additionalRegions: IMemoryRegionConfig[];
	stackSize: number;
	heapSize: number;
	minStackSize: number;
	rtos?: 'freertos' | 'zephyr' | 'none';
	rtosHeapSize?: number;
	dmaBufferRegion?: string;   // Which memory region for DMA buffers
}

export interface IMemoryRegionConfig {
	name: string;
	origin: number;
	size: number;
	attributes: string;    // "rx", "rw", "rw!x" etc.
	isDMAAccessible: boolean;
	description: string;
}

export interface IMemoryBudget {
	regions: IRegionBudget[];
	totalFlashUsed: number;
	totalFlashAvailable: number;
	totalRAMUsed: number;
	totalRAMAvailable: number;
	stackOverflowRisk: StackRiskLevel;
	warnings: string[];
}

export interface IRegionBudget {
	name: string;
	origin: number;
	size: number;
	used: number;
	free: number;
	usagePercent: number;
	sections: ISectionAllocation[];
}

export interface ISectionAllocation {
	name: string;          // ".text", ".data", ".bss", ".heap", ".stack"
	size: number;
	address: number;
}

export type StackRiskLevel = 'safe' | 'tight' | 'overflow-likely' | 'unknown';

export interface IStackAnalysis {
	configuredSize: number;
	estimatedUsage: number;
	deepestCallChain: string[];
	riskLevel: StackRiskLevel;
	recommendation: string;
}
