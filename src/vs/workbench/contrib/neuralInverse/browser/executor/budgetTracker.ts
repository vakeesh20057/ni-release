/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Budget Tracker
 *
 * Tracks token consumption and estimated cost for a workflow run.
 * One instance per run, shared across all steps.
 *
 * ## Token Counting
 *
 * Uses chars/4 as a fast approximation when provider metadata is unavailable.
 * If the LLM response provides usage metadata, that takes precedence.
 *
 * ## Cost Estimation
 *
 * Uses MODEL_PRICING lookup by modelName. Falls back to 0 if model unknown.
 * Costs are estimates — actual billing depends on provider rounding.
 */

import { IWorkflowBudgetConfig } from '../../common/workflowTypes.js';

// ─── Model Pricing (per 1k tokens, USD) ──────────────────────────────────────

interface IModelPrice {
	inputPer1k: number;
	outputPer1k: number;
}

/** Approximate prices for common models. Update as providers change pricing. */
const MODEL_PRICING: Record<string, IModelPrice> = {
	// Claude
	'claude-opus-4-8': { inputPer1k: 0.015, outputPer1k: 0.075 },
	'claude-sonnet-4-6': { inputPer1k: 0.003, outputPer1k: 0.015 },
	'claude-haiku-4-5': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
	// GPT
	'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
	'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
	'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
	// Gemini
	'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
	'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
};

// ─── Budget Check Result ──────────────────────────────────────────────────────

export interface IBudgetCheckResult {
	withinBudget: boolean;
	/** Human-readable reason if budget exceeded */
	reason?: string;
}

export interface IBudgetUsage {
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number;
}

// ─── Budget Tracker ───────────────────────────────────────────────────────────

export class BudgetTracker {

	private _totalInput = 0;
	private _totalOutput = 0;
	private _stepInput = 0;
	private _stepOutput = 0;
	private _modelName: string | undefined;

	/** Exposed so AgentExecutor can read the onExceeded policy without passing it separately. */
	readonly onExceeded: 'fail' | 'warn';

	constructor(private readonly config: IWorkflowBudgetConfig) {
		this.onExceeded = config.onExceeded ?? 'fail';
	}

	/** Call at the start of each step to reset per-step counters. */
	beginStep(modelName?: string): void {
		this._stepInput = 0;
		this._stepOutput = 0;
		if (modelName) this._modelName = modelName;
	}

	/**
	 * Record token usage from one LLM call.
	 * Provide exact counts from provider metadata when available;
	 * pass strings to use the chars/4 approximation.
	 */
	recordUsage(
		inputTokensOrText: number | string,
		outputTokensOrText: number | string,
	): IBudgetCheckResult {
		const inputTokens = typeof inputTokensOrText === 'number'
			? inputTokensOrText
			: this.estimateTokens(inputTokensOrText);
		const outputTokens = typeof outputTokensOrText === 'number'
			? outputTokensOrText
			: this.estimateTokens(outputTokensOrText);

		this._totalInput += inputTokens;
		this._totalOutput += outputTokens;
		this._stepInput += inputTokens;
		this._stepOutput += outputTokens;

		return this._check();
	}

	private _check(): IBudgetCheckResult {
		const { maxTokensPerRun, maxTokensPerStep, maxCostUsd } = this.config;

		const totalTokens = this._totalInput + this._totalOutput;
		const stepTokens = this._stepInput + this._stepOutput;
		const cost = this._computeCost(this._totalInput, this._totalOutput);

		if (maxTokensPerRun !== undefined && totalTokens > maxTokensPerRun) {
			return { withinBudget: false, reason: `Run token budget exceeded: ${totalTokens} > ${maxTokensPerRun}` };
		}
		if (maxTokensPerStep !== undefined && stepTokens > maxTokensPerStep) {
			return { withinBudget: false, reason: `Step token budget exceeded: ${stepTokens} > ${maxTokensPerStep}` };
		}
		if (maxCostUsd !== undefined && maxCostUsd > 0 && cost > maxCostUsd) {
			return { withinBudget: false, reason: `Cost budget exceeded: $${cost.toFixed(4)} > $${maxCostUsd}` };
		}

		return { withinBudget: true };
	}

	/** Estimate token count from a string using chars/4 heuristic. */
	estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	getUsage(): IBudgetUsage {
		return {
			inputTokens: this._totalInput,
			outputTokens: this._totalOutput,
			estimatedCostUsd: this._computeCost(this._totalInput, this._totalOutput),
		};
	}

	getStepUsage(): { inputTokens: number; outputTokens: number } {
		return { inputTokens: this._stepInput, outputTokens: this._stepOutput };
	}

	private _computeCost(input: number, output: number): number {
		const pricing = this._modelName ? MODEL_PRICING[this._modelName] : undefined;
		if (!pricing) return 0;
		return (input / 1000) * pricing.inputPer1k + (output / 1000) * pricing.outputPer1k;
	}
}
