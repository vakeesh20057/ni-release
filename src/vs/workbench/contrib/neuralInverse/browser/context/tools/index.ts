/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Context Tools — barrel export
 *
 * Exposes the Context Engine's analytical capabilities as agent tools across
 * three execution surfaces:
 *
 * 1. NI Workflow Agent (IAgentTool) — via `createWorkflowContextTools()`
 * 2. Power Mode (IPowerTool)       — via `buildContextPowerTools()`
 * 3. Void sidebar (BuiltinTool)    — via direct service method calls
 *
 * Architecture:
 *   core logic (pure functions) → adapter layer → tool interface
 *
 * Each tool has a single core implementation in its own file that returns
 * structured data. Adapters in ./adapters/ wrap the core logic into the
 * specific tool interface required by each execution surface.
 */

// Types
export { IContextToolDeps, CONTEXT_TOOL_NAMES, ContextToolName } from './contextToolTypes.js';

// Core logic (surface-agnostic)
export { executeSearchSymbols, ISearchSymbolsArgs, ISearchSymbolsResult } from './searchSymbolsTool.js';
export { executeGetRelatedFiles, IGetRelatedFilesArgs, IRelatedFileResult } from './getRelatedFilesTool.js';
export { executeGetFileContext, IGetFileContextArgs } from './getFileContextTool.js';
export { executeGetImportGraph, IGetImportGraphArgs, IImportGraphResult } from './getImportGraphTool.js';
export { executeGetRecentEdits, IGetRecentEditsArgs, IRecentEditResult } from './getRecentEditsTool.js';

// Adapters
export { createWorkflowContextTools } from './adapters/workflowAgentAdapter.js';
export { buildContextPowerTools } from './adapters/powerModeAdapter.js';
