/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { ICompactionSummary, IStepSummary } from '../../../common/compactionTypes.js';
import { IPowerMessage, IPowerMessagePart, ITextPart, IToolCallPart, IReasoningPart, IStepStartPart, IStepFinishPart } from '../../../common/powerModeTypes.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

/**
 * LLM interface for summarization callbacks.
 */
export interface ISummarizationLLM {
	summarize(prompt: string, maxOutputTokens: number): Promise<string>;
}

/**
 * Options for summarization.
 */
export interface ISummarizeOptions {
	/** Step range being summarized */
	readonly stepRange: { from: number; to: number };
	/** Previous compaction summaries to build on */
	readonly existingSummaries: ICompactionSummary[];
	/** Token budget for the summary itself (default: 2000) */
	readonly maxSummaryTokens?: number;
	/** Whether to use LLM summarization (default: true) */
	readonly useLLMSummarization?: boolean;
}

interface IExtractedData {
	toolsUsed: Set<string>;
	filesAffected: Set<string>;
	fileChanges: Map<string, string>;
	errors: Array<{ message: string; resolved: boolean }>;
	decisions: string[];
}

/**
 * Production-grade conversation summarizer for Power Mode session compaction.
 *
 * Handles 200+ step sessions by compressing old conversation history into
 * structured summaries while preserving all information the agent needs.
 */
export class ConversationSummarizer {

	/**
	 * Main entry point: summarize a range of messages into a structured summary.
	 */
	async summarizeMessages(
		messages: IPowerMessage[],
		llm: ISummarizationLLM,
		options: ISummarizeOptions
	): Promise<ICompactionSummary> {
		if (!messages.length) {
			return this._createEmptySummary(options);
		}

		const maxSummaryTokens = options.maxSummaryTokens ?? 2000;
		const useLLM = options.useLLMSummarization ?? true;

		// Phase 1: Extract structured data heuristically (no LLM)
		const extracted = this._extractStructuredData(messages);

		// Phase 2: Attempt LLM summarization if enabled
		let userGoal = '';
		let stepSummaries: IStepSummary[] = [];
		let pinnedContext: string[] = [];

		if (useLLM) {
			try {
				const compressedInput = this._buildCompressedInput(messages, 4000);
				const prompt = this._buildSummarizationPrompt(compressedInput, extracted, options);
				const response = await llm.summarize(prompt, maxSummaryTokens);
				const parsed = this._parseResponse(response, options.stepRange);

				userGoal = parsed.goal || this._extractGoalHeuristic(messages);
				stepSummaries = parsed.steps.length ? parsed.steps : this._buildStepSummariesHeuristic(messages, extracted, options.stepRange);
				pinnedContext = parsed.pinned;
			} catch (error) {
				// LLM failed — fall back to heuristic summarization
				console.warn('[ConversationSummarizer] LLM summarization failed, using fallback:', error);
				userGoal = this._extractGoalHeuristic(messages);
				stepSummaries = this._buildStepSummariesHeuristic(messages, extracted, options.stepRange);
				pinnedContext = [];
			}
		} else {
			// Heuristic-only mode
			userGoal = this._extractGoalHeuristic(messages);
			stepSummaries = this._buildStepSummariesHeuristic(messages, extracted, options.stepRange);
			pinnedContext = [];
		}

		// Phase 3: Build final summary object
		const summary: ICompactionSummary = {
			id: generateUuid(),
			createdAt: Date.now(),
			compactedStepRange: options.stepRange,
			userGoal,
			decisions: Array.from(extracted.decisions),
			fileChanges: extracted.fileChanges,
			errors: extracted.errors,
			stepSummaries,
			pinnedContext,
			renderedSummary: '',
			tokenCount: 0,
		};

		// Phase 4: Render the summary text
		summary.renderedSummary = this.renderSummary(summary, options.existingSummaries);
		summary.tokenCount = this._estimateTokens(summary.renderedSummary);

		return summary;
	}

