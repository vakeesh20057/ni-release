/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type RTOSType = 'freertos' | 'zephyr' | 'threadx' | 'rtthread' | 'chibios' | 'none';

export interface IRTOSThreadInfo {
	id: number;
	name: string;
	state: RTOSThreadState;
	priority: number;
	stackBase: number;
	stackSize: number;
	stackUsed: number;
	stackHighWaterMark: number;
	runTimeCounter?: number;
	/** Percentage of CPU time used (if stats available) */
	cpuPercent?: number;
}

export type RTOSThreadState =
	| 'running'
	| 'ready'
	| 'blocked'
	| 'suspended'
	| 'deleted'
	| 'unknown';

export interface IRTOSHeapInfo {
	totalSize: number;
	freeSize: number;
	usedSize: number;
	minimumEverFree: number;
	allocCount: number;
	freeCount: number;
	largestFreeBlock: number;
}

export interface IRTOSSyncPrimitive {
	type: 'mutex' | 'semaphore' | 'queue' | 'event-group' | 'timer';
	name: string;
	/** For mutex: owner thread name; for semaphore: current count */
	value: string;
	/** Threads waiting on this primitive */
	waiters: string[];
}

export interface IRTOSTimerInfo {
	name: string;
	periodTicks: number;
	isAutoReload: boolean;
	isActive: boolean;
}

export interface IRTOSSnapshot {
	rtosType: RTOSType;
	timestamp: number;
	threads: IRTOSThreadInfo[];
	heap?: IRTOSHeapInfo;
	syncPrimitives: IRTOSSyncPrimitive[];
	timers: IRTOSTimerInfo[];
	tickCount: number;
}
