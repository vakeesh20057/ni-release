/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IClosedLoopConfig {
	goal: string;
	passCriteria: IPassCriterion[];
	maxIterations: number;
	timeoutMs: number;
	observeChannels: ObserveChannel[];
	autoFix: boolean;
}

export interface IPassCriterion {
	type: 'serial-contains' | 'serial-regex' | 'serial-not-contains' | 'no-build-errors' | 'power-below' | 'timing-within' | 'register-equals' | 'custom';
	value: string;
	description?: string;
}

export type ObserveChannel = 'serial' | 'rtt' | 'itm' | 'logic-analyzer' | 'oscilloscope' | 'power-analyzer';

export interface IClosedLoopIteration {
	index: number;
	phase: ClosedLoopPhase;
	startTime: number;
	endTime?: number;
	buildResult?: { success: boolean; errorCount: number };
	flashResult?: { success: boolean; tool: string };
	observation?: IObservation;
	diagnosis?: string;
	fix?: { file: string; description: string };
	passCriteriaMet: boolean[];
}

export type ClosedLoopPhase = 'build' | 'flash' | 'observe' | 'diagnose' | 'fix' | 'complete' | 'failed';

export interface IObservation {
	channel: ObserveChannel;
	data: string;
	durationMs: number;
	timestamp: number;
}

export interface IClosedLoopResult {
	success: boolean;
	iterations: IClosedLoopIteration[];
	totalDurationMs: number;
	failureReason?: string;
	summary: string;
}

export const DEFAULT_CLOSED_LOOP_CONFIG: Omit<IClosedLoopConfig, 'goal' | 'passCriteria'> = {
	maxIterations: 10,
	timeoutMs: 300_000,
	observeChannels: ['serial'],
	autoFix: true,
};
