/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Adapts context tool core logic to the IPowerTool interface
 * used by Power Mode's tool registry.
 */

import { IPowerTool, IToolContext, IToolResult } from '../../../../../powerMode/common/powerModeTypes.js';
import { definePowerTool } from '../../../../../powerMode/browser/tools/powerToolRegistry.js';
import { IContextToolDeps } from '../contextToolTypes.js';
import { executeSearchSymbols } from '../searchSymbolsTool.js';
import { executeGetRelatedFiles } from '../getRelatedFilesTool.js';
import { executeGetFileContext } from '../getFileContextTool.js';
import { executeGetImportGraph } from '../getImportGraphTool.js';
import { executeGetRecentEdits } from '../getRecentEditsTool.js';

/**
 * Creates all context tools as IPowerTool instances for Power Mode's registry.
 *
 * @param deps - Context engine service dependencies
 * @param workspaceUriStr - The workspace root URI as a string (e.g. file:///path/to/project)
 */
export function buildContextPowerTools(deps: IContextToolDeps, workspaceUriStr: string): IPowerTool[] {
	return [
		_buildSearchSymbolsTool(deps),
		_buildGetRelatedFilesTool(deps, workspaceUriStr),
		_buildGetFileContextTool(deps, workspaceUriStr),
		_buildGetImportGraphTool(deps, workspaceUriStr),
		_buildGetRecentEditsTool(deps),
	];
}

// ─── searchSymbols ───────────────────────────────────────────────────────────

