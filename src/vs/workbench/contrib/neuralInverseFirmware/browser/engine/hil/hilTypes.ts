/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hardware-in-the-Loop (HIL) Test Runner Types
 *
 * Defines structured test specifications for automated hardware testing.
 * Tests are stored as JSON in .inverse/hil-tests/ and results in .inverse/hil-results/.
 */

export interface IHILTestSpec {
	id: string;
	name: string;
	description?: string;
	/** Firmware binary to flash (relative to project root) */
	binary?: string;
	/** Whether to build before flashing (default: true) */
	buildFirst: boolean;
	/** Test stimulus actions executed in order */
	stimulus: IHILStimulus[];
	/** Expected observations — all must pass for the test to pass */
	expectations: IHILExpectation[];
	/** Maximum time for the entire test run */
	timeoutMs: number;
	/** Delay after flash before applying stimulus */
	postFlashDelayMs: number;
	/** Tags for filtering and grouping */
	tags?: string[];
}

export interface IHILStimulus {
	type: HILStimulusType;
	/** When to apply relative to test start (ms) */
	delayMs: number;
	params: Record<string, any>;
}

export type HILStimulusType =
	| 'serial-send'
	| 'gpio-set'
	| 'gpio-pulse'
	| 'wait'
	| 'reset-target'
	| 'power-cycle';

export interface IHILExpectation {
	type: HILExpectationType;
	/** Description shown in test report */
	description: string;
	params: Record<string, any>;
	/** Maximum time to wait for this expectation (ms) */
	timeoutMs?: number;
}

export type HILExpectationType =
	| 'serial-contains'
	| 'serial-regex'
	| 'serial-not-contains'
	| 'serial-sequence'
	| 'power-below-mw'
	| 'power-above-mw'
	| 'timing-within-us'
	| 'logic-pattern'
	| 'no-crash';

export interface IHILTestResult {
	testId: string;
	testName: string;
	passed: boolean;
	startTime: number;
	endTime: number;
	durationMs: number;
	buildResult?: { success: boolean; durationMs: number };
	flashResult?: { success: boolean; durationMs: number };
	expectationResults: IHILExpectationResult[];
	serialCapture: string;
	failureReason?: string;
}

export interface IHILExpectationResult {
	description: string;
	passed: boolean;
	actual?: string;
	expected?: string;
	message?: string;
}

export interface IHILSuiteResult {
	suiteName: string;
	startTime: number;
	endTime: number;
	totalTests: number;
	passedTests: number;
	failedTests: number;
	results: IHILTestResult[];
}
