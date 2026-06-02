/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Closed-Loop Orchestrator
 *
 * Autonomous build → flash → observe → diagnose → fix cycle.
 * This is the core differentiator vs Embedder's autonomous loop.
 *
 * The orchestrator coordinates existing services:
 *   - IBuildSystemService for compilation + flash
 *   - ISerialMonitorService / IRTTService / IITMService for observation
 *   - IErrataService for silicon-bug diagnosis
 *   - IFormulaVerifierService for timing/register validation
 *
 * The agent LLM handles diagnosis + fix generation; this service provides
 * the deterministic loop structure, pass/fail evaluation, and iteration control.
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IBuildSystemService } from '../build/buildSystemService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ISerialMonitorService } from '../serial/serialMonitorService.js';
import { IRTTService } from '../serial/rttService.js';
import { IITMService } from '../serial/itmService.js';
import {
	IClosedLoopConfig,
	IClosedLoopIteration,
	IClosedLoopResult,
	IObservation,
	IPassCriterion,
	ClosedLoopPhase,
	DEFAULT_CLOSED_LOOP_CONFIG,
} from './closedLoopTypes.js';


export const IClosedLoopService = createDecorator<IClosedLoopService>('closedLoopService');

export interface IClosedLoopService {
	readonly _serviceBrand: undefined;

	readonly isRunning: boolean;
	readonly currentIteration: number;
	readonly onIterationCompleted: Event<IClosedLoopIteration>;
	readonly onLoopCompleted: Event<IClosedLoopResult>;
	readonly onPhaseChanged: Event<{ iteration: number; phase: ClosedLoopPhase }>;

	start(config: IClosedLoopConfig): Promise<IClosedLoopResult>;
	abort(): void;

	/**
	 * Evaluate pass criteria against an observation.
	 * Used both internally and by agents to check intermediate results.
	 */
	evaluateCriteria(criteria: IPassCriterion[], observation: IObservation): boolean[];
}


class ClosedLoopServiceImpl extends Disposable implements IClosedLoopService {
	readonly _serviceBrand: undefined;

	private _isRunning = false;
	private _currentIteration = 0;
	private _cts: CancellationTokenSource | undefined;

	private readonly _onIterationCompleted = this._register(new Emitter<IClosedLoopIteration>());
	readonly onIterationCompleted = this._onIterationCompleted.event;

	private readonly _onLoopCompleted = this._register(new Emitter<IClosedLoopResult>());
	readonly onLoopCompleted = this._onLoopCompleted.event;

	private readonly _onPhaseChanged = this._register(new Emitter<{ iteration: number; phase: ClosedLoopPhase }>());
	readonly onPhaseChanged = this._onPhaseChanged.event;

	get isRunning(): boolean { return this._isRunning; }
	get currentIteration(): number { return this._currentIteration; }

	constructor(
		@IBuildSystemService private readonly _build: IBuildSystemService,
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
		@ISerialMonitorService private readonly _serial: ISerialMonitorService,
		@IRTTService private readonly _rtt: IRTTService,
		@IITMService private readonly _itm: IITMService,
	) {
		super();
	}

	async start(config: IClosedLoopConfig): Promise<IClosedLoopResult> {
		if (this._isRunning) {
			throw new Error('Closed-loop already running');
		}

		const fullConfig = { ...DEFAULT_CLOSED_LOOP_CONFIG, ...config };
		this._isRunning = true;
		this._currentIteration = 0;
		this._cts = new CancellationTokenSource();

		const iterations: IClosedLoopIteration[] = [];
		const startTime = Date.now();

		try {
			while (this._currentIteration < fullConfig.maxIterations) {
				if (this._cts.token.isCancellationRequested) break;
				if (Date.now() - startTime > fullConfig.timeoutMs) break;

				this._currentIteration++;
				const iteration = await this._runIteration(
					this._currentIteration,
					fullConfig,
					this._cts.token,
				);
				iterations.push(iteration);
				this._onIterationCompleted.fire(iteration);

				if (iteration.passCriteriaMet.every(Boolean)) {
					const result: IClosedLoopResult = {
						success: true,
						iterations,
						totalDurationMs: Date.now() - startTime,
						summary: `Goal achieved in ${iterations.length} iteration(s): ${fullConfig.goal}`,
					};
					this._onLoopCompleted.fire(result);
					return result;
				}

				if (iteration.phase === 'failed' && !fullConfig.autoFix) {
					break;
				}
			}

			const timedOut = Date.now() - startTime > fullConfig.timeoutMs;
			const result: IClosedLoopResult = {
				success: false,
				iterations,
				totalDurationMs: Date.now() - startTime,
				failureReason: this._cts.token.isCancellationRequested
					? 'Aborted by user'
					: timedOut
						? `Timed out after ${fullConfig.timeoutMs}ms`
						: `Max iterations (${fullConfig.maxIterations}) reached without meeting pass criteria`,
				summary: `Failed after ${iterations.length} iteration(s): ${fullConfig.goal}`,
			};
			this._onLoopCompleted.fire(result);
			return result;
		} finally {
			this._isRunning = false;
			this._cts.dispose();
			this._cts = undefined;
		}
	}

