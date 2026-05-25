/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Adapts context tool core logic to the IAgentTool interface
 * used by the NeuralInverse Workflow Agent executor.
 */

import { IAgentTool, IToolExecutionContext, IToolResult } from '../../../../common/workflowTypes.js';
import { IContextToolDeps } from '../contextToolTypes.js';
import { executeSearchSymbols } from '../searchSymbolsTool.js';
import { executeGetRelatedFiles } from '../getRelatedFilesTool.js';
import { executeGetFileContext } from '../getFileContextTool.js';
import { executeGetImportGraph } from '../getImportGraphTool.js';
import { executeGetRecentEdits } from '../getRecentEditsTool.js';

// ─── searchSymbols ───────────────────────────────────────────────────────────

class SearchSymbolsAgentTool implements IAgentTool {
	readonly name = 'searchSymbols';
	readonly description = 'Search the workspace symbol index by name, kind, or file pattern. Returns matching symbols with file locations, kinds, and export status.';
	readonly parameters = {
		query: { type: 'string' as const, description: 'Symbol name or partial name to search for', required: true },
		kind: { type: 'string' as const, description: 'Optional kind filter: function, class, interface, variable, enum, method, property, type, constant', required: false },
		filePattern: { type: 'string' as const, description: 'Optional file path substring to restrict results, e.g. "components/" or ".service.ts"', required: false },
	};

	constructor(private readonly _deps: IContextToolDeps) {}

	async execute(args: Record<string, unknown>, ctx: IToolExecutionContext): Promise<IToolResult> {
		const query = args['query'] as string;
		if (!query) {
			return { success: false, output: '', error: 'query parameter is required' };
		}

		ctx.log(`searchSymbols: "${query}"`);

		try {
			const results = executeSearchSymbols(
				{ query, kind: args['kind'] as string | undefined, filePattern: args['filePattern'] as string | undefined },
				this._deps.symbolIndex,
			);

			if (results.length === 0) {
				return { success: true, output: `No symbols found matching "${query}"` };
			}

			return { success: true, output: `Found ${results.length} symbol(s):\n${JSON.stringify(results, null, 2)}` };
		} catch (e: any) {
			return { success: false, output: '', error: `Symbol search failed: ${e.message}` };
		}
	}
}

// ─── getRelatedFiles ─────────────────────────────────────────────────────────

class GetRelatedFilesAgentTool implements IAgentTool {
	readonly name = 'getRelatedFiles';
	readonly description = 'Get files ranked by relevance to a given file or text query. Uses 7-signal scoring: imports, recency, name-match, co-edits, open tabs, directory proximity, and type dependencies.';
	readonly parameters = {
		file: { type: 'string' as const, description: 'Workspace-relative file path to find related files for', required: false },
		query: { type: 'string' as const, description: 'Text query describing what you are looking for (alternative to file)', required: false },
		maxResults: { type: 'number' as const, description: 'Maximum results to return (default: 15)', required: false },
	};

	constructor(private readonly _deps: IContextToolDeps) {}

	async execute(args: Record<string, unknown>, ctx: IToolExecutionContext): Promise<IToolResult> {
		const file = args['file'] as string | undefined;
		const query = args['query'] as string | undefined;

		if (!file && !query) {
			return { success: false, output: '', error: 'Either file or query parameter is required' };
		}

		ctx.log(`getRelatedFiles: file=${file ?? '-'} query=${query ?? '-'}`);

		try {
			const wsUri = ctx.workspaceUri.toString();
			const results = executeGetRelatedFiles(
				{ file, query, maxResults: args['maxResults'] as number | undefined },
				this._deps.relevanceScorer,
				wsUri,
			);

			if (results.length === 0) {
				return { success: true, output: 'No related files found.' };
			}

			const lines = results.map(item => {
				const shortUri = item.uri.replace(wsUri + '/', '');
				return `  ${(item.score * 100).toFixed(0)}% ${shortUri} [${item.reasons.join(', ')}]`;
			});

			return { success: true, output: `Related files (ranked by relevance):\n${lines.join('\n')}` };
		} catch (e: any) {
			return { success: false, output: '', error: `Related files query failed: ${e.message}` };
		}
	}
}

// ─── getFileContext ──────────────────────────────────────────────────────────

class GetFileContextAgentTool implements IAgentTool {
	readonly name = 'getFileContext';
	readonly description = 'Get pre-packed code context for a file within a token budget. Includes the file itself plus relevant imports, type definitions, and related code. Use this before editing a file to understand its full context without multiple readFile calls.';
	readonly parameters = {
		file: { type: 'string' as const, description: 'Workspace-relative file path to get context for', required: true },
		budget: { type: 'number' as const, description: 'Token budget for the context (default: 8192)', required: false },
	};

	constructor(private readonly _deps: IContextToolDeps) {}

