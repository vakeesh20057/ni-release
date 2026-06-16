/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Agent Executor
 *
 * Runs a single workflow step: one agent definition through a full LLM + tool loop.
 *
 * ## Independence from Void Chat
 *
 * The executor calls ILLMMessageService directly. It has no dependency on
 * IChatThreadService, chatMode settings, or the sidebar. It is a pure
 * execution unit driven by the WorkflowOrchestrator.
 *
 * ## Execution Loop
 *
 * 1. Build system prompt (agent instructions + tool schemas + prior context)
 * 2. Send user input to LLM
 * 3. Parse tool calls from response
 * 4. Execute each tool via ScopedToolRegistry
 * 5. Append tool result as next user message
 * 6. Loop until no tool calls or maxIterations reached
 * 7. Write final output to IStepRun
 */

import { ILLMMessageService } from '../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../../../void/common/voidSettingsService.js';
import { ModelSelection } from '../../../void/common/voidSettingsTypes.js';
import { LLMChatMessage } from '../../../void/common/sendLLMMessageTypes.js';
import { IAgentDefinition, IWorkflowStep, IStepRun, IToolCallRecord, IToolExecutionContext, IStepToolCacheConfig } from '../../common/workflowTypes.js';
import { ScopedToolRegistry } from '../tools/toolRegistry.js';
import { parseToolCalls, stripToolCallBlocks } from './toolCallParser.js';
import { IContextPackerService, ContextMode } from '../context/packer/index.js';
import { ToolResultCache } from './toolCache.js';
import { BudgetTracker } from './budgetTracker.js';

const DEFAULT_MAX_ITERATIONS = 20;

export interface IPriorStepOutput {
	stepId: string;
	role: string;
	output: string;
}

export interface ICancellationToken {
	cancelled: boolean;
}

/**
 * Executes a single agent step. Stateless — all state is written into IStepRun.
 */
export class AgentExecutor {

	/** Set at the start of each execute() call from the agent definition */
	private _modelSelection: ModelSelection | undefined;

	constructor(
		private readonly llmService: ILLMMessageService,
		private readonly settingsService: IVoidSettingsService,
		private readonly scopedTools: ScopedToolRegistry,
		private readonly contextPacker?: IContextPackerService,
		private readonly toolCache?: ToolResultCache,
		private readonly cacheConfig?: IStepToolCacheConfig,
		private readonly budgetTracker?: BudgetTracker,
	) {}

