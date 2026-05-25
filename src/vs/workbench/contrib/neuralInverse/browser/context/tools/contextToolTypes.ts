/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared types for context tools across all execution surfaces
 * (NI Workflow Agent, Power Mode, Void sidebar).
 */

export interface IContextToolDeps {
	readonly contextPacker: import('../packer/contextPacker.js').IContextPackerService;
	readonly symbolIndex: import('../index/workspaceSymbolIndex.js').IWorkspaceSymbolIndexService;
	readonly relevanceScorer: import('../relevance/relevanceScorer.js').IRelevanceScorerService;
	readonly changeTracker: import('../tracker/changeTracker.js').IChangeTrackerService;
}

export const CONTEXT_TOOL_NAMES = [
	'searchSymbols',
	'getRelatedFiles',
	'getFileContext',
	'getImportGraph',
	'getRecentEdits',
] as const;

export type ContextToolName = typeof CONTEXT_TOOL_NAMES[number];