	/**
	 * Render a summary into a text block for injection into conversation history.
	 */
	renderSummary(summary: ICompactionSummary, existingSummaries: ICompactionSummary[] = []): string {
		const lines: string[] = [];

		// Header
		const { from, to } = summary.compactedStepRange;
		const continuingNote = existingSummaries.length > 0 ? ` (continuing from ${existingSummaries.length} previous compaction${existingSummaries.length > 1 ? 's' : ''})` : '';
		lines.push(`[Session Compacted — Steps ${from}-${to}${continuingNote}]`);
		lines.push('');

		// Goal
		if (summary.userGoal) {
			lines.push(`Goal: ${summary.userGoal}`);
			lines.push('');
		}

		// Key decisions
		if (summary.decisions.length > 0) {
			lines.push('Key decisions:');
			for (const decision of summary.decisions) {
				lines.push(`- ${decision}`);
			}
			lines.push('');
		}

		// Files modified
		if (summary.fileChanges.size > 0) {
			lines.push('Files modified:');
			for (const [path, description] of summary.fileChanges) {
				lines.push(`- ${path}: ${description}`);
			}
			lines.push('');
		}

		// Steps
		if (summary.stepSummaries.length > 0) {
			lines.push('Steps:');
			for (const step of summary.stepSummaries) {
				const tools = step.toolsUsed.length > 0 ? ` [${step.toolsUsed.join(', ')}]` : '';
				const sigMarker = step.significance === 'high' ? ' ⚡' : '';
				lines.push(`${step.stepNumber}. ${step.action}${tools}${sigMarker}`);
			}
			lines.push('');
		}

		// Unresolved errors
		const unresolvedErrors = summary.errors.filter(e => !e.resolved);
		if (unresolvedErrors.length > 0) {
			lines.push('Unresolved issues:');
			for (const error of unresolvedErrors) {
				lines.push(`- ${error.message}`);
			}
			lines.push('');
		}

		// Pinned context
		if (summary.pinnedContext.length > 0) {
			lines.push('Context:');
			for (const ctx of summary.pinnedContext) {
				lines.push(`- ${ctx}`);
			}
			lines.push('');
		}

		return lines.join('\n').trim();
	}

	/**
	 * Build a compressed text representation of messages for LLM input.
	 */
	buildCompressedInput(messages: IPowerMessage[], maxTokens: number): string {
		return this._buildCompressedInput(messages, maxTokens);
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	private _createEmptySummary(options: ISummarizeOptions): ICompactionSummary {
		return {
			id: generateUuid(),
			createdAt: Date.now(),
			compactedStepRange: options.stepRange,
			userGoal: '',
			decisions: [],
			fileChanges: new Map(),
			errors: [],
			stepSummaries: [],
			pinnedContext: [],
			renderedSummary: `[Session Compacted — Steps ${options.stepRange.from}-${options.stepRange.to}]\n\n(No messages to summarize)`,
			tokenCount: 50,
		};
	}

	private _extractStructuredData(messages: IPowerMessage[]): IExtractedData {
		const toolsUsed = new Set<string>();
		const filesAffected = new Set<string>();
		const fileChanges = new Map<string, string>();
		const errors: Array<{ message: string; resolved: boolean }> = [];
		const decisions: string[] = [];

		let previousErrorIndices = new Set<number>();

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			for (const part of msg.parts) {
				// Tool calls
				if (part.type === 'tool') {
					const toolPart = part as IToolCallPart;
					toolsUsed.add(toolPart.toolName);

					// Extract file paths from inputs
					const input = toolPart.state.input;
					const filePath = input.file_path || input.path || input.filePath;
					if (filePath && typeof filePath === 'string') {
						filesAffected.add(filePath);
					}

					// Extract file paths from outputs (e.g., grep results)
					const output = toolPart.state.output;
					if (output) {
						const pathMatches = output.match(/^([^\s:]+\.\w+):/gm);
						if (pathMatches) {
							for (const match of pathMatches) {
								const path = match.slice(0, -1);
								filesAffected.add(path);
							}
						}
					}

					// Track file changes
					if (toolPart.toolName === 'Write' || toolPart.toolName === 'Edit') {
						const path = filePath as string;
						if (path) {
							const existingChange = fileChanges.get(path);
							if (!existingChange) {
								fileChanges.set(path, toolPart.toolName === 'Write' ? 'created/overwritten' : 'modified');
							} else if (existingChange !== 'created/overwritten') {
								fileChanges.set(path, 'modified');
							}
						}
					}

					// Track errors
					if (toolPart.state.status === 'error' && toolPart.state.error) {
						errors.push({ message: toolPart.state.error, resolved: false });
						previousErrorIndices.add(errors.length - 1);
					}
				}

				// Text parts (extract decisions)
				if (part.type === 'text' && msg.role === 'assistant') {
					const textPart = part as ITextPart;
					const text = textPart.text;

					// Decision patterns
					const decisionPatterns = [
						/(?:I'll|I will|Let's|I'm going to|I've decided to|I plan to)\s+([^.!?\n]+)/gi,
						/(?:Decision:|Strategy:|Approach:)\s*([^.!?\n]+)/gi,
					];

					for (const pattern of decisionPatterns) {
						const matches = text.matchAll(pattern);
						for (const match of matches) {
							const decision = match[1]?.trim();
							if (decision && decision.length > 10 && decision.length < 200) {
								decisions.push(decision);
							}
						}
					}

					// Check if this text resolves previous errors
					if (previousErrorIndices.size > 0) {
						const hasFixKeywords = /(?:fixed|resolved|corrected|addressed|solved)/i.test(text);
						if (hasFixKeywords) {
							for (const idx of previousErrorIndices) {
								errors[idx].resolved = true;
							}
							previousErrorIndices.clear();
						}
					}
				}
			}

			// Error messages
			if (msg.error) {
				errors.push({ message: msg.error.message, resolved: false });
			}
		}

		// Deduplicate decisions (keep first occurrence)
		const uniqueDecisions = Array.from(new Set(decisions));

		return {
			toolsUsed,
			filesAffected,
			fileChanges,
			errors,
			decisions: uniqueDecisions,
		};
	}

