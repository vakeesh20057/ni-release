/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types for Power Mode session compaction.
 *
 * Compaction keeps long agentic sessions (200+ steps) within context limits
 * by progressively summarizing old conversation history while preserving
 * the information density needed for the agent to continue working.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ICompactionConfig {
	/** Maximum tokens before triggering compaction (default: 100_000) */
	readonly maxContextTokens: number;

	/** Target tokens after compaction (default: 60_000) — leaves headroom */
	readonly targetTokensAfterCompaction: number;

	/** Number of recent messages to ALWAYS keep verbatim (default: 6) */
	readonly preserveRecentCount: number;

	/** Maximum tokens for a single tool output before truncation (default: 8_000) */
	readonly maxToolOutputTokens: number;

	/** Whether to use LLM for summarization (true) or heuristic-only (false) */
	readonly useLLMSummarization: boolean;

	/** Model feature to use for summarization calls (default: 'Chat') */
	readonly summarizationModel: string;
}

export const DEFAULT_COMPACTION_CONFIG: ICompactionConfig = {
	maxContextTokens: 100_000,
	targetTokensAfterCompaction: 60_000,
	preserveRecentCount: 6,
	maxToolOutputTokens: 8_000,
	useLLMSummarization: true,
	summarizationModel: 'Chat',
};

// ─── Token Estimation ────────────────────────────────────────────────────────

export interface ITokenEstimate {
	readonly tokens: number;
	readonly method: 'chars-heuristic' | 'tokenizer';
}

export interface IMessageTokenProfile {
	readonly messageId: string;
	readonly role: 'user' | 'assistant';
	readonly totalTokens: number;
	readonly textTokens: number;
	readonly toolCallTokens: number;
	readonly toolOutputTokens: number;
}

export interface ISessionTokenProfile {
	readonly totalTokens: number;
	readonly systemPromptTokens: number;
	readonly messageProfiles: IMessageTokenProfile[];
	readonly isOverBudget: boolean;
	readonly overage: number;
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export interface IStepSummary {
	/** The step number (1-based) */
	readonly stepNumber: number;
	/** One-line description of what the agent did */
	readonly action: string;
	/** Tool(s) used */
	readonly toolsUsed: string[];
	/** Files read/modified */
	readonly filesAffected: string[];
	/** Whether this step produced a meaningful result vs intermediate */
	readonly significance: 'high' | 'medium' | 'low';
}

export interface ICompactionSummary {
	readonly id: string;
	readonly createdAt: number;

	/** Steps that were compacted (by step number) */
	readonly compactedStepRange: { from: number; to: number };

	/** The high-level goal the user is pursuing */
	readonly userGoal: string;

	/** Key decisions made so far */
	readonly decisions: string[];

	/** Files that have been modified (path → description of change) */
	readonly fileChanges: Map<string, string>;

	/** Errors encountered and whether they were resolved */
	readonly errors: Array<{ message: string; resolved: boolean }>;

	/** Per-step summaries for the compacted range */
	readonly stepSummaries: IStepSummary[];

	/** Important context that must not be lost (pinned facts) */
	readonly pinnedContext: string[];

	/** The rendered text block injected into conversation history */
	readonly renderedSummary: string;

	/** Tokens used by this summary */
	readonly tokenCount: number;
}

// ─── Compaction State ────────────────────────────────────────────────────────

export type CompactionPhase =
	| 'idle'
	| 'estimating'
	| 'truncating-outputs'
	| 'summarizing'
	| 'rebuilding'
	| 'done';

export interface ICompactionState {
	readonly phase: CompactionPhase;
	readonly totalCompactions: number;
	readonly lastCompactionAt: number | null;
	readonly summaries: ICompactionSummary[];
	/** Messages currently in the "verbatim" window (not compacted) */
	readonly verbatimMessageIds: Set<string>;
}

// ─── Compaction Result ───────────────────────────────────────────────────────

export interface ICompactionResult {
	readonly success: boolean;
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly stepsCompacted: number;
	readonly summary: ICompactionSummary | null;
	readonly error?: string;
}

// ─── Progressive Compaction Levels ───────────────────────────────────────────

/**
 * Compaction is progressive — we try the cheapest operations first:
 *
 * Level 1: Truncate verbose tool outputs (grep results, file contents > 8KB)
 * Level 2: Drop reasoning parts from old messages
 * Level 3: Collapse consecutive read/list tool calls into one-liners
 * Level 4: Full LLM summarization of old step groups
 */
export type CompactionLevel = 1 | 2 | 3 | 4;

export interface ICompactionPlan {
	readonly level: CompactionLevel;
	readonly tokensToFree: number;
	readonly messagesTargeted: string[];
	readonly estimatedSavings: number;
}
