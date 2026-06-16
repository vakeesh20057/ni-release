/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Agent Scratchpad Service — persistent reasoning trace for the autonomous agent.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import {
	ScratchpadEntry,
	ScratchpadEntryType,
	AgentScratchpad,
	SCRATCHPAD_MAX_TOKENS,
} from '../common/neuralInverseAgentTypes.js';

const CHARS_PER_TOKEN = 4;

export interface IAgentScratchpadService {
	readonly _serviceBrand: undefined;

	readonly scratchpad: AgentScratchpad;

	append(type: ScratchpadEntryType, content: string, importance?: number): void;
	clear(): void;
	getCompressedSummary(): string;
	getRecentEntries(maxEntries?: number): ScratchpadEntry[];
	getEntriesByType(type: ScratchpadEntryType): ScratchpadEntry[];
}

export const IAgentScratchpadService = createDecorator<IAgentScratchpadService>('agentScratchpadService');

class AgentScratchpadService extends Disposable implements IAgentScratchpadService {
	readonly _serviceBrand: undefined;

	private _scratchpad: AgentScratchpad = {
		entries: [],
		estimatedTokens: 0,
		maxTokenBudget: SCRATCHPAD_MAX_TOKENS,
	};

	get scratchpad(): AgentScratchpad {
		return this._scratchpad;
	}

	append(type: ScratchpadEntryType, content: string, importance: number = 3): void {
		const entry: ScratchpadEntry = {
			type,
			content,
			timestamp: new Date().toISOString(),
			importance: Math.max(1, Math.min(5, importance)),
		};

		this._scratchpad.entries.push(entry);
		this._scratchpad.estimatedTokens += Math.ceil(content.length / CHARS_PER_TOKEN);

		this._pruneIfNeeded();
	}

	clear(): void {
		this._scratchpad.entries = [];
		this._scratchpad.estimatedTokens = 0;
	}

	getCompressedSummary(): string {
		if (this._scratchpad.entries.length === 0) { return ''; }

		const lines: string[] = ['<scratchpad>'];
		for (const entry of this._scratchpad.entries) {
			const prefix = entry.type === 'error' ? '⚠' :
				entry.type === 'decision' ? '→' :
				entry.type === 'replan' ? '↺' :
				entry.type === 'hypothesis' ? '?' : '•';
			lines.push(`${prefix} [${entry.type}] ${entry.content}`);
		}
		lines.push('</scratchpad>');
		return lines.join('\n');
	}

	getRecentEntries(maxEntries: number = 20): ScratchpadEntry[] {
		return this._scratchpad.entries.slice(-maxEntries);
	}

	getEntriesByType(type: ScratchpadEntryType): ScratchpadEntry[] {
		return this._scratchpad.entries.filter(e => e.type === type);
	}

	private _pruneIfNeeded(): void {
		while (this._scratchpad.estimatedTokens > this._scratchpad.maxTokenBudget && this._scratchpad.entries.length > 1) {
			let lowestIdx = 0;
			let lowestImportance = Infinity;

			for (let i = 0; i < this._scratchpad.entries.length - 1; i++) {
				if (this._scratchpad.entries[i].importance < lowestImportance) {
					lowestImportance = this._scratchpad.entries[i].importance;
					lowestIdx = i;
				}
			}

			const removed = this._scratchpad.entries.splice(lowestIdx, 1)[0];
			this._scratchpad.estimatedTokens -= Math.ceil(removed.content.length / CHARS_PER_TOKEN);
		}
	}
}

registerSingleton(IAgentScratchpadService, AgentScratchpadService, InstantiationType.Delayed);