	/**
	 * Run the agent loop for one step.
	 * Mutates stepRun in place with live output, tool calls, and final result.
	 */
	async execute(
		agent: IAgentDefinition,
		step: IWorkflowStep,
		stepRun: IStepRun,
		priorOutputs: IPriorStepOutput[],
		ctx: IToolExecutionContext,
		input: string,
		cancellation: ICancellationToken,
	): Promise<void> {
		// Resolve model selection: prefer agent's own model, fall back to global Chat model.
		// agent.model stores providerName as plain string (JSON), so cast to ModelSelection.
		this._modelSelection = agent.model
			? (agent.model as unknown as ModelSelection)
			: (this.settingsService.state.modelSelectionOfFeature['Chat'] ?? undefined);

		stepRun.status = 'running';
		stepRun.startedAt = Date.now();
		stepRun.iterationsUsed = 0;

		const maxIterations = step.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		const history: LLMChatMessage[] = [];

		// ── System prompt (with optional context pre-injection) ─────────────
		const toolSchemas = this.scopedTools.getSchema();
		const contextConfig = step.contextConfig;
		let workspaceContext = '';

		if (this.contextPacker && (!contextConfig || !contextConfig.disableAutoContext)) {
			try {
				const mode = (contextConfig?.mode ?? 'agent') as ContextMode;
				const budget = contextConfig?.budget ?? this.contextPacker.getDefaultBudget(mode);
				workspaceContext = await this.contextPacker.packToString({
					mode,
					query: { type: 'message', text: input },
					budget,
					includeActiveFile: contextConfig?.includeActiveFile ?? true,
					priorityFiles: contextConfig?.priorityFiles,
				});
			} catch {
				// Context packing is best-effort; don't fail the step
			}
		}

		const systemPrompt = this._buildSystemPrompt(agent, toolSchemas, priorOutputs, workspaceContext);
		history.push({ role: 'system', content: systemPrompt });

		// ── Initial user message ───────────────────────────────────────────────
		history.push({ role: 'user', content: input });

		// ── Budget tracker: begin step ────────────────────────────────────────
		if (this.budgetTracker) {
			this.budgetTracker.beginStep(agent.model?.modelName);
		}

		// ── LLM + tool loop ────────────────────────────────────────────────────
		while (stepRun.iterationsUsed < maxIterations) {
			if (cancellation.cancelled) {
				stepRun.status = 'failed';
				stepRun.error = 'Cancelled';
				break;
			}

			stepRun.iterationsUsed++;
			ctx.log(`[${step.id}] iteration ${stepRun.iterationsUsed}/${maxIterations}`);

			// Estimate input tokens for budget tracking.
			// LLMChatMessage is a union (Anthropic/OpenAI/Gemini); extract text safely.
			const inputText = history.map(m => _extractMessageText(m)).join('');

			let responseText: string;
			try {
				responseText = await this._callLLM(history);
			} catch (e: any) {
				stepRun.status = 'failed';
				stepRun.error = `LLM error: ${e.message}`;
				stepRun.endedAt = Date.now();
				return;
			}

			// ── Budget check ──────────────────────────────────────────────────
			if (this.budgetTracker) {
				const budgetResult = this.budgetTracker.recordUsage(inputText, responseText);
				const stepUsage = this.budgetTracker.getStepUsage();
				stepRun.tokenUsage = { inputTokens: stepUsage.inputTokens, outputTokens: stepUsage.outputTokens };

				if (!budgetResult.withinBudget) {
					ctx.log(`[${step.id}] budget exceeded — ${budgetResult.reason}`);
					// onExceeded='warn' logs and continues; 'fail' (default) aborts the step
					if (this.budgetTracker.onExceeded !== 'warn') {
						stepRun.status = 'failed';
						stepRun.error = `Budget exceeded: ${budgetResult.reason}`;
						stepRun.endedAt = Date.now();
						return;
					}
				}
			}

			history.push({ role: 'assistant', content: responseText });
			stepRun.outputLog.push(responseText);

			// ── Parse tool calls ─────────────────────────────────────────────
			const toolCalls = parseToolCalls(responseText);

			if (toolCalls.length === 0) {
				// No tool calls — agent is done
				stepRun.finalOutput = stripToolCallBlocks(responseText) || responseText;
				stepRun.status = 'done';
				stepRun.endedAt = Date.now();
				return;
			}

			// ── Execute tool calls ───────────────────────────────────────────
			const useParallel = step.parallelTools === true && toolCalls.length > 1;
			const toolResultParts: string[] = new Array(toolCalls.length).fill('');

			if (useParallel) {
				// Parallel execution with concurrency cap
				const maxConcurrent = step.maxParallelToolCalls ?? 5;
				await this._executeToolsParallel(toolCalls, toolResultParts, stepRun, step, ctx, cancellation, maxConcurrent);
			} else {
				// Sequential execution (default)
				for (let i = 0; i < toolCalls.length; i++) {
					if (cancellation.cancelled) break;
					toolResultParts[i] = await this._executeSingleTool(toolCalls[i], stepRun, step, ctx);
				}
			}

			// Feed results back as user message for next iteration
			history.push({ role: 'user', content: toolResultParts.join('\n\n') });
		}

		// Max iterations hit
		if (stepRun.status === 'running') {
			stepRun.status = 'failed';
			stepRun.error = `Reached max iterations (${maxIterations}) without completing`;
			stepRun.endedAt = Date.now();
		}
	}

	// ─── Tool Execution ───────────────────────────────────────────────────────

	private async _executeSingleTool(
		call: import('./toolCallParser.js').IParsedToolCall,
		stepRun: IStepRun,
		step: IWorkflowStep,
		ctx: IToolExecutionContext,
	): Promise<string> {
		const tool = this.scopedTools.get(call.tool);
		const callStart = Date.now();

		if (!tool) {
			const record: IToolCallRecord = {
				toolName: call.tool,
				args: call.args,
				result: { success: false, output: '', error: `Tool "${call.tool}" is not available in this step` },
				executedAt: callStart,
				durationMs: 0,
			};
			stepRun.toolCalls.push(record);
			ctx.log(`[${step.id}] tool "${call.tool}" — not available`);
			return `Tool "${call.tool}" error: not available`;
		}

		// ── Cache check ───────────────────────────────────────────────────────
		if (this.toolCache && this.cacheConfig?.enabled) {
			const cacheableTools = this.cacheConfig.cacheableTools;
			const isCacheable = !cacheableTools || cacheableTools.length === 0 || cacheableTools.includes(call.tool);
			if (isCacheable) {
				const cacheKey = this.toolCache.key(call.tool, call.args);
				const cached = this.toolCache.get(cacheKey, this.cacheConfig.ttlMs);
				if (cached) {
					const record: IToolCallRecord = {
						toolName: call.tool,
						args: call.args,
						result: cached,
						executedAt: callStart,
						durationMs: 0,
					};
					stepRun.toolCalls.push(record);
					ctx.log(`[${step.id}] tool "${call.tool}" ✓ (cached)`);
					return `Tool "${call.tool}" result:\n${cached.output}`;
				}
			}
		}

		ctx.log(`[${step.id}] calling tool: ${call.tool}(${JSON.stringify(call.args)})`);
		const result = await tool.execute(call.args, ctx);
		const durationMs = Date.now() - callStart;

		const record: IToolCallRecord = {
			toolName: call.tool,
			args: call.args,
			result,
			executedAt: callStart,
			durationMs,
		};
		stepRun.toolCalls.push(record);

		// Cache successful results
		if (this.toolCache && this.cacheConfig?.enabled && result.success) {
			const cacheKey = this.toolCache.key(call.tool, call.args);
			this.toolCache.set(cacheKey, result);
		}

		if (result.success) {
			ctx.log(`[${step.id}] tool "${call.tool}" ✓ (${durationMs}ms)`);
			return `Tool "${call.tool}" result:\n${result.output}`;
		} else {
			ctx.log(`[${step.id}] tool "${call.tool}" ✗ — ${result.error}`);
			return `Tool "${call.tool}" error: ${result.error}`;
		}
	}

