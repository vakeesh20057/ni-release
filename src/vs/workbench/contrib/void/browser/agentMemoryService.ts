/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Agent Memory Service — persistent cross-session memory for the NI agent.
 *
 *  Stores observations, learned patterns, and project-specific context that
 *  persists across IDE restarts. Scoped per workspace.
 *---------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryEntryType = 'pattern' | 'preference' | 'project-fact' | 'error-fix' | 'tool-usage' | 'file-context';

export interface IAgentMemoryEntry {
	id: string;
	type: MemoryEntryType;
	content: string;
	/** Relevance score — decays over time, boosted on access */
	relevance: number;
	createdAt: number;
	lastAccessedAt: number;
	accessCount: number;
	tags: string[];
}

export interface IAgentMemoryService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeMemory: Event<void>;

	/** Store a new memory */
	remember(type: MemoryEntryType, content: string, tags?: string[]): IAgentMemoryEntry;

	/** Recall memories relevant to a query (by tag match + recency + access frequency) */
	recall(query: string, maxResults?: number): IAgentMemoryEntry[];

	/** Boost relevance of a memory (when it proved useful) */
	reinforce(id: string): void;

	/** Remove a specific memory */
	forget(id: string): void;

	/** Get all memories of a given type */
	getByType(type: MemoryEntryType): IAgentMemoryEntry[];

	/** Get compressed context string for injection into agent prompt */
	getContextSummary(maxTokens?: number): string;

	/** Total stored memories */
	readonly count: number;
}

export const IAgentMemoryService = createDecorator<IAgentMemoryService>('agentMemoryService');

// ─── Implementation ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'ni.agent.memory';
const MAX_MEMORIES = 200;
const DECAY_RATE = 0.995; // per-day relevance decay

class AgentMemoryService extends Disposable implements IAgentMemoryService {
	readonly _serviceBrand: undefined;

	private _entries: Map<string, IAgentMemoryEntry> = new Map();
	private _dirty = false;

	private readonly _onDidChangeMemory = this._register(new Emitter<void>());
	readonly onDidChangeMemory: Event<void> = this._onDidChangeMemory.event;

	get count(): number { return this._entries.size; }

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._load();
		this._register(this._storageService.onWillSaveState(() => this._persist()));
	}

	remember(type: MemoryEntryType, content: string, tags?: string[]): IAgentMemoryEntry {
		// Deduplicate by content hash
		for (const entry of this._entries.values()) {
			if (entry.content === content) {
				entry.lastAccessedAt = Date.now();
				entry.accessCount++;
				entry.relevance = Math.min(1, entry.relevance + 0.1);
				this._emitChange();
				return entry;
			}
		}

		const entry: IAgentMemoryEntry = {
			id: this._generateId(),
			type,
			content,
			relevance: 1.0,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
			accessCount: 0,
			tags: tags || [],
		};

		this._entries.set(entry.id, entry);
		this._evictIfNeeded();
		this._emitChange();
		return entry;
	}

	recall(query: string, maxResults: number = 10): IAgentMemoryEntry[] {
		const queryTerms = this._tokenize(query);
		const scored: { entry: IAgentMemoryEntry; score: number }[] = [];

		const now = Date.now();
		for (const entry of this._entries.values()) {
			let score = 0;

			// Tag/content match
			const entryTerms = new Set([...this._tokenize(entry.content), ...entry.tags]);
			let matches = 0;
			for (const t of queryTerms) {
				if (entryTerms.has(t)) matches++;
			}
			if (queryTerms.length > 0) score += (matches / queryTerms.length) * 0.5;

			// Recency bonus (last 24h = full, decays over days)
			const daysSinceAccess = (now - entry.lastAccessedAt) / 86_400_000;
			score += Math.pow(DECAY_RATE, daysSinceAccess) * 0.25;

			// Access frequency bonus
			score += Math.min(entry.accessCount / 10, 1) * 0.15;

			// Base relevance
			score += entry.relevance * 0.1;

			if (score > 0.05) scored.push({ entry, score });
		}

		scored.sort((a, b) => b.score - a.score);
		const results = scored.slice(0, maxResults).map(s => s.entry);

		// Boost accessed entries
		for (const entry of results) {
			entry.lastAccessedAt = now;
			entry.accessCount++;
		}
		if (results.length > 0) this._dirty = true;

		return results;
	}

	reinforce(id: string): void {
		const entry = this._entries.get(id);
		if (!entry) return;
		entry.relevance = Math.min(1, entry.relevance + 0.15);
		entry.lastAccessedAt = Date.now();
		entry.accessCount++;
		this._emitChange();
	}

	forget(id: string): void {
		if (this._entries.delete(id)) {
			this._emitChange();
		}
	}

	getByType(type: MemoryEntryType): IAgentMemoryEntry[] {
		const results: IAgentMemoryEntry[] = [];
		for (const entry of this._entries.values()) {
			if (entry.type === type) results.push(entry);
		}
		return results.sort((a, b) => b.relevance - a.relevance);
	}

	getContextSummary(maxTokens: number = 2000): string {
		// Get top memories by relevance, format as compact context
		const all = Array.from(this._entries.values())
			.sort((a, b) => b.relevance - a.relevance);

		const lines: string[] = [];
		let tokens = 0;
		for (const entry of all) {
			const line = `[${entry.type}] ${entry.content}`;
			const lineTokens = Math.ceil(line.length / 4);
			if (tokens + lineTokens > maxTokens) break;
			lines.push(line);
			tokens += lineTokens;
		}

		return lines.length > 0 ? `Agent Memory (${lines.length} entries):\n${lines.join('\n')}` : '';
	}

	// ─── Private ─────────────────────────────────────────────────────────────

	private _load(): void {
		try {
			const raw = this._storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
			if (raw) {
				const parsed: IAgentMemoryEntry[] = JSON.parse(raw);
				for (const entry of parsed) {
					this._entries.set(entry.id, entry);
				}
			}
		} catch { /* corrupted — start fresh */ }
	}

	private _persist(): void {
		if (!this._dirty && this._entries.size === 0) return;
		const arr = Array.from(this._entries.values());
		this._storageService.store(STORAGE_KEY, JSON.stringify(arr), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._dirty = false;
	}

	private _evictIfNeeded(): void {
		if (this._entries.size <= MAX_MEMORIES) return;
		// Remove lowest-relevance entries
		const sorted = Array.from(this._entries.values())
			.sort((a, b) => a.relevance - b.relevance);
		const toRemove = sorted.slice(0, this._entries.size - MAX_MEMORIES);
		for (const entry of toRemove) {
			this._entries.delete(entry.id);
		}
	}

	private _emitChange(): void {
		this._dirty = true;
		this._onDidChangeMemory.fire();
	}

	private _tokenize(text: string): string[] {
		return text.toLowerCase().split(/[\s\-_./\\]+/).filter(t => t.length > 2);
	}

	private _generateId(): string {
		return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	}
}

registerSingleton(IAgentMemoryService, AgentMemoryService, InstantiationType.Delayed);
