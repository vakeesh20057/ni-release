/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * HIL (Hardware-in-the-Loop) Test Service
 *
 * Executes structured hardware tests:
 *   1. Optionally build the firmware
 *   2. Flash to target
 *   3. Apply stimulus (serial commands, GPIO, delays)
 *   4. Observe outputs (serial, instruments)
 *   5. Evaluate expectations
 *   6. Report pass/fail with full capture
 *
 * Test definitions are stored as .inverse/hil-tests/<name>.json.
 * Results are stored in .inverse/hil-results/<timestamp>_<name>.json.
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IBuildSystemService } from '../build/buildSystemService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ISerialMonitorService } from '../serial/serialMonitorService.js';
import { IFirmwareDebugService } from '../debug/debugService.js';
import {
	IHILTestSpec,
	IHILTestResult,
	IHILExpectationResult,
	IHILSuiteResult,
	IHILExpectation,
	IHILStimulus,
} from './hilTypes.js';


export const IHILTestService = createDecorator<IHILTestService>('hilTestService');

export interface IHILTestService {
	readonly _serviceBrand: undefined;

	readonly isRunning: boolean;
	readonly onTestStarted: Event<IHILTestSpec>;
	readonly onTestCompleted: Event<IHILTestResult>;
	readonly onSuiteCompleted: Event<IHILSuiteResult>;

	/** Run a single HIL test. */
	runTest(spec: IHILTestSpec): Promise<IHILTestResult>;

	/** Run all HIL tests in .inverse/hil-tests/. */
	runSuite(filter?: { tags?: string[] }): Promise<IHILSuiteResult>;

	/** Load test specs from .inverse/hil-tests/. */
	loadTests(): Promise<IHILTestSpec[]>;

	/** Save a test spec to .inverse/hil-tests/<id>.json. */
	saveTest(spec: IHILTestSpec): Promise<void>;

	/** Abort a running test. */
	abort(): void;
}


class HILTestServiceImpl extends Disposable implements IHILTestService {
	readonly _serviceBrand: undefined;

	private _isRunning = false;
	private _cts: CancellationTokenSource | undefined;

	private readonly _onTestStarted = this._register(new Emitter<IHILTestSpec>());
	readonly onTestStarted = this._onTestStarted.event;

	private readonly _onTestCompleted = this._register(new Emitter<IHILTestResult>());
	readonly onTestCompleted = this._onTestCompleted.event;

	private readonly _onSuiteCompleted = this._register(new Emitter<IHILSuiteResult>());
	readonly onSuiteCompleted = this._onSuiteCompleted.event;