	private _extractGoalHeuristic(messages: IPowerMessage[]): string {
		// Extract from first user message
		const firstUserMsg = messages.find(m => m.role === 'user');
		if (!firstUserMsg) {
			return 'Continue working on the project';
		}

		const textParts = firstUserMsg.parts.filter(p => p.type === 'text') as ITextPart[];
		if (textParts.length === 0) {
			return 'Continue working on the project';
		}

		const text = textParts.map(p => p.text).join(' ');
		const firstSentence = text.split(/[.!?\n]/)[0]?.trim();

		if (!firstSentence || firstSentence.length < 10) {
			return text.slice(0, 100);
		}

		return firstSentence.slice(0, 150);
	}

	private _buildStepSummariesHeuristic(
		messages: IPowerMessage[],
		extracted: IExtractedData,
		stepRange: { from: number; to: number }
	): IStepSummary[] {
		const summaries: IStepSummary[] = [];
		let currentStepNumber = stepRange.from;

		// Group messages by step (step-start to step-finish)
		let currentStepMessages: IPowerMessage[] = [];
		let inStep = false;

		for (const msg of messages) {
			if (msg.role === 'assistant') {
				const hasStepStart = msg.parts.some(p => p.type === 'step-start');
				const hasStepFinish = msg.parts.some(p => p.type === 'step-finish');

				if (hasStepStart) {
					inStep = true;
					currentStepMessages = [msg];
				} else if (hasStepFinish && inStep) {
					currentStepMessages.push(msg);
					const summary = this._summarizeStep(currentStepMessages, currentStepNumber);
					summaries.push(summary);
					currentStepNumber++;
					currentStepMessages = [];
					inStep = false;
				} else if (inStep) {
					currentStepMessages.push(msg);
				}
			}
		}

		// Handle incomplete step at end
		if (currentStepMessages.length > 0) {
			const summary = this._summarizeStep(currentStepMessages, currentStepNumber);
			summaries.push(summary);
		}

		// If no step markers found, create one summary per assistant message with tool calls
		if (summaries.length === 0) {
			for (const msg of messages) {
				if (msg.role === 'assistant') {
					const toolCalls = msg.parts.filter(p => p.type === 'tool') as IToolCallPart[];
					if (toolCalls.length > 0) {
						const summary = this._summarizeStep([msg], currentStepNumber);
						summaries.push(summary);
						currentStepNumber++;
					}
				}
			}
		}

		return summaries;
	}