	private async _executeToolsParallel(
		calls: import('./toolCallParser.js').IParsedToolCall[],
		results: string[],
		stepRun: IStepRun,
		step: IWorkflowStep,
		ctx: IToolExecutionContext,
		cancellation: ICancellationToken,
		maxConcurrent: number,
	): Promise<void> {
		// Pool-of-promises: dispatch up to maxConcurrent, race for completion
		const pending = new Set<Promise<void>>();
		let idx = 0;

		const dispatch = (i: number) => {
			const p = this._executeSingleTool(calls[i], stepRun, step, ctx)
				.then(r => { results[i] = r; })
				.catch(e => { results[i] = `Tool "${calls[i].tool}" error: ${e.message}`; })
				.finally(() => pending.delete(p));
			pending.add(p);
		};

		while (idx < calls.length || pending.size > 0) {
			if (cancellation.cancelled) break;

			while (pending.size < maxConcurrent && idx < calls.length) {
				dispatch(idx++);
			}

			if (pending.size > 0) await Promise.race(pending);
		}
	}

	// ─── LLM Call ─────────────────────────────────────────────────────────────

	private _callLLM(messages: LLMChatMessage[], _ctx?: IToolExecutionContext): Promise<string> {
		return new Promise((resolve, reject) => {
			const modelSelection = this._modelSelection ?? this.settingsService.state.modelSelectionOfFeature['Chat'];
			if (!modelSelection) {
				reject(new Error('No model selected. Configure a model in Void settings or set one on the agent.'));
				return;
			}

			this.llmService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				separateSystemMessage: undefined,
				chatMode: 'agent',
				onText: () => {},
				onFinalMessage: (p) => resolve(p.fullText),
				onError: (p) => reject(new Error(p.message || p.fullError?.message || 'LLM error')),
				onAbort: () => reject(new Error('LLM call aborted')),
				logging: { loggingName: 'WorkflowAgent' },
				allowedToolNames: [],
			});
		});
	}

	// ─── System Prompt ────────────────────────────────────────────────────────

	private _buildSystemPrompt(
		agent: IAgentDefinition,
		toolSchemas: object[],
		priorOutputs: IPriorStepOutput[],
		workspaceContext?: string,
	): string {
		const parts: string[] = [];

		// Agent's own instructions
		parts.push(agent.systemInstructions.trim());

		// Pre-packed workspace context (from Context Engine)
		if (workspaceContext && workspaceContext.length > 0) {
			parts.push(`\n## Workspace Context\n\nThe following code context was automatically assembled based on relevance to your task. Use it to inform your work without needing to read these files manually.\n\n${workspaceContext}`);
		}

		// Tool usage instructions + schemas
		if (toolSchemas.length > 0) {
			parts.push(`\n## Tools\n\nYou have access to the following tools. To call a tool, emit a JSON code block:\n\n\`\`\`json\n{ "tool": "tool_name", "args": { "arg1": "value1" } }\`\`\`\n\nFor multiple calls in one turn:\n\n\`\`\`json\n[{ "tool": "...", "args": {...} }, { "tool": "...", "args": {...} }]\n\`\`\`\n\nWhen you have all the information you need and are done working, respond with a plain text summary — no JSON block.\n\n### Available Tools\n\n${JSON.stringify(toolSchemas, null, 2)}`);
		} else {
			parts.push('\n## Instructions\n\nRespond with a plain text answer. No tools are available for this step.');
		}

		// Prior step outputs injected as context
		if (priorOutputs.length > 0) {
			const ctx = priorOutputs
				.map(p => `### Output from step "${p.stepId}" (${p.role})\n\n${p.output}`)
				.join('\n\n');
			parts.push(`\n## Context from Prior Steps\n\n${ctx}`);
		}

		return parts.join('\n');
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract plain text from any LLMChatMessage variant for token estimation.
 * Anthropic/OpenAI messages have a `content` field; Gemini has `parts`.
 */
function _extractMessageText(msg: import('../../../void/common/sendLLMMessageTypes.js').LLMChatMessage): string {
	// Gemini messages use `parts` instead of `content`
	if ('parts' in msg) {
		return msg.parts
			.map(p => ('text' in p ? p.text : ''))
			.join('');
	}
	// Anthropic / OpenAI messages have `content`
	if ('content' in msg) {
		const content = (msg as { content: unknown }).content;
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			return content.map(c => {
				if (typeof c === 'object' && c !== null && 'text' in c) return (c as { text: string }).text;
				return '';
			}).join('');
		}
	}
	return '';
}
