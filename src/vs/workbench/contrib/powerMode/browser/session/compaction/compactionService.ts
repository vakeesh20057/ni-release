/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import {
	ICompactionConfig,
	ICompactionSummary,
	ICompactionResult,
	ICompactionState,
	ISessionTokenProfile,
	CompactionPhase,
	DEFAULT_COMPACTION_CONFIG,
} from '../../../common/compactionTypes.js';
import {
	IPowerMessage,
	ITextPart,
	IToolCallPart,
} from '../../../common/powerModeTypes.js';
import { TokenEstimator } from './tokenEstimator.js';
import { CompactionStrategy } from './compactionStrategy.js';
import { ConversationSummarizer, ISummarizationLLM } from './conversationSummarizer.js';

// ─── Service Interface ───────────────────────────────────────────────────────

export interface ICompactionService {
	readonly state: ICompactionState;
	readonly onDidCompact: Event<ICompactionResult>;
	readonly onDidChangePhase: Event<CompactionPhase>;

	configure(config: Partial<ICompactionConfig>): void;
	getConfig(): ICompactionConfig;

	profileSession(systemPrompt: string, messages: IPowerMessage[]): ISessionTokenProfile;
	shouldCompact(systemPrompt: string, messages: IPowerMessage[]): boolean;

	compact(
		systemPrompt: string,
		messages: IPowerMessage[],
		llm: ISummarizationLLM | null,
	): Promise<ICompactionResult>;

	getCompactedMessages(
		systemPrompt: string,
		originalMessages: IPowerMessage[],
	): IPowerMessage[];