	async execute(args: Record<string, unknown>, ctx: IToolExecutionContext): Promise<IToolResult> {
		const file = args['file'] as string;
		if (!file) {
			return { success: false, output: '', error: 'file parameter is required' };
		}

		ctx.log(`getFileContext: ${file} (budget: ${args['budget'] ?? 8192})`);

		try {
			const packed = await executeGetFileContext(
				{ file, budget: args['budget'] as number | undefined },
				this._deps.contextPacker,
				ctx.workspaceUri.toString(),
			);

			if (!packed) {
				return { success: true, output: `No context available for "${file}" (file may not exist or be empty)` };
			}

			return { success: true, output: packed };
		} catch (e: any) {
			return { success: false, output: '', error: `Context packing failed: ${e.message}` };
		}
	}
}

// ─── getImportGraph ──────────────────────────────────────────────────────────

class GetImportGraphAgentTool implements IAgentTool {
	readonly name = 'getImportGraph';
	readonly description = 'Get import/importer relationships for a file. Shows what this file imports and what files import it. Useful for understanding the impact radius of changes.';
	readonly parameters = {
		file: { type: 'string' as const, description: 'Workspace-relative file path', required: true },
		depth: { type: 'number' as const, description: 'Levels of transitive dependencies to include (default: 1, max: 3)', required: false },
	};

	constructor(private readonly _deps: IContextToolDeps) {}

	async execute(args: Record<string, unknown>, ctx: IToolExecutionContext): Promise<IToolResult> {
		const file = args['file'] as string;
		if (!file) {
			return { success: false, output: '', error: 'file parameter is required' };
		}

		ctx.log(`getImportGraph: ${file} (depth: ${args['depth'] ?? 1})`);

		try {
			const wsUri = ctx.workspaceUri.toString();
			const result = executeGetImportGraph(
				{ file, depth: args['depth'] as number | undefined },
				this._deps.symbolIndex,
				wsUri,
			);

			const wsPrefix = wsUri + '/';
			const shorten = (uri: string) => uri.startsWith(wsPrefix) ? uri.slice(wsPrefix.length) : uri;

			const parts: string[] = [];
			parts.push(`Import graph for: ${file}`);
			parts.push('');
			parts.push(`Imports (${result.imports.length}):`);
			for (const imp of result.imports.slice(0, 50)) {
				parts.push(`  -> ${shorten(imp)}`);
			}
			if (result.imports.length > 50) {
				parts.push(`  ... and ${result.imports.length - 50} more`);
			}
			parts.push('');
			parts.push(`Imported by (${result.importers.length}):`);
			for (const imp of result.importers.slice(0, 50)) {
				parts.push(`  <- ${shorten(imp)}`);
			}
			if (result.importers.length > 50) {
				parts.push(`  ... and ${result.importers.length - 50} more`);
			}

			return { success: true, output: parts.join('\n') };
		} catch (e: any) {
			return { success: false, output: '', error: `Import graph query failed: ${e.message}` };
		}
	}
}

// ─── getRecentEdits ──────────────────────────────────────────────────────────

class GetRecentEditsAgentTool implements IAgentTool {
	readonly name = 'getRecentEdits';
	readonly description = 'Get recently edited files with edit heat scores and velocity. Shows what the developer is actively working on, useful for understanding current focus areas.';
	readonly parameters = {
		withinMinutes: { type: 'number' as const, description: 'Look-back window in minutes (default: 30)', required: false },
	};

	constructor(private readonly _deps: IContextToolDeps) {}

	async execute(args: Record<string, unknown>, ctx: IToolExecutionContext): Promise<IToolResult> {
		const minutes = (args['withinMinutes'] as number) || 30;
		ctx.log(`getRecentEdits: last ${minutes}min`);

		try {
			const wsUri = ctx.workspaceUri.toString();
			const wsPrefix = wsUri + '/';
			const shorten = (uri: string) => uri.startsWith(wsPrefix) ? uri.slice(wsPrefix.length) : uri;

			const results = executeGetRecentEdits(
				{ withinMinutes: minutes },
				this._deps.changeTracker,
			);

			if (results.length === 0) {
				return { success: true, output: 'No recent edits detected in the specified window.' };
			}

			const lines = results.map(r => {
				const ago = Math.round((Date.now() - r.lastEditAt) / 1000);
				return `  ${shorten(r.uri)} | heat: ${(r.heat * 100).toFixed(0)}% | velocity: ${r.velocity.toFixed(1)} edits/min | ${ago}s ago | ${r.editCount} edits`;
			});

			return { success: true, output: `Recently edited files (${results.length}):\n${lines.join('\n')}` };
		} catch (e: any) {
			return { success: false, output: '', error: `Recent edits query failed: ${e.message}` };
		}
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates all context tools as IAgentTool instances for the Workflow Agent executor.
 */
export function createWorkflowContextTools(deps: IContextToolDeps): IAgentTool[] {
	return [
		new SearchSymbolsAgentTool(deps),
		new GetRelatedFilesAgentTool(deps),
		new GetFileContextAgentTool(deps),
		new GetImportGraphAgentTool(deps),
		new GetRecentEditsAgentTool(deps),
	];
}
