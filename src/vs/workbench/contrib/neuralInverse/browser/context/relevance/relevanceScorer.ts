/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IWorkspaceSymbolIndexService, IIndexedSymbol } from '../index/workspaceSymbolIndex.js';
import { IChangeTrackerService } from '../tracker/changeTracker.js';

export const IRelevanceScorerService = createDecorator<IRelevanceScorerService>('neuralInverseRelevanceScorer');

export type RelevanceReason =
	| 'import-direct'
	| 'import-transitive'
	| 'co-edit-recent'
	| 'name-match'
	| 'type-dependency'
	| 'same-directory'
	| 'open-tab'
	| 'symbol-reference'
	| 'high-edit-velocity';

export interface IRelevanceQuery {
	type: 'cursor' | 'message' | 'file';
	uri?: string;
	position?: { line: number; col: number };
	text?: string;
	activeFileUri?: string;
	symbols?: string[];
}

export interface IScoredItem {
	uri: string;
	score: number;
	reasons: RelevanceReason[];
	symbols?: string[];
	matchedTokens?: string[];
}

export interface IRelevanceScorerService {
	readonly _serviceBrand: undefined;
	scoreFiles(query: IRelevanceQuery, maxResults?: number): IScoredItem[];
	getRelevantSymbols(query: IRelevanceQuery, maxSymbols?: number): Array<{ symbol: IIndexedSymbol; score: number }>;
	scoreFile(uri: string, query: IRelevanceQuery): IScoredItem | undefined;
}

// Signal weights — total must sum to 1.0
const W_IMPORT = 0.28;
const W_RECENCY = 0.22;
const W_NAME_MATCH = 0.20;
const W_COEDIT = 0.12;
const W_OPEN_TAB = 0.08;
const W_DIRECTORY = 0.06;
const W_TYPE_DEP = 0.04;

// Thresholds
const MIN_SCORE_THRESHOLD = 0.02;
const MAX_CANDIDATES = 300;
const NAME_MATCH_MIN_TOKEN_LENGTH = 2;
const IMPORT_DEPTH_2_SCORE = 0.5;
const IMPORT_DEPTH_3_SCORE = 0.2;

// Tokenizer cache for repeated queries
const _tokenCache = new Map<string, string[]>();
const MAX_TOKEN_CACHE_SIZE = 100;

class RelevanceScorerService extends Disposable implements IRelevanceScorerService {
	declare readonly _serviceBrand: undefined;

