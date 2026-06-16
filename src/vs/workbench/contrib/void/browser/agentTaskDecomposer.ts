/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Agent Task Decomposer — LLM-based subtask generation for autonomous execution.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import {
	AgentSubtask,
	TaskComplexity,
	AGENT_ITERATION_BUDGET,
} from '../common/neuralInverseAgentTypes.js';

export interface IDecompositionResult {
	complexity: TaskComplexity;
	subtasks: AgentSubtask[];
	reasoning: string;
}

export interface IAgentTaskDecomposer {
	readonly _serviceBrand: undefined;

	decompose(goal: string, contextSummary: string): Promise<IDecompositionResult>;
	estimateComplexity(goal: string): TaskComplexity;
}

export const IAgentTaskDecomposer = createDecorator<IAgentTaskDecomposer>('agentTaskDecomposer');

const DECOMPOSE_PROMPT = `You are a task decomposition engine. Given a user's goal and context, break it into ordered subtasks.

Respond with ONLY valid JSON in this format:
{
  "complexity": "simple" | "medium" | "complex",
  "reasoning": "one sentence explaining your complexity assessment",
  "subtasks": [
    {
      "goal": "specific actionable goal",
      "complexity": "simple" | "medium" | "complex",
      "dependencies": []  // indices of subtasks this depends on (0-based)
    }
  ]
}

Rules:
- "simple" = single file change or read operation (1-3 steps)
- "medium" = multi-file changes with testing (4-8 steps)
- "complex" = architectural changes, new features spanning many files (9+ steps)
- Each subtask should be independently completable
- Dependencies reference array indices of prerequisite subtasks
- Maximum 10 subtasks (merge if more needed)
- If the task is truly simple (rename, typo fix), return a single subtask`;

class AgentTaskDecomposer extends Disposable implements IAgentTaskDecomposer {
	readonly _serviceBrand: undefined;

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
	}

	async decompose(goal: string, contextSummary: string): Promise<IDecompositionResult> {
		const userMessage = `Goal: ${goal}\n\nContext:\n${contextSummary || '(no additional context)'}`;

		try {
			const response = await this._callLLM(DECOMPOSE_PROMPT, userMessage);
			const parsed = JSON.parse(response);

			const complexity: TaskComplexity = this._validateComplexity(parsed.complexity);
			const subtasks: AgentSubtask[] = (parsed.subtasks || []).map((st: any, idx: number) => ({
				id: generateUuid(),
				goal: st.goal || `Subtask ${idx + 1}`,
				status: 'pending' as const,
				complexity: this._validateComplexity(st.complexity),
				dependencies: (st.dependencies || []).map((d: number) => String(d)),
				iterationBudget: AGENT_ITERATION_BUDGET[this._validateComplexity(st.complexity)],
				iterationsUsed: 0,
			}));

			// Resolve dependency indices to actual IDs
			for (const st of subtasks) {
				st.dependencies = st.dependencies.map((depIdx: string) => {
					const idx = parseInt(depIdx, 10);
					return (idx >= 0 && idx < subtasks.length) ? subtasks[idx].id : '';
				}).filter(Boolean);
			}

			return {
				complexity,
				subtasks: subtasks.length > 0 ? subtasks : [this._singleSubtask(goal, complexity)],
				reasoning: parsed.reasoning || '',
			};
		} catch {
			// Fallback: single task with heuristic complexity
			const complexity = this.estimateComplexity(goal);
			return {
				complexity,
				subtasks: [this._singleSubtask(goal, complexity)],
				reasoning: 'LLM decomposition failed, using heuristic estimate',
			};
		}
	}

	estimateComplexity(goal: string): TaskComplexity {
		const lower = goal.toLowerCase();
		const complexSignals = ['refactor', 'implement', 'build', 'create a', 'add feature', 'migrate', 'redesign', 'architecture'];
		const simpleSignals = ['fix typo', 'rename', 'update comment', 'change value', 'remove unused'];

		if (simpleSignals.some(s => lower.includes(s))) { return 'simple'; }
		if (complexSignals.some(s => lower.includes(s))) { return 'complex'; }
		return 'medium';
	}

	private _validateComplexity(value: unknown): TaskComplexity {
		if (value === 'simple' || value === 'medium' || value === 'complex') { return value; }
		return 'medium';
	}

	private _singleSubtask(goal: string, complexity: TaskComplexity): AgentSubtask {
		return {
			id: generateUuid(),
			goal,
			status: 'pending',
			complexity,
			dependencies: [],
			iterationBudget: AGENT_ITERATION_BUDGET[complexity],
			iterationsUsed: 0,
		};
	}

	private _callLLM(systemPrompt: string, userMessage: string): Promise<string> {
		return new Promise((resolve, reject) => {
			let result = '';
			const modelSelection = this._settingsService.state.modelSelectionOfFeature['Chat'];
			if (!modelSelection) {
				reject(new Error('No model configured'));
				return;
			}

			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{ role: 'user', content: userMessage }] as any,
				separateSystemMessage: systemPrompt,
				chatMode: 'ask',
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				logging: { loggingName: 'agentTaskDecomposer' },
				onText: ({ fullText }) => { result = fullText; },
				onFinalMessage: () => { resolve(result); },
				onError: (err) => { reject(err); },
				onAbort: () => { reject(new Error('Aborted')); },
			});
		});
	}
}

registerSingleton(IAgentTaskDecomposer, AgentTaskDecomposer, InstantiationType.Delayed);