function _buildSearchSymbolsTool(deps: IContextToolDeps): IPowerTool {
	return definePowerTool(
		'context_search_symbols',
		'Search the workspace symbol index by name, kind, or file pattern. Returns symbols with file locations and export info.',
		[
			{ name: 'query', type: 'string', description: 'Symbol name or partial name to search for', required: true },
			{ name: 'kind', type: 'string', description: 'Optional kind filter: function, class, interface, variable, enum, method, property, type, constant', required: false },
			{ name: 'file_pattern', type: 'string', description: 'Optional file path substring to restrict results', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const query = args.query as string;
			if (!query) {
				return { title: 'Search Symbols', output: 'Error: query parameter is required', metadata: { error: true } };
			}

			ctx.metadata({ title: `Searching symbols: ${query}` });

			const results = executeSearchSymbols(
				{ query, kind: args.kind, filePattern: args.file_pattern },
				deps.symbolIndex,
			);

			if (results.length === 0) {
				return { title: 'Search Symbols', output: `No symbols found matching "${query}"`, metadata: { count: 0 } };
			}

			const output = results.map(r =>
				`${r.name} (${_kindLabel(r.kind)}) - ${r.file}:${r.line}${r.exported ? ` [exported as ${r.exported}]` : ''}`
			).join('\n');

			return {
				title: `Found ${results.length} symbols`,
				output,
				metadata: { count: results.length },
			};
		},
	);
}

// ─── getRelatedFiles ─────────────────────────────────────────────────────────

function _buildGetRelatedFilesTool(deps: IContextToolDeps, workspaceUriStr: string): IPowerTool {
	return definePowerTool(
		'context_related_files',
		'Get files ranked by relevance to a given file or text query. Uses 7-signal scoring including imports, edit recency, name similarity, and type dependencies.',
		[
			{ name: 'file', type: 'string', description: 'Workspace-relative file path to find related files for', required: false },
			{ name: 'query', type: 'string', description: 'Text query describing what you are looking for', required: false },
			{ name: 'max_results', type: 'number', description: 'Maximum results (default: 15)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			if (!args.file && !args.query) {
				return { title: 'Related Files', output: 'Error: either file or query is required', metadata: { error: true } };
			}

			ctx.metadata({ title: `Finding related files${args.file ? ` for ${args.file}` : ''}` });

			const results = executeGetRelatedFiles(
				{ file: args.file, query: args.query, maxResults: args.max_results },
				deps.relevanceScorer,
				workspaceUriStr,
			);

			if (results.length === 0) {
				return { title: 'Related Files', output: 'No related files found.', metadata: { count: 0 } };
			}

			const wsPrefix = workspaceUriStr + '/';
			const output = results.map(r => {
				const path = r.uri.startsWith(wsPrefix) ? r.uri.slice(wsPrefix.length) : r.uri;
				return `${(r.score * 100).toFixed(0)}% ${path} [${r.reasons.join(', ')}]`;
			}).join('\n');

			return {
				title: `${results.length} related files`,
				output,
				metadata: { count: results.length },
			};
		},
	);
}

// ─── getFileContext ──────────────────────────────────────────────────────────

function _buildGetFileContextTool(deps: IContextToolDeps, workspaceUriStr: string): IPowerTool {
	return definePowerTool(
		'context_file_context',
		'Get pre-packed code context for a file within a token budget. Includes the file, its imports, type definitions, and related code. Use this instead of multiple read calls to understand a file\'s full context.',
		[
			{ name: 'file', type: 'string', description: 'Workspace-relative file path', required: true },
			{ name: 'budget', type: 'number', description: 'Token budget (default: 8192, max: 32768)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const file = args.file as string;
			if (!file) {
				return { title: 'File Context', output: 'Error: file parameter is required', metadata: { error: true } };
			}

			const budget = Math.min((args.budget as number) || 8192, 32768);
			ctx.metadata({ title: `Packing context: ${file}` });

			const packed = await executeGetFileContext(
				{ file, budget },
				deps.contextPacker,
				workspaceUriStr,
			);

			if (!packed) {
				return { title: 'File Context', output: `No context available for "${file}"`, metadata: { empty: true } };
			}

			return {
				title: `Context for ${file}`,
				output: packed,
				metadata: { tokens: deps.contextPacker.estimateTokens(packed), budget },
			};
		},
	);
}

// ─── getImportGraph ──────────────────────────────────────────────────────────

function _buildGetImportGraphTool(deps: IContextToolDeps, workspaceUriStr: string): IPowerTool {
	return definePowerTool(
		'context_import_graph',
		'Get import/importer relationships for a file. Shows what the file imports and what files import it, useful for understanding change impact.',
		[
			{ name: 'file', type: 'string', description: 'Workspace-relative file path', required: true },
			{ name: 'depth', type: 'number', description: 'Transitive depth (default: 1, max: 3)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const file = args.file as string;
			if (!file) {
				return { title: 'Import Graph', output: 'Error: file parameter is required', metadata: { error: true } };
			}

			ctx.metadata({ title: `Import graph: ${file}` });

			const result = executeGetImportGraph(
				{ file, depth: args.depth },
				deps.symbolIndex,
				workspaceUriStr,
			);

			const wsPrefix = workspaceUriStr + '/';
			const shorten = (uri: string) => uri.startsWith(wsPrefix) ? uri.slice(wsPrefix.length) : uri;

			const parts: string[] = [];
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

			return {
				title: `${file}: ${result.imports.length} imports, ${result.importers.length} importers`,
				output: parts.join('\n'),
				metadata: { imports: result.imports.length, importers: result.importers.length },
			};
		},
	);
}

// ─── getRecentEdits ──────────────────────────────────────────────────────────

function _buildGetRecentEditsTool(deps: IContextToolDeps): IPowerTool {
	return definePowerTool(
		'context_recent_edits',
		'Get recently edited files with heat scores and edit velocity. Shows what is actively being worked on.',
		[
			{ name: 'within_minutes', type: 'number', description: 'Look-back window in minutes (default: 30)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			ctx.metadata({ title: 'Recent edits' });

			const results = executeGetRecentEdits(
				{ withinMinutes: args.within_minutes },
				deps.changeTracker,
			);

			if (results.length === 0) {
				return { title: 'Recent Edits', output: 'No recent edits detected.', metadata: { count: 0 } };
			}

			const output = results.map(r => {
				const ago = Math.round((Date.now() - r.lastEditAt) / 1000);
				const path = r.uri.split('/').slice(-3).join('/');
				return `${path} | heat: ${(r.heat * 100).toFixed(0)}% | ${r.velocity.toFixed(1)} edits/min | ${ago}s ago | ${r.editCount} total edits`;
			}).join('\n');

			return {
				title: `${results.length} recently edited files`,
				output,
				metadata: { count: results.length },
			};
		},
	);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _kindLabel(kind: number): string {
	const labels: Record<number, string> = {
		4: 'class', 5: 'method', 6: 'property', 9: 'enum',
		10: 'interface', 11: 'function', 12: 'variable', 13: 'constant', 25: 'type',
	};
	return labels[kind] ?? `kind:${kind}`;
}