	reset(): void;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class CompactionService extends Disposable implements ICompactionService {

	private _config: ICompactionConfig = { ...DEFAULT_COMPACTION_CONFIG };
	private readonly _estimator = new TokenEstimator();
	private readonly _strategy = new CompactionStrategy();
	private readonly _summarizer = new ConversationSummarizer();

	private _state: ICompactionState = {
		phase: 'idle',
		totalCompactions: 0,
		lastCompactionAt: null,
		summaries: [],
		verbatimMessageIds: new Set(),
	};

	private readonly _compactedSessionCache = new Map<string, IPowerMessage[]>();

	private readonly _onDidCompact = this._register(new Emitter<ICompactionResult>());
	readonly onDidCompact = this._onDidCompact.event;

	private readonly _onDidChangePhase = this._register(new Emitter<CompactionPhase>());
	readonly onDidChangePhase = this._onDidChangePhase.event;

	get state(): ICompactionState {
		return this._state;
	}

	// ─── Configuration ───────────────────────────────────────────────────────

	configure(config: Partial<ICompactionConfig>): void {
		this._config = { ...this._config, ...config };
	}

	getConfig(): ICompactionConfig {
		return { ...this._config };
	}

	// ─── Profiling ───────────────────────────────────────────────────────────

	profileSession(systemPrompt: string, messages: IPowerMessage[]): ISessionTokenProfile {
		return this._estimator.profileSession(messages, systemPrompt, this._config);
	}

	shouldCompact(systemPrompt: string, messages: IPowerMessage[]): boolean {
		const profile = this.profileSession(systemPrompt, messages);
		return this._strategy.shouldCompact(profile, this._config);
	}

	// ─── Compaction ──────────────────────────────────────────────────────────

	async compact(
		systemPrompt: string,
		messages: IPowerMessage[],
		llm: ISummarizationLLM | null,
	): Promise<ICompactionResult> {
		if (messages.length === 0) {
			return { success: false, tokensBefore: 0, tokensAfter: 0, stepsCompacted: 0, summary: null, error: 'No messages to compact' };
		}

		this._setPhase('estimating');

		const profile = this.profileSession(systemPrompt, messages);
		if (!profile.isOverBudget) {
			this._setPhase('idle');
			return { success: true, tokensBefore: profile.totalTokens, tokensAfter: profile.totalTokens, stepsCompacted: 0, summary: null };
		}

		const tokensBefore = profile.totalTokens;
		const preservedIds = this._strategy.getPreservedMessageIds(messages, this._config);

		// ── Level 1: Truncate tool outputs ───────────────────────────────────
		this._setPhase('truncating-outputs');

		const plans = this._strategy.planCompaction(profile, messages, this._config);
		let currentMessages = this._deepCloneMessages(messages);
		let currentTokens = tokensBefore;

		for (const plan of plans) {
			if (currentTokens <= this._config.targetTokensAfterCompaction) {
				break;
			}

			if (plan.level === 1) {
				currentMessages = this._applyLevel1(currentMessages, preservedIds);
				currentTokens = this._estimator.profileSession(currentMessages, systemPrompt, this._config).totalTokens;
			} else if (plan.level === 2) {
				currentMessages = this._applyLevel2(currentMessages, preservedIds);
				currentTokens = this._estimator.profileSession(currentMessages, systemPrompt, this._config).totalTokens;
			} else if (plan.level === 3) {
				currentMessages = this._applyLevel3(currentMessages, preservedIds);
				currentTokens = this._estimator.profileSession(currentMessages, systemPrompt, this._config).totalTokens;
			} else if (plan.level === 4) {
				this._setPhase('summarizing');

				if (!this._config.useLLMSummarization || !llm) {
					currentMessages = await this._applyLevel4Heuristic(currentMessages, preservedIds, systemPrompt);
				} else {
					currentMessages = await this._applyLevel4LLM(currentMessages, preservedIds, systemPrompt, llm);
				}
				currentTokens = this._estimator.profileSession(currentMessages, systemPrompt, this._config).totalTokens;
			}
		}

		// ── Rebuild ──────────────────────────────────────────────────────────
		this._setPhase('rebuilding');

		const tokensAfter = currentTokens;
		const stepsCompacted = messages.length - currentMessages.length;

		const summary = this._state.summaries.length > 0
			? this._state.summaries[this._state.summaries.length - 1]
			: null;

		const sessionId = messages[0]?.sessionId;
		if (sessionId) {
			this._compactedSessionCache.set(sessionId, currentMessages);
		}

		this._state = {
			...this._state,
			phase: 'done',
			totalCompactions: this._state.totalCompactions + 1,
			lastCompactionAt: Date.now(),
			verbatimMessageIds: preservedIds,
		};

		const result: ICompactionResult = {
			success: true,
			tokensBefore,
			tokensAfter,
			stepsCompacted,
			summary,
		};

		this._setPhase('idle');
		this._onDidCompact.fire(result);
		return result;
	}

	getCompactedMessages(systemPrompt: string, originalMessages: IPowerMessage[]): IPowerMessage[] {
		if (originalMessages.length === 0) {
			return [];
		}
		const sessionId = originalMessages[0].sessionId;
		const cached = this._compactedSessionCache.get(sessionId);
		if (cached) {
			return cached;
		}
		return originalMessages;
	}

	reset(): void {
		this._state = {
			phase: 'idle',
			totalCompactions: 0,
			lastCompactionAt: null,
			summaries: [],
			verbatimMessageIds: new Set(),
		};
		this._compactedSessionCache.clear();
		this._setPhase('idle');
	}

	// ─── Level 1: Truncate verbose tool outputs ─────────────────────────────

	private _applyLevel1(messages: IPowerMessage[], preservedIds: Set<string>): IPowerMessage[] {
		const maxTokens = this._config.maxToolOutputTokens;
		// ~4 chars per token for the truncation threshold
		const maxChars = maxTokens * 4;

		for (const msg of messages) {
			if (preservedIds.has(msg.id)) continue;

			for (const part of msg.parts) {
				if (part.type !== 'tool') continue;
				const toolPart = part as IToolCallPart;
				const output = toolPart.state.output;
				if (!output || output.length <= maxChars) continue;

				const headChars = Math.floor(maxChars * 0.65);
				const tailChars = Math.floor(maxChars * 0.25);
				const truncatedCount = output.length - headChars - tailChars;
				const estimatedTokensTruncated = Math.floor(truncatedCount / 4);

				toolPart.state.output =
					output.substring(0, headChars) +
					`\n\n[...${estimatedTokensTruncated} tokens truncated...]\n\n` +
					output.substring(output.length - tailChars);
			}
		}

		return messages;
	}

	// ─── Level 2: Drop reasoning parts ───────────────────────────────────────

	private _applyLevel2(messages: IPowerMessage[], preservedIds: Set<string>): IPowerMessage[] {
		for (const msg of messages) {
			if (preservedIds.has(msg.id)) continue;
			msg.parts = msg.parts.filter(p => p.type !== 'reasoning');
		}
		return messages;
	}

	// ─── Level 3: Collapse redundant tool sequences ──────────────────────────

	private _applyLevel3(messages: IPowerMessage[], preservedIds: Set<string>): IPowerMessage[] {
		for (const msg of messages) {
			if (preservedIds.has(msg.id)) continue;
			if (msg.role !== 'assistant') continue;

			const toolParts = msg.parts.filter((p): p is IToolCallPart => p.type === 'tool');
			if (toolParts.length < 2) continue;

			const collapseGroups = this._identifyCollapsibleSequences(toolParts);

			for (const group of collapseGroups) {
				if (group.parts.length < 2) continue;

				const summaryText = this._buildCollapseText(group);
				const firstPart = group.parts[0];

				firstPart.state = {
					status: 'completed',
					input: firstPart.state.input,
					output: summaryText,
					title: `[Collapsed ${group.parts.length} ${group.type} calls]`,
					time: firstPart.state.time,
				};

				const removeIds = new Set(group.parts.slice(1).map(p => p.id));
				msg.parts = msg.parts.filter(p => !removeIds.has(p.id));
			}
		}
		return messages;
	}

	private _identifyCollapsibleSequences(toolParts: IToolCallPart[]): ICollapseGroup[] {
		const groups: ICollapseGroup[] = [];
		let currentGroup: ICollapseGroup | null = null;

		for (const part of toolParts) {
			const type = this._getCollapseType(part);
			if (!type) {
				if (currentGroup && currentGroup.parts.length >= 2) {
					groups.push(currentGroup);
				}
				currentGroup = null;
				continue;
			}

			if (currentGroup && currentGroup.type === type) {
				currentGroup.parts.push(part);
			} else {
				if (currentGroup && currentGroup.parts.length >= 2) {
					groups.push(currentGroup);
				}
				currentGroup = { type, parts: [part] };
			}
		}

		if (currentGroup && currentGroup.parts.length >= 2) {
			groups.push(currentGroup);
		}

		return groups;
	}

	private _getCollapseType(part: IToolCallPart): string | null {
		const name = part.toolName;
		if (name === 'read' || name === 'list' || name === 'glob') return 'exploration';
		if (name === 'grep' && (!part.state.output || part.state.output.length < 100)) return 'empty-search';
		return null;
	}

	private _buildCollapseText(group: ICollapseGroup): string {
		if (group.type === 'exploration') {
			const paths = group.parts
				.map(p => p.state.input?.file_path || p.state.input?.path || p.state.input?.pattern || 'unknown')
				.filter((v, i, a) => a.indexOf(v) === i);
			const dirs = this._extractCommonDirectories(paths);
			return `Explored ${group.parts.length} files/directories in: ${dirs.join(', ')}`;
		}

		if (group.type === 'empty-search') {
			const patterns = group.parts
				.map(p => p.state.input?.pattern || p.state.input?.regex || 'unknown')
				.filter((v, i, a) => a.indexOf(v) === i);
			return `Searched for ${patterns.length} patterns — no significant results: ${patterns.slice(0, 3).join(', ')}${patterns.length > 3 ? '...' : ''}`;
		}

		return `[${group.parts.length} ${group.type} calls collapsed]`;
	}

	private _extractCommonDirectories(paths: string[]): string[] {
		const dirs = paths.map(p => {
			const parts = p.split('/');
			return parts.length > 1 ? parts.slice(0, -1).join('/') : p;
		});
		const unique = [...new Set(dirs)];
		if (unique.length <= 3) return unique;

		const commonPrefix = this._longestCommonPrefix(unique);
		if (commonPrefix.length > 5) {
			return [`${commonPrefix}* (${unique.length} paths)`];
		}
		return unique.slice(0, 3).concat([`+${unique.length - 3} more`]);
	}

	private _longestCommonPrefix(strs: string[]): string {
		if (strs.length === 0) return '';
		let prefix = strs[0];
		for (let i = 1; i < strs.length; i++) {
			while (!strs[i].startsWith(prefix)) {
				prefix = prefix.substring(0, prefix.length - 1);
				if (prefix.length === 0) return '';
			}
		}
		return prefix;
	}

	// ─── Level 4: LLM Summarization ─────────────────────────────────────────

	private async _applyLevel4LLM(
		messages: IPowerMessage[],
		preservedIds: Set<string>,
		systemPrompt: string,
		llm: ISummarizationLLM,
	): Promise<IPowerMessage[]> {
		const messagesToSummarize = messages.filter(m => !preservedIds.has(m.id));
		if (messagesToSummarize.length === 0) return messages;

		const stepGroups = this._strategy.identifyStepGroups(messages);
		const groupsToSummarize = stepGroups.filter(g =>
			g.messageIds.some(id => !preservedIds.has(id))
		);

		if (groupsToSummarize.length === 0) return messages;

		const fromStep = groupsToSummarize[0].stepNumber;
		const toStep = groupsToSummarize[groupsToSummarize.length - 1].stepNumber;

		let summary: ICompactionSummary;
		try {
			summary = await this._summarizer.summarizeMessages(
				messagesToSummarize,
				llm,
				{
					stepRange: { from: fromStep, to: toStep },
					existingSummaries: this._state.summaries,
					maxSummaryTokens: 2000,
				},
			);
		} catch {
			return this._applyLevel4Heuristic(messages, preservedIds, systemPrompt);
		}

		this._state = {
			...this._state,
			summaries: [...this._state.summaries, summary],
		};

		return this._rebuildWithSummary(messages, preservedIds, summary);
	}

	private async _applyLevel4Heuristic(
		messages: IPowerMessage[],
		preservedIds: Set<string>,
		_systemPrompt: string,
	): Promise<IPowerMessage[]> {
		const messagesToSummarize = messages.filter(m => !preservedIds.has(m.id));
		if (messagesToSummarize.length === 0) return messages;

		const stepGroups = this._strategy.identifyStepGroups(messages);
		const groupsToSummarize = stepGroups.filter(g =>
			g.messageIds.some(id => !preservedIds.has(id))
		);

		const fromStep = groupsToSummarize.length > 0 ? groupsToSummarize[0].stepNumber : 1;
		const toStep = groupsToSummarize.length > 0 ? groupsToSummarize[groupsToSummarize.length - 1].stepNumber : messagesToSummarize.length;

		// Pass null for LLM — summarizeMessages falls back to heuristic-only internally
		const summary = await this._summarizer.summarizeMessages(messagesToSummarize, null as any, {
			stepRange: { from: fromStep, to: toStep },
			existingSummaries: this._state.summaries,
			maxSummaryTokens: 2000,
			useLLMSummarization: false,
		});

		this._state = {
			...this._state,
			summaries: [...this._state.summaries, summary],
		};

		return this._rebuildWithSummary(messages, preservedIds, summary);
	}

	private _rebuildWithSummary(
		messages: IPowerMessage[],
		preservedIds: Set<string>,
		summary: ICompactionSummary,
	): IPowerMessage[] {
		const result: IPowerMessage[] = [];

		const summaryMessage: IPowerMessage = {
			id: `compaction_summary_${summary.id}`,
			sessionId: messages[0]?.sessionId ?? '',
			role: 'assistant',
			createdAt: summary.createdAt,
			parts: [{
				type: 'text',
				id: `compaction_text_${summary.id}`,
				text: summary.renderedSummary,
			} as ITextPart],
		};

		let insertedSummary = false;

		for (const msg of messages) {
			if (preservedIds.has(msg.id)) {
				if (!insertedSummary && msg.createdAt > summary.createdAt) {
					result.push(summaryMessage);
					insertedSummary = true;
				}
				result.push(msg);
			}
		}

		if (!insertedSummary) {
			// Summary goes right after the first preserved message
			if (result.length > 0) {
				result.splice(1, 0, summaryMessage);
			} else {
				result.push(summaryMessage);
			}
		}

		return result;
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private _setPhase(phase: CompactionPhase): void {
		this._state = { ...this._state, phase };
		this._onDidChangePhase.fire(phase);
	}

	private _deepCloneMessages(messages: IPowerMessage[]): IPowerMessage[] {
		return messages.map(msg => ({
			...msg,
			parts: msg.parts.map(part => {
				if (part.type === 'tool') {
					const toolPart = part as IToolCallPart;
					return {
						...toolPart,
						state: { ...toolPart.state },
					};
				}
				return { ...part };
			}),
		}));
	}
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface ICollapseGroup {
	type: string;
	parts: IToolCallPart[];
}
