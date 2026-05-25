/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceSymbolIndexService } from '../index/workspaceSymbolIndex.js';

export interface IGetImportGraphArgs {
	file: string;
	depth?: number;
}

export interface IImportGraphResult {
	file: string;
	imports: string[];
	importers: string[];
}

/**
 * Core logic for retrieving import/importer relationships.
 * Returns structured graph data.
 */
export function executeGetImportGraph(
	args: IGetImportGraphArgs,
	symbolIndex: IWorkspaceSymbolIndexService,
	workspaceUriStr: string,
): IImportGraphResult {
	if (!args.file || args.file.trim().length === 0) {
		return { file: '', imports: [], importers: [] };
	}

	if (!symbolIndex.isReady()) {
		return { file: args.file, imports: [], importers: [] };
	}

	const depth = Math.min(Math.max(args.depth || 1, 1), 3);

	// Normalize path
	const normalized = args.file.trim().replace(/^\/+/, '');
	const fileUri = normalized.includes('://') ? normalized : `${workspaceUriStr}/${normalized}`;

	let imports: string[];
	let importers: string[];

	try {
		imports = depth > 1
			? symbolIndex.getTransitiveImports(fileUri, depth)
			: symbolIndex.getImports(fileUri);
	} catch {
		imports = [];
	}

	try {
		importers = depth > 1
			? symbolIndex.getTransitiveDependents(fileUri, depth)
			: symbolIndex.getImporters(fileUri);
	} catch {
		importers = [];
	}

	return { file: args.file, imports, importers };
}
