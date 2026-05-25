/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Workflow Orchestrator
 *
 * Coordinates a multi-agent workflow: resolves step execution order,
 * runs each step via AgentExecutor, and threads outputs between steps.
 *
 * ## Step Ordering & Parallel Execution
 *
 * Steps are grouped into concurrency levels based on their dependsOn
 * declarations. All steps within a level have no mutual dependencies and
 * run concurrently via Promise.all. Levels execute sequentially — level N+1
 * starts only after every step in level N has completed successfully.
 *
 * Example: steps A, B (no deps), C (depends on A), D (depends on A, B)
 *   Level 0: [A, B]   — run concurrently
 *   Level 1: [C]      — runs after A finishes
 *   Level 2: [D]      — runs after both A and B finish
 *
 * ## Output Threading
 *
 * When step B declares dependsOn: ["stepA"], the finalOutput of stepA is
 * injected into stepB's execution context as prior step context. This allows
 * a planner step to produce a plan that an executor step then acts on.
 *
 * ## Failure Handling
 *
 * If any step in a level fails, the workflow is marked failed immediately.
 * Steps that have not yet run are marked 'skipped'. The error from the first
 * failing step is propagated to the IAgentRun.error field.
 */

import { ILLMMessageService } from '../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../../../void/common/voidSettingsService.js';
import { IAgentDefinition } from '../../common/workflowTypes.js';
import {
	IWorkflowDefinition, IWorkflowStep, IAgentRun, IStepRun,
	AgentRunStatus, IToolExecutionContext,
} from '../../common/workflowTypes.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { AgentExecutor, ICancellationToken, IPriorStepOutput } from '../executor/agentExecutor.js';

export type RunUpdateCallback = (run: IAgentRun) => void;

export class WorkflowOrchestrator {

	constructor(
		private readonly llmService: ILLMMessageService,
		private readonly settingsService: IVoidSettingsService,
		private readonly toolRegistry: ToolRegistry,
	) {}

	/**
	 * Execute a full workflow. Mutates the IAgentRun in place, calling onUpdate
	 * after each meaningful state change so the UI stays live.
	 */
	async run(
		workflow: IWorkflowDefinition,
		run: IAgentRun,
		agents: Map<string, IAgentDefinition>,
		baseCtx: Omit<IToolExecutionContext, 'log'>,
		input: string,
		cancellation: ICancellationToken,
		onUpdate: RunUpdateCallback,
	): Promise<IAgentRun> {

		run.status = 'planning';
		onUpdate(run);

		// Build concurrency levels: each level is a group of steps that can run in parallel
		let levels: IWorkflowStep[][];
		try {
			levels = this._buildConcurrencyLevels(workflow.steps);
		} catch (e: any) {
			run.status = 'failed';
			run.error = `Step ordering error: ${e.message}`;
			run.endedAt = Date.now();
			onUpdate(run);
			return run;
		}

		run.status = 'running';
		onUpdate(run);

		// Output map: stepId → finalOutput (for dependency injection into downstream steps)
		const stepOutputs = new Map<string, string>();

		for (const level of levels) {
			if (cancellation.cancelled) {
				run.status = 'cancelled';
				this._markRemainingSkipped(run, levels.flat(), stepOutputs);
				break;
			}

			// Validate all agents in this level before launching any
			for (const step of level) {
				if (!agents.get(step.agentId)) {
					const stepRun = run.steps.find(s => s.stepId === step.id);
					const err = `Agent definition "${step.agentId}" not found in .inverse/agents/`;
					if (stepRun) { stepRun.status = 'failed'; stepRun.error = err; }
					run.status = 'failed';
					run.error = err;
					run.endedAt = Date.now();
					this._markRemainingSkipped(run, levels.flat(), stepOutputs);
					onUpdate(run);
					return run;
				}
			}

			// Run all steps in this level concurrently
			await Promise.all(level.map(step => this._runStep(
				step, run, agents, baseCtx, input, stepOutputs, cancellation, onUpdate,
			)));

			// Collect outputs and check for failures before advancing to next level
			for (const step of level) {
				const stepRun = run.steps.find(s => s.stepId === step.id);
				if (!stepRun) continue;

				if (stepRun.status === 'failed') {
					run.status = 'failed';
					run.error = stepRun.error;
					run.endedAt = Date.now();
					this._markRemainingSkipped(run, levels.flat(), stepOutputs);
					onUpdate(run);
					return run;
				}

				if (stepRun.finalOutput) {
					stepOutputs.set(step.id, stepRun.finalOutput);
				}
			}
		}

		if (run.status !== 'cancelled') {
			// Final output = last completed step's output (last step of the last level)
			const allSteps = levels.flat();
			const lastStep = allSteps[allSteps.length - 1];
			run.finalOutput = stepOutputs.get(lastStep.id);
			run.status = 'done';
		}

		run.endedAt = Date.now();
		onUpdate(run);
		return run;
	}

