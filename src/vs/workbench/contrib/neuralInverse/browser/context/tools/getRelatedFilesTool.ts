/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IRelevanceScorerService, IScoredItem, IRelevanceQuery } from '../relevance/relevanceScorer.js';

export interface IGetRelatedFilesArgs {
	file?: string;
	query?: string;
	maxResults?: number;
}

export interface IRelatedFileResult {
	uri: string;
	score: number;
	reasons: string[];
}

/**
 * Core logic for scoring workspace files by relevance to a file or query.
 * Surface-agnostic: returns structured data.
 */
export function executeGetRelatedFiles(
	args: IGetRelatedFilesArgs,
	relevanceScorer: IRelevanceScorerService,
	workspaceUriStr: string,
): IRelatedFileResult[] {
	if (!args.file && !args.query) {
		return [];
	}

	const maxResults = Math.min(Math.max(args.maxResults || 15, 1), 60);

	// Normalize file path: strip leading slashes, handle both URI and relative paths
	let fileUri: string | undefined;
	if (args.file) {
		const normalized = args.file.replace(/^\/+/, '');
		fileUri = normalized.includes('://') ? normalized : `${workspaceUriStr}/${normalized}`;
	}

	const relevanceQuery: IRelevanceQuery = {
		type: args.file ? 'file' : 'message',
		uri: fileUri,
		activeFileUri: fileUri,
		text: args.query?.trim() || undefined,
	};

	let scored: IScoredItem[];
	try {
		scored = relevanceScorer.scoreFiles(relevanceQuery, maxResults);
	} catch {
		return [];
	}

	return scored.map(item => ({
		uri: item.uri,
		score: item.score,
		reasons: item.reasons,
	}));
}
