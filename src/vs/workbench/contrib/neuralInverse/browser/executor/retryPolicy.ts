/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Retry Policy
 *
 * Determines whether a failed step should be retried, computes the delay,
 * and classifies error categories so the orchestrator can make informed
 * retry decisions without hard-coding error string matching everywhere.
 *
 * ## Error Categories
 *
 * - retryable:     rate-limit, transient LLM error, timeout, network failure
 * - non-retryable: model refusal, tool-not-found, max-iterations, invalid config
 */

import { IStepRetryConfig } from '../../common/workflowTypes.js';

// ─── Error Classification ─────────────────────────────────────────────────────

export type RetryErrorCategory =
	| 'rate-limit'
	| 'timeout'
	| 'network'
	| 'llm-transient'
	| 'model-refusal'
	| 'tool-not-found'
	| 'max-iterations'
	| 'config-invalid'
	| 'unknown';

export interface IErrorClassification {
	retryable: boolean;
	category: RetryErrorCategory;
}

/** Patterns that indicate a retryable transient error */
const RETRYABLE_PATTERNS: Array<[RegExp, RetryErrorCategory]> = [
	[/rate.?limit|too many requests|429/i, 'rate-limit'],
	[/timeout|timed out|ETIMEDOUT/i, 'timeout'],
	[/ECONNREFUSED|ECONNRESET|ENETUNREACH|network/i, 'network'],
	[/overloaded|internal server error|503|502|500/i, 'llm-transient'],
	[/aborted/i, 'llm-transient'],
];

/** Patterns that indicate a non-retryable error — retrying is pointless */
const NON_RETRYABLE_PATTERNS: Array<[RegExp, RetryErrorCategory]> = [
	[/not available in this step|tool.*not found/i, 'tool-not-found'],
	[/reached max iterations/i, 'max-iterations'],
	[/no model selected|configure a model/i, 'config-invalid'],
	[/content policy|moderation|refused/i, 'model-refusal'],
	[/Cancelled/i, 'model-refusal'], // user-initiated cancellation is never retried
];

/**
 * Classify a step error string into a category and retryability.
 * User-supplied `nonRetryablePatterns` are checked first and always win.
 */
export function classifyStepError(
	error: string,
	nonRetryablePatterns?: string[],
): IErrorClassification {
	// User-defined non-retryable patterns take highest priority
	if (nonRetryablePatterns) {
		for (const pat of nonRetryablePatterns) {
			try {
				if (new RegExp(pat, 'i').test(error)) {
					return { retryable: false, category: 'unknown' };
				}
			} catch {
				// Ignore invalid regex
			}
		}
	}

	// Check built-in non-retryable patterns
	for (const [pattern, category] of NON_RETRYABLE_PATTERNS) {
		if (pattern.test(error)) {
			return { retryable: false, category };
		}
	}

	// Check built-in retryable patterns
	for (const [pattern, category] of RETRYABLE_PATTERNS) {
		if (pattern.test(error)) {
			return { retryable: true, category };
		}
	}

	// Default: unknown errors are retryable (conservative — better to over-retry than under)
	return { retryable: true, category: 'unknown' };
}

// ─── Delay Computation ────────────────────────────────────────────────────────

const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Compute the delay before the next retry attempt.
 * Uses exponential backoff with ±20% jitter to prevent thundering herd.
 *
 * attempt=1 → baseDelay * multiplier^0 * jitter
 * attempt=2 → baseDelay * multiplier^1 * jitter
 * etc.
 */
export function computeRetryDelay(attempt: number, config: IStepRetryConfig): number {
	const base = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const multiplier = config.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
	const maxDelay = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

	// Exponential: base * multiplier^(attempt-1)
	const exponential = base * Math.pow(multiplier, attempt - 1);

	// ±20% jitter: multiply by [0.8, 1.2]
	const jitter = 0.8 + Math.random() * 0.4;
	const delayed = exponential * jitter;

	return Math.min(delayed, maxDelay);
}

// ─── Retry Decision ───────────────────────────────────────────────────────────

/**
 * Returns true if the step should be retried given the error and current attempt count.
 * `attempt` is 1-indexed: attempt=1 means this is the first failure, before any retries.
 */
export function shouldRetry(
	error: string,
	attempt: number,
	config: IStepRetryConfig,
): boolean {
	if (config.maxRetries <= 0) return false;
	if (attempt > config.maxRetries) return false;

	const { retryable } = classifyStepError(error, config.nonRetryablePatterns);
	return retryable;
}