	/**
	 * Execute a single step. Mutates stepRun and fires onUpdate on the parent run.
	 * Does NOT write to stepOutputs — the caller collects outputs after Promise.all settles.
	 */
	private async _runStep(
		step: IWorkflowStep,
		run: IAgentRun,
		agents: Map<string, IAgentDefinition>,
		baseCtx: Omit<IToolExecutionContext, 'log'>,
		input: string,
		stepOutputs: Map<string, string>,
		cancellation: ICancellationToken,
		onUpdate: RunUpdateCallback,
	): Promise<void> {
		const stepRun = run.steps.find(s => s.stepId === step.id);
		if (!stepRun) return;

		const agent = agents.get(step.agentId)!;

		const priorOutputs: IPriorStepOutput[] = (step.dependsOn ?? [])
			.map(depId => {
				const depStep = run.steps.find(s => s.stepId === depId);
				return {
					stepId: depId,
					role: depStep?.role ?? 'unknown',
					output: stepOutputs.get(depId) ?? '',
				};
			})
			.filter(p => p.output.length > 0);

		const scopedTools = this.toolRegistry.scope(step.allowedTools);
		const toolCtx: IToolExecutionContext = {
			workspaceUri: baseCtx.workspaceUri,
			fileService: baseCtx.fileService,
			log: (msg: string) => {
				stepRun.outputLog.push(`[${new Date().toISOString()}] ${msg}`);
				onUpdate(run);
			},
		};

		const executor = new AgentExecutor(this.llmService, this.settingsService, scopedTools);
		const stepInput = this._buildStepInput(step, input, priorOutputs, priorOutputs.length === 0 ? 0 : 1);

		await executor.execute(agent, step, stepRun, priorOutputs, toolCtx, stepInput, cancellation);
		onUpdate(run);
	}

	// ─── Concurrency Level Builder ───────────────────────────────────────────

	/**
	 * Groups steps into levels using Kahn's algorithm (BFS topological sort).
	 * Steps within the same level have no mutual dependencies and can run in parallel.
	 * Throws if a cycle is detected or a dependsOn reference is undefined.
	 */
	private _buildConcurrencyLevels(steps: IWorkflowStep[]): IWorkflowStep[][] {
		const stepMap = new Map(steps.map(s => [s.id, s]));

		// Validate all dependsOn references
		for (const step of steps) {
			for (const dep of step.dependsOn ?? []) {
				if (!stepMap.has(dep)) {
					throw new Error(`Step "${step.id}" depends on "${dep}" which is not defined`);
				}
			}
		}

		// Build in-degree map and reverse adjacency (dep → steps that depend on it)
		const inDegree = new Map<string, number>(steps.map(s => [s.id, s.dependsOn?.length ?? 0]));
		const dependents = new Map<string, string[]>(steps.map(s => [s.id, []]));
		for (const step of steps) {
			for (const dep of step.dependsOn ?? []) {
				dependents.get(dep)!.push(step.id);
			}
		}

		const levels: IWorkflowStep[][] = [];
		// Seed queue with all steps that have no dependencies
		let frontier = steps.filter(s => (s.dependsOn?.length ?? 0) === 0);

		while (frontier.length > 0) {
			levels.push(frontier);
			const next: IWorkflowStep[] = [];
			for (const step of frontier) {
				for (const dependentId of dependents.get(step.id) ?? []) {
					const remaining = inDegree.get(dependentId)! - 1;
					inDegree.set(dependentId, remaining);
					if (remaining === 0) {
						next.push(stepMap.get(dependentId)!);
					}
				}
			}
			frontier = next;
		}

		// If any step still has unresolved in-degree, there is a cycle
		const processed = levels.flat().length;
		if (processed !== steps.length) {
			const cycleIds = steps.filter(s => inDegree.get(s.id)! > 0).map(s => s.id);
			throw new Error(`Cycle detected among steps: ${cycleIds.join(', ')}`);
		}

		return levels;
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private _buildStepInput(
		step: IWorkflowStep,
		originalInput: string,
		priorOutputs: IPriorStepOutput[],
		stepIndex: number,
	): string {
		if (stepIndex === 0 || priorOutputs.length === 0) {
			return originalInput;
		}
		// For downstream steps, inject the original goal so context is maintained
		return `Original goal: ${originalInput}\n\nYour task as ${step.role}: complete your assigned role based on the context from prior steps provided in the system prompt.`;
	}

	private _markRemainingSkipped(
		run: IAgentRun,
		orderedSteps: IWorkflowStep[],
		completedIds: Map<string, string>,
	): void {
		for (const step of orderedSteps) {
			if (completedIds.has(step.id)) continue;
			const stepRun = run.steps.find(s => s.stepId === step.id);
			if (stepRun && stepRun.status === 'pending') {
				stepRun.status = 'skipped';
			}
		}
	}
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Build the initial IStepRun stubs for all steps in a workflow */
export function buildInitialStepRuns(workflow: IWorkflowDefinition): IStepRun[] {
	return workflow.steps.map(step => ({
		stepId: step.id,
		agentId: step.agentId,
		role: step.role,
		status: 'pending' as const,
		toolCalls: [],
		outputLog: [],
		iterationsUsed: 0,
	}));
}

/** Build a fresh IAgentRun for a workflow */
export function buildAgentRun(
	workflow: IWorkflowDefinition,
	trigger: IAgentRun['triggerContext'],
): IAgentRun {
	return {
		id: _nanoid(),
		workflowId: workflow.id,
		workflowName: workflow.name,
		status: 'queued' as AgentRunStatus,
		startedAt: Date.now(),
		steps: buildInitialStepRuns(workflow),
		triggerContext: trigger,
	};
}

function _nanoid(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