	get isRunning(): boolean { return this._isRunning; }

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IBuildSystemService private readonly _build: IBuildSystemService,
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
		@ISerialMonitorService private readonly _serial: ISerialMonitorService,
		@IFirmwareDebugService private readonly _debug: IFirmwareDebugService,
	) {
		super();
	}

	async runTest(spec: IHILTestSpec): Promise<IHILTestResult> {
		this._isRunning = true;
		this._cts = new CancellationTokenSource();
		this._onTestStarted.fire(spec);

		const startTime = Date.now();
		const result: IHILTestResult = {
			testId: spec.id,
			testName: spec.name,
			passed: false,
			startTime,
			endTime: 0,
			durationMs: 0,
			expectationResults: [],
			serialCapture: '',
		};

		try {
			const session = this._session.session;
			if (!session.isActive || !session.projectInfo) {
				result.failureReason = 'No active firmware session';
				return this._finalizeResult(result);
			}

			// Step 1: Build (optional)
			if (spec.buildFirst) {
				const buildStart = Date.now();
				const buildResult = await this._build.build(
					session.projectInfo.projectRoot,
					session.projectInfo.projectType,
				);
				result.buildResult = { success: buildResult.success, durationMs: Date.now() - buildStart };

				if (!buildResult.success) {
					result.failureReason = `Build failed with ${buildResult.errors.length} error(s)`;
					return this._finalizeResult(result);
				}
			}

			if (this._cts.token.isCancellationRequested) {
				result.failureReason = 'Aborted';
				return this._finalizeResult(result);
			}

			// Step 2: Flash
			const flashStart = Date.now();
			const flashResult = await this._build.flash(
				session.projectInfo.projectRoot,
				session.projectInfo.projectType,
			);
			result.flashResult = { success: flashResult.success, durationMs: Date.now() - flashStart };

			if (!flashResult.success) {
				result.failureReason = `Flash failed: ${flashResult.message}`;
				return this._finalizeResult(result);
			}

			// Step 3: Post-flash delay
			await this._delay(spec.postFlashDelayMs);

			if (this._cts.token.isCancellationRequested) {
				result.failureReason = 'Aborted';
				return this._finalizeResult(result);
			}

			// Step 4: Apply stimulus
			for (const stim of spec.stimulus) {
				if (this._cts.token.isCancellationRequested) break;
				await this._delay(stim.delayMs);
				await this._applyStimulus(stim);
			}

			// Step 5: Wait for observations
			const observeDeadline = Date.now() + spec.timeoutMs;
			await this._delay(Math.min(spec.timeoutMs, 3000));

			// Step 6: Capture serial
			const captureStart = startTime;
			const capturedLines = this._serial.rxBuffer.filter(l => l.timestamp >= captureStart);
			result.serialCapture = capturedLines.map(l => l.text).join('\n');

			// Step 7: Evaluate expectations
			result.expectationResults = spec.expectations.map(exp =>
				this._evaluateExpectation(exp, result.serialCapture, observeDeadline)
			);

			result.passed = result.expectationResults.every(r => r.passed);
			if (!result.passed) {
				const failed = result.expectationResults.filter(r => !r.passed);
				result.failureReason = `${failed.length} expectation(s) failed: ${failed.map(f => f.description).join(', ')}`;
			}

			return this._finalizeResult(result);
		} catch (err: any) {
			result.failureReason = `Exception: ${err.message ?? String(err)}`;
			return this._finalizeResult(result);
		} finally {
			this._isRunning = false;
			this._cts.dispose();
			this._cts = undefined;
		}
	}

	async runSuite(filter?: { tags?: string[] }): Promise<IHILSuiteResult> {
		const tests = await this.loadTests();
		const filtered = filter?.tags
			? tests.filter(t => t.tags?.some(tag => filter.tags!.includes(tag)))
			: tests;

		const startTime = Date.now();
		const results: IHILTestResult[] = [];

		for (const test of filtered) {
			if (this._cts?.token.isCancellationRequested) break;
			const result = await this.runTest(test);
			results.push(result);
		}

		const suite: IHILSuiteResult = {
			suiteName: filter?.tags ? `Suite [${filter.tags.join(', ')}]` : 'All Tests',
			startTime,
			endTime: Date.now(),
			totalTests: results.length,
			passedTests: results.filter(r => r.passed).length,
			failedTests: results.filter(r => !r.passed).length,
			results,
		};

		this._onSuiteCompleted.fire(suite);

		// Save suite result
		await this._saveSuiteResult(suite);

		return suite;
	}

	async loadTests(): Promise<IHILTestSpec[]> {
		const session = this._session.session;
		if (!session.projectInfo?.projectRoot) return [];

		const testsDir = URI.file(`${session.projectInfo.projectRoot}/.inverse/hil-tests`);
		try {
			const stat = await this._fileService.resolve(testsDir);
			if (!stat.children) return [];

			const tests: IHILTestSpec[] = [];
			for (const child of stat.children) {
				if (child.name.endsWith('.json')) {
					try {
						const content = await this._fileService.readFile(child.resource);
						const spec = JSON.parse(content.value.toString()) as IHILTestSpec;
						tests.push(spec);
					} catch { /* skip malformed files */ }
				}
			}
			return tests;
		} catch {
			return [];
		}
	}

	async saveTest(spec: IHILTestSpec): Promise<void> {
		const session = this._session.session;
		if (!session.projectInfo?.projectRoot) throw new Error('No active project');

		const filePath = URI.file(`${session.projectInfo.projectRoot}/.inverse/hil-tests/${spec.id}.json`);
		const content = JSON.stringify(spec, null, 2);
		await this._fileService.writeFile(filePath, VSBuffer.fromString(content));
	}

	abort(): void {
		this._cts?.cancel();
	}

	// ─── Private ─────────────────────────────────────────────────────────────

	private async _applyStimulus(stim: IHILStimulus): Promise<void> {
		switch (stim.type) {
			case 'serial-send':
				if (this._serial.connectionState.isConnected) {
					await this._serial.send(stim.params.data as string, stim.params.newline !== false);
				}
				break;
			case 'wait':
				await this._delay(stim.params.ms as number ?? 1000);
				break;
			case 'reset-target':
				if (this._debug.state.clientConnected) {
					await this._debug.sendCommand('monitor reset halt');
					await this._delay(100);
					await this._debug.sendCommand('continue');
				}
				break;
			case 'power-cycle':
				if (this._debug.state.clientConnected) {
					await this._debug.sendCommand('monitor power off');
					await this._delay(stim.params.offDurationMs as number ?? 500);
					await this._debug.sendCommand('monitor power on');
				}
				break;
			case 'gpio-set':
				if (this._debug.state.clientConnected) {
					const port = stim.params.port as string ?? 'A';
					const pin = stim.params.pin as number ?? 0;
					const value = stim.params.value as number ?? 1;
					const bsrr = value ? (1 << pin) : (1 << (pin + 16));
					await this._debug.sendCommand(`monitor mww 0x40020${port.charCodeAt(0) - 65}18 ${bsrr}`);
				}
				break;
			case 'gpio-pulse':
				if (this._debug.state.clientConnected) {
					const port = stim.params.port as string ?? 'A';
					const pin = stim.params.pin as number ?? 0;
					const pulseMs = stim.params.durationMs as number ?? 10;
					const bsrrSet = (1 << pin);
					const bsrrReset = (1 << (pin + 16));
					const addr = `0x40020${port.charCodeAt(0) - 65}18`;
					await this._debug.sendCommand(`monitor mww ${addr} ${bsrrSet}`);
					await this._delay(pulseMs);
					await this._debug.sendCommand(`monitor mww ${addr} ${bsrrReset}`);
				}
				break;
		}
	}

	private _evaluateExpectation(exp: IHILExpectation, serial: string, _observeDeadline: number): IHILExpectationResult {
		const result: IHILExpectationResult = {
			description: exp.description,
			passed: false,
		};

		switch (exp.type) {
			case 'serial-contains':
				result.passed = serial.includes(exp.params.text as string);
				result.expected = exp.params.text as string;
				if (!result.passed) result.message = `Expected serial to contain "${exp.params.text}"`;
				break;

			case 'serial-regex': {
				const regex = new RegExp(exp.params.pattern as string, exp.params.flags as string ?? '');
				result.passed = regex.test(serial);
				result.expected = exp.params.pattern as string;
				if (!result.passed) result.message = `Expected serial to match /${exp.params.pattern}/`;
				break;
			}

			case 'serial-not-contains':
				result.passed = !serial.includes(exp.params.text as string);
				if (!result.passed) result.message = `Expected serial NOT to contain "${exp.params.text}"`;
				break;

			case 'serial-sequence': {
				const sequence = exp.params.sequence as string[];
				let lastIdx = -1;
				result.passed = sequence.every(s => {
					const idx = serial.indexOf(s, lastIdx + 1);
					if (idx > lastIdx) { lastIdx = idx; return true; }
					return false;
				});
				if (!result.passed) result.message = 'Expected messages did not appear in sequence';
				break;
			}

			case 'no-crash':
				result.passed = !serial.includes('HardFault') &&
					!serial.includes('panic') &&
					!serial.includes('assert failed') &&
					!serial.includes('Guru Meditation Error');
				if (!result.passed) result.message = 'Crash/fault detected in serial output';
				break;

			case 'power-below-mw':
		case 'power-above-mw':
		case 'timing-within-us':
		case 'logic-pattern':
				result.message = `Expectation type "${exp.type}" requires instrument connection`;
				break;
		}

		return result;
	}

	private _finalizeResult(result: IHILTestResult): IHILTestResult {
		result.endTime = Date.now();
		result.durationMs = result.endTime - result.startTime;
		this._onTestCompleted.fire(result);
		void this._saveTestResult(result);
		return result;
	}

	private async _saveTestResult(result: IHILTestResult): Promise<void> {
		const session = this._session.session;
		if (!session.projectInfo?.projectRoot) return;

		const timestamp = new Date(result.startTime).toISOString().replace(/[:.]/g, '-');
		const filePath = URI.file(
			`${session.projectInfo.projectRoot}/.inverse/hil-results/${timestamp}_${result.testId}.json`
		);
		try {
			await this._fileService.writeFile(filePath, VSBuffer.fromString(JSON.stringify(result, null, 2)));
		} catch { /* non-critical */ }
	}

	private async _saveSuiteResult(suite: IHILSuiteResult): Promise<void> {
		const session = this._session.session;
		if (!session.projectInfo?.projectRoot) return;

		const timestamp = new Date(suite.startTime).toISOString().replace(/[:.]/g, '-');
		const filePath = URI.file(
			`${session.projectInfo.projectRoot}/.inverse/hil-results/suite_${timestamp}.json`
		);
		try {
			await this._fileService.writeFile(filePath, VSBuffer.fromString(JSON.stringify(suite, null, 2)));
		} catch { /* non-critical */ }
	}

	private _delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

registerSingleton(IHILTestService, HILTestServiceImpl, InstantiationType.Delayed);