	private readonly _openFileUris = new Set<string>();

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceSymbolIndexService private readonly _symbolIndex: IWorkspaceSymbolIndexService,
		@IChangeTrackerService private readonly _changeTracker: IChangeTrackerService,
	) {
		super();

		// Track open tabs
		this._register(this._editorService.onDidActiveEditorChange(() => this._refreshOpenTabs()));
		this._register(this._editorService.onDidCloseEditor(() => this._refreshOpenTabs()));
		this._refreshOpenTabs();
	}

	private _refreshOpenTabs(): void {
		this._openFileUris.clear();
		for (const editor of this._editorService.editors) {
			const resource = editor.resource;
			if (resource) this._openFileUris.add(resource.toString());
		}
	}

	scoreFiles(query: IRelevanceQuery, maxResults = 20): IScoredItem[] {
		const activeUri = query.activeFileUri ?? query.uri;
		if (!activeUri) return [];

		const candidates = this._gatherCandidates(activeUri, query);
		const results: IScoredItem[] = [];

		for (const uri of candidates) {
			if (uri === activeUri) continue;

			const scored = this._scoreFileInternal(uri, activeUri, query);
			if (scored && scored.score >= MIN_SCORE_THRESHOLD) {
				results.push(scored);
			}
		}

		// Stable sort: score descending, then alphabetical for ties
		results.sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri));
		return results.slice(0, maxResults);
	}

	scoreFile(uri: string, query: IRelevanceQuery): IScoredItem | undefined {
		const activeUri = query.activeFileUri ?? query.uri;
		if (!activeUri || uri === activeUri) return undefined;
		return this._scoreFileInternal(uri, activeUri, query);
	}

	getRelevantSymbols(query: IRelevanceQuery, maxSymbols = 40): Array<{ symbol: IIndexedSymbol; score: number }> {
		const scoredFiles = this.scoreFiles(query, 15);
		const queryTokens = query.text ? this._tokenize(query.text) : (query.symbols ?? []);
		const results: Array<{ symbol: IIndexedSymbol; score: number }> = [];

		for (const file of scoredFiles) {
			const symbols = this._symbolIndex.getSymbolsInFile(file.uri);

			for (const sym of symbols) {
				let symScore = file.score;

				// Boost exported symbols
				if (sym.exportedAs) symScore += 0.05;

				// Boost name matches against query
				if (queryTokens.length > 0) {
					const symTokens = this._tokenize(sym.name);
					const matchCount = this._countTokenMatches(queryTokens, symTokens);
					if (matchCount > 0) {
						symScore += 0.15 * (matchCount / queryTokens.length);
					}
				}

				// Boost if it's in the active file's import list as a specific symbol
				if (file.reasons.includes('import-direct') && sym.exportedAs) {
					symScore += 0.1;
				}

				results.push({ symbol: sym, score: Math.min(symScore, 1.0) });
			}
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, maxSymbols);
	}

	private _gatherCandidates(activeUri: string, query: IRelevanceQuery): Set<string> {
		const candidates = new Set<string>();

		// Direct imports and importers (depth 1)
		const directImports = this._symbolIndex.getImports(activeUri);
		for (const imp of directImports) candidates.add(imp);

		const directImporters = this._symbolIndex.getImporters(activeUri);
		for (const imp of directImporters) candidates.add(imp);

		// Depth 2 imports (transitive)
		for (const imp of directImports) {
			if (candidates.size >= MAX_CANDIDATES) break;
			const depth2 = this._symbolIndex.getImports(imp);
			for (const d2 of depth2) {
				candidates.add(d2);
				if (candidates.size >= MAX_CANDIDATES) break;
			}
		}

		// Open editor tabs
		for (const uri of this._openFileUris) {
			candidates.add(uri);
		}

		// Recently edited files
		const recentEdits = this._changeTracker.getRecentlyEdited(300_000);
		for (const profile of recentEdits) {
			candidates.add(profile.uri);
		}

		// Co-edited files
		const coEdited = this._changeTracker.getCoEditedFiles(activeUri);
		for (const uri of coEdited) {
			candidates.add(uri);
		}

		// If query has text, also look for symbol name matches in the global index
		if (query.text) {
			const tokens = this._tokenize(query.text);
			for (const token of tokens.slice(0, 5)) {
				if (token.length < NAME_MATCH_MIN_TOKEN_LENGTH) continue;
				const matchedSymbols = this._symbolIndex.getSymbolsByName(token);
				for (const sym of matchedSymbols) {
					candidates.add(sym.filePath);
					if (candidates.size >= MAX_CANDIDATES) break;
				}
			}
		}

		// If query specifies symbols explicitly
		if (query.symbols) {
			for (const symName of query.symbols) {
				const matched = this._symbolIndex.getSymbolsByName(symName);
				for (const sym of matched) candidates.add(sym.filePath);
			}
		}

		return candidates;
	}

	private _scoreFileInternal(uri: string, activeUri: string, query: IRelevanceQuery): IScoredItem | undefined {
		const reasons: RelevanceReason[] = [];
		const matchedTokens: string[] = [];
		let totalScore = 0;

		// 1. Import distance
		const importScore = this._computeImportScore(uri, activeUri);
		if (importScore > 0) {
			totalScore += importScore * W_IMPORT;
			reasons.push(importScore >= 0.9 ? 'import-direct' : 'import-transitive');
		}

		// 2. Edit recency (via change tracker)
		const heat = this._changeTracker.getEditHeat(uri);
		if (heat > 0.05) {
			totalScore += heat * W_RECENCY;
			reasons.push('co-edit-recent');
		}

		// 3. Name matching
		if (query.text || query.symbols) {
			const nameScore = this._computeNameMatchScore(uri, query, matchedTokens);
			if (nameScore > 0) {
				totalScore += nameScore * W_NAME_MATCH;
				reasons.push('name-match');
			}
		}

		// 4. Co-edit correlation
		const coEditScore = this._computeCoEditScore(uri, activeUri);
		if (coEditScore > 0) {
			totalScore += coEditScore * W_COEDIT;
			if (!reasons.includes('co-edit-recent')) reasons.push('co-edit-recent');
		}

		// 5. Open tab
		if (this._openFileUris.has(uri)) {
			totalScore += W_OPEN_TAB;
			reasons.push('open-tab');
		}

		// 6. Directory proximity
		const dirScore = this._computeDirectoryScore(uri, activeUri);
		if (dirScore > 0) {
			totalScore += dirScore * W_DIRECTORY;
			reasons.push('same-directory');
		}

		// 7. Type dependency
		const typeScore = this._computeTypeDependencyScore(uri, activeUri);
		if (typeScore > 0) {
			totalScore += typeScore * W_TYPE_DEP;
			reasons.push('type-dependency');
		}

		// Bonus: high edit velocity indicates active development
		const velocity = this._changeTracker.getEditVelocity(uri);
		if (velocity > 10) {
			totalScore += 0.03;
			reasons.push('high-edit-velocity');
		}

		if (totalScore < MIN_SCORE_THRESHOLD) return undefined;

		// Collect relevant symbol names from this file
		const fileSymbols = this._symbolIndex.getSymbolsInFile(uri);
		const symbolNames = fileSymbols
			.filter(s => s.exportedAs)
			.slice(0, 10)
			.map(s => s.name);

		return {
			uri,
			score: Math.min(totalScore, 1.0),
			reasons,
			symbols: symbolNames.length > 0 ? symbolNames : undefined,
			matchedTokens: matchedTokens.length > 0 ? matchedTokens : undefined,
		};
	}

	// ─── Scoring Signals ────────────────────────────────────────────────────────

	private _computeImportScore(uri: string, activeUri: string): number {
		// Check depth 1
		const directImports = this._symbolIndex.getImports(activeUri);
		if (directImports.includes(uri)) return 1.0;

		// Also check reverse: if the target imports activeUri
		const targetImports = this._symbolIndex.getImports(uri);
		if (targetImports.includes(activeUri)) return 0.8;

		// Depth 2
		for (const imp of directImports) {
			const depth2Imports = this._symbolIndex.getImports(imp);
			if (depth2Imports.includes(uri)) return IMPORT_DEPTH_2_SCORE;
		}

		// Depth 3 (limited — only check a subset)
		const checkLimit = Math.min(directImports.length, 10);
		for (let i = 0; i < checkLimit; i++) {
			const d2Imports = this._symbolIndex.getImports(directImports[i]);
			for (const d2 of d2Imports.slice(0, 10)) {
				const d3Imports = this._symbolIndex.getImports(d2);
				if (d3Imports.includes(uri)) return IMPORT_DEPTH_3_SCORE;
			}
		}

		return 0;
	}

	private _computeNameMatchScore(uri: string, query: IRelevanceQuery, matchedTokens: string[]): number {
		const queryTokens = query.text ? this._tokenize(query.text) : [];
		const explicitSymbols = query.symbols ?? [];
		const allQueryTerms = [...queryTokens, ...explicitSymbols].filter(t => t.length >= NAME_MATCH_MIN_TOKEN_LENGTH);

		if (allQueryTerms.length === 0) return 0;

		const symbols = this._symbolIndex.getSymbolsInFile(uri);
		if (symbols.length === 0) return 0;

		let matchCount = 0;
		const symbolTokenSets = symbols.map(s => this._tokenize(s.name));
		const allSymbolTokens = new Set<string>();
		for (const tokenSet of symbolTokenSets) {
			for (const t of tokenSet) allSymbolTokens.add(t.toLowerCase());
		}

		for (const qt of allQueryTerms) {
			const lower = qt.toLowerCase();
			if (allSymbolTokens.has(lower)) {
				matchCount++;
				matchedTokens.push(qt);
			} else {
				// Substring match for longer tokens
				for (const st of allSymbolTokens) {
					if (st.length > 3 && (st.includes(lower) || lower.includes(st))) {
						matchCount += 0.5;
						matchedTokens.push(qt);
						break;
					}
				}
			}
		}

		// Also match against file name
		const fileName = uri.split('/').pop() ?? '';
		const fileTokens = this._tokenize(fileName.replace(/\.\w+$/, ''));
		for (const qt of allQueryTerms) {
			if (fileTokens.some(ft => ft.toLowerCase() === qt.toLowerCase())) {
				matchCount += 0.7;
				if (!matchedTokens.includes(qt)) matchedTokens.push(qt);
			}
		}

		return Math.min(matchCount / allQueryTerms.length, 1.0);
	}

	private _computeCoEditScore(uri: string, activeUri: string): number {
		const coEdited = this._changeTracker.getCoEditedFiles(activeUri);
		if (coEdited.includes(uri)) return 1.0;

		// Transitive co-edit: if a third file is co-edited with both
		for (const middleUri of coEdited) {
			const middleCoEdits = this._changeTracker.getCoEditedFiles(middleUri);
			if (middleCoEdits.includes(uri)) return 0.4;
		}

		return 0;
	}

	private _computeDirectoryScore(uri: string, activeUri: string): number {
		const dirA = this._dirname(activeUri);
		const dirB = this._dirname(uri);

		if (dirA === dirB) return 1.0;

		// Parent directory
		const parentA = this._dirname(dirA);
		const parentB = this._dirname(dirB);

		if (parentA === dirB || dirB === parentA) return 0.6;
		if (parentA === parentB) return 0.4;

		// Grandparent
		const gpA = this._dirname(parentA);
		if (gpA === dirB || gpA === parentB) return 0.2;

		return 0;
	}

	private _computeTypeDependencyScore(uri: string, activeUri: string): number {
		const imports = this._symbolIndex.getImports(activeUri);
		if (!imports.includes(uri)) return 0;

		const symbols = this._symbolIndex.getSymbolsInFile(uri);
		const typeSymbols = symbols.filter(s =>
			s.kind === 10 /* Interface */ ||
			s.kind === 25 /* TypeParameter */ ||
			s.kind === 4 /* Enum */ ||
			s.kind === 22 /* Struct */
		);

		if (typeSymbols.length === 0) return 0;

		// Weight by ratio of type exports
		const typeRatio = typeSymbols.length / Math.max(symbols.length, 1);
		return Math.min(typeRatio * 2, 1.0);
	}

	// ─── Utilities ──────────────────────────────────────────────────────────────

	private _tokenize(text: string): string[] {
		const cached = _tokenCache.get(text);
		if (cached) return cached;

		const tokens = text
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')  // camelCase split
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // acronym split: XMLParser → XML Parser
			.replace(/[_\-./\\:@#$%^&*()+=\[\]{}<>,;'"!?|~`]/g, ' ')
			.split(/\s+/)
			.filter(t => t.length >= NAME_MATCH_MIN_TOKEN_LENGTH)
			.map(t => t.trim())
			.filter(Boolean);

		// LRU eviction
		if (_tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
			const firstKey = _tokenCache.keys().next().value;
			if (firstKey !== undefined) _tokenCache.delete(firstKey);
		}
		_tokenCache.set(text, tokens);

		return tokens;
	}

	private _countTokenMatches(queryTokens: string[], targetTokens: string[]): number {
		let matches = 0;
		const targetLower = new Set(targetTokens.map(t => t.toLowerCase()));

		for (const qt of queryTokens) {
			if (targetLower.has(qt.toLowerCase())) {
				matches++;
			}
		}
		return matches;
	}

	private _dirname(uri: string): string {
		const lastSlash = uri.lastIndexOf('/');
		return lastSlash > 0 ? uri.substring(0, lastSlash) : uri;
	}
}

registerSingleton(IRelevanceScorerService, RelevanceScorerService, InstantiationType.Eager);