	abort(): void {
		this._cts?.cancel();
	}

	evaluateCriteria(criteria: IPassCriterion[], observation: IObservation): boolean[] {
		return criteria.map(c => this._evaluateSingle(c, observation));
	}

	// ─── Private ─────────────────────────────────────────────────────────────

	private async _runIteration(
		index: number,
		config: IClosedLoopConfig,
		token: CancellationToken,
	): Promise<IClosedLoopIteration> {
		const iteration: IClosedLoopIteration = {
			index,
			phase: 'build',
			startTime: Date.now(),
			passCriteriaMet: config.passCriteria.map(() => false),
		};

		// Phase 1: Build
		this._onPhaseChanged.fire({ iteration: index, phase: 'build' });
		iteration.phase = 'build';

		const session = this._session.session;
		if (!session.isActive || !session.projectInfo) {
			iteration.phase = 'failed';
			iteration.endTime = Date.now();
			return iteration;
		}

		try {
			const buildResult = await this._build.build(
				session.projectInfo.projectRoot,
				session.projectInfo.projectType,
			);
			iteration.buildResult = {
				success: buildResult.success,
				errorCount: buildResult.errors.length,
			};

			if (!buildResult.success) {
				iteration.phase = 'diagnose';
				this._onPhaseChanged.fire({ iteration: index, phase: 'diagnose' });
				iteration.diagnosis = `Build failed with ${buildResult.errors.length} error(s). First: ${buildResult.errors[0]?.message ?? 'unknown'}`;
				iteration.endTime = Date.now();
				return iteration;
			}
		} catch {
			iteration.phase = 'failed';
			iteration.endTime = Date.now();
			return iteration;
		}

		if (token.isCancellationRequested) { iteration.endTime = Date.now(); return iteration; }

		// Phase 2: Flash
		this._onPhaseChanged.fire({ iteration: index, phase: 'flash' });
		iteration.phase = 'flash';

		try {
			const flashResult = await this._build.flash(
				session.projectInfo.projectRoot,
				session.projectInfo.projectType,
			);
			iteration.flashResult = {
				success: flashResult.success,
				tool: flashResult.tool,
			};

			if (!flashResult.success) {
				iteration.phase = 'diagnose';
				iteration.diagnosis = `Flash failed: ${flashResult.message}`;
				iteration.endTime = Date.now();
				return iteration;
			}
		} catch {
			iteration.phase = 'failed';
			iteration.endTime = Date.now();
			return iteration;
		}

		if (token.isCancellationRequested) { iteration.endTime = Date.now(); return iteration; }

		// Phase 3: Observe
		this._onPhaseChanged.fire({ iteration: index, phase: 'observe' });
		iteration.phase = 'observe';

		const observation = await this._observe(config);
		iteration.observation = observation;

		// Phase 4: Evaluate
		iteration.passCriteriaMet = this.evaluateCriteria(config.passCriteria, observation);

		if (!iteration.passCriteriaMet.every(Boolean)) {
			iteration.phase = 'diagnose';
			this._onPhaseChanged.fire({ iteration: index, phase: 'diagnose' });
			const failedCriteria = config.passCriteria
				.filter((_, i) => !iteration.passCriteriaMet[i])
				.map(c => c.description ?? `${c.type}: ${c.value}`);
			iteration.diagnosis = `Criteria not met: ${failedCriteria.join('; ')}`;
		} else {
			iteration.phase = 'complete';
		}

		iteration.endTime = Date.now();
		return iteration;
	}

	private async _observe(config: IClosedLoopConfig): Promise<IObservation> {
		const channel = config.observeChannels[0] ?? 'serial';
		const observeStart = Date.now();

		// Wait a fixed window for output to arrive (post-flash stabilisation)
		await this._delay(2000);

		let data = '';
		switch (channel) {
			case 'serial': {
				const lines = this._serial.rxBuffer.filter(l => l.timestamp >= observeStart);
				data = lines.map(l => l.text).join('\n');
				break;
			}
			case 'rtt': {
				const rttLines = this._rtt.getChannelLog(0);
				data = rttLines.join('\n');
				break;
			}
			case 'itm': {
				data = this._itm.getTextOutput();
				break;
			}
			default:
				data = '';
		}

		return {
			channel,
			data,
			durationMs: Date.now() - observeStart,
			timestamp: observeStart,
		};
	}

	private _evaluateSingle(criterion: IPassCriterion, observation: IObservation): boolean {
		switch (criterion.type) {
			case 'serial-contains':
				return observation.data.includes(criterion.value);
			case 'serial-regex':
				try { return new RegExp(criterion.value).test(observation.data); }
				catch { return false; }
			case 'serial-not-contains':
				return !observation.data.includes(criterion.value);
			case 'no-build-errors':
				return true; // If we reached observation, build succeeded
			default:
				return false;
		}
	}

	private _delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

registerSingleton(IClosedLoopService, ClosedLoopServiceImpl, InstantiationType.Delayed);