	private _summarizeStep(messages: IPowerMessage[], stepNumber: number): IStepSummary {
		const toolsUsed = new Set<string>();
		const filesAffected = new Set<string>();
		const actions: string[] = [];

		for (const msg of messages) {
			for (const part of msg.parts) {
				if (part.type === 'tool') {
					const toolPart = part as IToolCallPart;
					toolsUsed.add(toolPart.toolName);

					const input = toolPart.state.input;
					const filePath = input.file_path || input.path || input.filePath;
					if (filePath && typeof filePath === 'string') {
						filesAffected.add(filePath);
					}

					// Build action description
					if (toolPart.toolName === 'Read') {
						actions.push(`read ${filePath}`);
					} else if (toolPart.toolName === 'Edit') {
						actions.push(`edited ${filePath}`);
					} else if (toolPart.toolName === 'Write') {
						actions.push(`wrote ${filePath}`);
					} else if (toolPart.toolName === 'Bash') {
						const cmd = input.command as string;
						const shortCmd = cmd ? cmd.split('\n')[0].slice(0, 40) : 'command';
						actions.push(`ran ${shortCmd}`);
					} else {
						actions.push(`used ${toolPart.toolName}`);
					}
				}
			}
		}

		// Determine significance
		let significance: 'high' | 'medium' | 'low' = 'medium';
		const hasWrite = toolsUsed.has('Write') || toolsUsed.has('Edit');
		const hasError = messages.some(m => m.error || m.parts.some(p => p.type === 'tool' && (p as IToolCallPart).state.status === 'error'));

		if (hasWrite && !hasError) {
			significance = 'high';
		} else if (hasError || toolsUsed.size === 0) {
			significance = 'low';
		}

		// Build action summary
		let action = 'Analyzed files';
		if (actions.length > 0) {
			const uniqueActions = Array.from(new Set(actions));
			if (uniqueActions.length === 1) {
				action = uniqueActions[0];
			} else if (uniqueActions.length <= 3) {
				action = uniqueActions.join(', ');
			} else {
				action = `${uniqueActions.slice(0, 2).join(', ')}, and ${uniqueActions.length - 2} more actions`;
			}
		}

		return {
			stepNumber,
			action,
			toolsUsed: Array.from(toolsUsed),
			filesAffected: Array.from(filesAffected),
			significance,
		};
	}

	private _buildCompressedInput(messages: IPowerMessage[], maxTokens: number): string {
		const lines: string[] = [];
		let estimatedTokens = 0;

		for (const msg of messages) {
			if (msg.role === 'user') {
				// Include full user messages
				const textParts = msg.parts.filter(p => p.type === 'text') as ITextPart[];
				const text = textParts.map(p => p.text).join('\n');
				lines.push(`User: ${text}`);
				estimatedTokens += this._estimateTokens(text);
			} else if (msg.role === 'assistant') {
				// Include text parts and tool call summaries (skip reasoning)
				const textParts = msg.parts.filter(p => p.type === 'text') as ITextPart[];
				const toolParts = msg.parts.filter(p => p.type === 'tool') as IToolCallPart[];

				if (textParts.length > 0) {
					const text = textParts.map(p => p.text).join('\n');
					lines.push(`Assistant: ${text.slice(0, 200)}`);
					estimatedTokens += this._estimateTokens(text.slice(0, 200));
				}

				for (const tool of toolParts) {
					const toolDesc = `Tool: ${tool.toolName} (${JSON.stringify(tool.state.input).slice(0, 100)})`;
					lines.push(toolDesc);
					estimatedTokens += this._estimateTokens(toolDesc);

					// Include first 2 lines of output
					if (tool.state.output) {
						const outputLines = tool.state.output.split('\n').slice(0, 2);
						const outputPreview = outputLines.join('\n');
						lines.push(`Output: ${outputPreview}`);
						estimatedTokens += this._estimateTokens(outputPreview);
					}

					if (tool.state.error) {
						lines.push(`Error: ${tool.state.error}`);
						estimatedTokens += this._estimateTokens(tool.state.error);
					}
				}
			}
		}

		// If still too long, truncate from middle
		if (estimatedTokens > maxTokens) {
			const keep = 0.3; // Keep first 30% and last 30%
			const keepCount = Math.floor(lines.length * keep);
			const truncated = [
				...lines.slice(0, keepCount),
				`\n... [${lines.length - 2 * keepCount} lines truncated] ...\n`,
				...lines.slice(-keepCount),
			];
			return truncated.join('\n');
		}

		return lines.join('\n');
	}

