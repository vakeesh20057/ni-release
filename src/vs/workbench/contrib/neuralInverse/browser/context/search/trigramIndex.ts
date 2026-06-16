/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Trigram Index — fuzzy name/symbol/path matching via trigram decomposition.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';

export interface ITrigramMatch {
	id: string;
	filePath: string;
	symbolName?: string;
	score: number; // 0-1 based on trigram overlap
}

export interface ITrigramIndexService {
	readonly _serviceBrand: undefined;

	addEntry(id: string, filePath: string, name: string, symbolName?: string): void;
	removeEntriesForFile(filePath: string): void;
	search(query: string, maxResults?: number): ITrigramMatch[];
	getEntryCount(): number;
}

export const ITrigramIndexService = createDecorator<ITrigramIndexService>('trigramIndexService');

interface TrigramEntry {
	id: string;
	filePath: string;
	symbolName?: string;
	trigrams: Set<string>;
	normalizedName: string;
}

class TrigramIndexService extends Disposable implements ITrigramIndexService {
	readonly _serviceBrand: undefined;

	private _entries = new Map<string, TrigramEntry>();
	private _trigramToIds = new Map<string, Set<string>>();

	constructor() {
		super();
	}

	addEntry(id: string, filePath: string, name: string, symbolName?: string): void {
		const normalizedName = this._normalize(name);
		const trigrams = this._extractTrigrams(normalizedName);

		const entry: TrigramEntry = { id, filePath, symbolName, trigrams, normalizedName };
		this._entries.set(id, entry);

		for (const tri of trigrams) {
			if (!this._trigramToIds.has(tri)) {
				this._trigramToIds.set(tri, new Set());
			}
			this._trigramToIds.get(tri)!.add(id);
		}
	}

	removeEntriesForFile(filePath: string): void {
		const toRemove: string[] = [];
		for (const [id, entry] of this._entries) {
			if (entry.filePath === filePath) {
				toRemove.push(id);
			}
		}

		for (const id of toRemove) {
			const entry = this._entries.get(id)!;
			for (const tri of entry.trigrams) {
				const ids = this._trigramToIds.get(tri);
				if (ids) {
					ids.delete(id);
					if (ids.size === 0) { this._trigramToIds.delete(tri); }
				}
			}
			this._entries.delete(id);
		}
	}

	search(query: string, maxResults: number = 20): ITrigramMatch[] {
		const normalizedQuery = this._normalize(query);
		const queryTrigrams = this._extractTrigrams(normalizedQuery);

		if (queryTrigrams.size === 0) { return []; }

		// Count matching trigrams per candidate
		const candidateScores = new Map<string, number>();
		for (const tri of queryTrigrams) {
			const ids = this._trigramToIds.get(tri);
			if (ids) {
				for (const id of ids) {
					candidateScores.set(id, (candidateScores.get(id) || 0) + 1);
				}
			}
		}

		// Score = matching trigrams / max(query trigrams, entry trigrams) — Jaccard-ish
		const results: ITrigramMatch[] = [];
		for (const [id, matchCount] of candidateScores) {
			const entry = this._entries.get(id);
			if (!entry) { continue; }

			const denominator = Math.max(queryTrigrams.size, entry.trigrams.size);
			const score = denominator > 0 ? matchCount / denominator : 0;

			// Boost exact substring matches
			const bonus = entry.normalizedName.includes(normalizedQuery) ? 0.3 : 0;

			results.push({
				id,
				filePath: entry.filePath,
				symbolName: entry.symbolName,
				score: Math.min(1, score + bonus),
			});
		}

		return results
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults);
	}

	getEntryCount(): number {
		return this._entries.size;
	}

	private _normalize(text: string): string {
		// Split camelCase/PascalCase, replace non-alphanumeric, lowercase
		return text
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
			.replace(/[^a-zA-Z0-9]/g, ' ')
			.toLowerCase()
			.trim();
	}

	private _extractTrigrams(text: string): Set<string> {
		const trigrams = new Set<string>();
		const padded = `  ${text}  `; // padding for edge trigrams
		for (let i = 0; i < padded.length - 2; i++) {
			trigrams.add(padded.slice(i, i + 3));
		}
		return trigrams;
	}
}

registerSingleton(ITrigramIndexService, TrigramIndexService, InstantiationType.Delayed);