	private _buildSummarizationPrompt(
		compressedInput: string,
		extracted: IExtractedData,
		options: ISummarizeOptions
	): string {
		const { from, to } = options.stepRange;
		const existingCount = options.existingSummaries.length;

		const prompt = `You are summarizing steps ${from}-${to} of an AI coding session${existingCount > 0 ? ` (${existingCount} previous compaction${existingCount > 1 ? 's' : ''} already exist)` : ''}.

Input conversation:
${compressedInput}

Pre-extracted data:
- Tools used: ${Array.from(extracted.toolsUsed).join(', ')}
- Files affected: ${Array.from(extracted.filesAffected).slice(0, 10).join(', ')}${extracted.filesAffected.size > 10 ? ` (and ${extracted.filesAffected.size - 10} more)` : ''}
- File changes: ${extracted.fileChanges.size} files modified
- Errors: ${extracted.errors.length} (${extracted.errors.filter(e => !e.resolved).length} unresolved)
- Decisions: ${extracted.decisions.length} key decisions

Task: Produce a structured summary with the following XML format:

<goal>One-line description of what the user is trying to achieve</goal>

<decisions>
<d>First key decision or strategy chosen</d>
<d>Second key decision</d>
</decisions>

<steps>
<step n="${from}" sig="high">Brief description of what happened in step ${from}</step>
<step n="${from + 1}" sig="medium">Brief description of step ${from + 1}</step>
<!-- Continue for all steps ${from} through ${to} -->
</steps>

<pinned>
<p>Important fact or context that must not be lost (e.g., critical constraints, discovered bugs)</p>
<p>Another important fact</p>
</pinned>

Guidelines:
- Keep each step description to one line (under 100 chars)
- Set sig="high" for steps that modify code, sig="medium" for analysis, sig="low" for errors/retries
- Include 3-5 pinned context items if there are critical facts to preserve
- Be concise but preserve all critical information`;

		return prompt;
	}

	private _parseResponse(response: string, stepRange: { from: number; to: number }): {
		goal: string;
		steps: IStepSummary[];
		pinned: string[];
	} {
		const result = {
			goal: '',
			steps: [] as IStepSummary[],
			pinned: [] as string[],
		};

		try {
			// Parse goal
			const goalMatch = response.match(/<goal>(.*?)<\/goal>/s);
			if (goalMatch) {
				result.goal = goalMatch[1].trim();
			}

			// Parse steps
			const stepMatches = response.matchAll(/<step\s+n="(\d+)"\s+sig="(high|medium|low)">(.*?)<\/step>/gs);
			for (const match of stepMatches) {
				const stepNumber = parseInt(match[1], 10);
				const significance = match[2] as 'high' | 'medium' | 'low';
				const action = match[3].trim();

				if (stepNumber >= stepRange.from && stepNumber <= stepRange.to) {
					result.steps.push({
						stepNumber,
						action,
						toolsUsed: [],
						filesAffected: [],
						significance,
					});
				}
			}

			// Parse pinned context
			const pinnedMatches = response.matchAll(/<p>(.*?)<\/p>/gs);
			for (const match of pinnedMatches) {
				const text = match[1].trim();
				if (text) {
					result.pinned.push(text);
				}
			}
		} catch (error) {
			// XML parsing failed — use raw text as goal
			console.warn('[ConversationSummarizer] XML parsing failed:', error);
			result.goal = response.slice(0, 200);
		}

		return result;
	}

	private _estimateTokens(text: string): number {
		// Rough heuristic: 1 token ≈ 4 characters for English text
		return Math.ceil(text.length / 4);
	}
}
