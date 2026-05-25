/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceSymbolIndexService } from '../index/workspaceSymbolIndex.js';

const KIND_MAP: Record<string, number> = {
	function: 11, class: 4, interface: 10, variable: 12,
	enum: 9, method: 5, property: 6, type: 25, constant: 13,
};

export interface ISearchSymbolsArgs {
	query: string;
	kind?: string;
	filePattern?: string;
}

export interface ISearchSymbolsResult {
	name: string;
	kind: number;
	file: string;
	line: number;
	exported: string | null;
	container: string | null;
}

/**
 * Core logic for searching the workspace symbol index.
 * Surface-agnostic: returns structured data that each tool adapter formats.
 */
export function executeSearchSymbols(
	args: ISearchSymbolsArgs,
	symbolIndex: IWorkspaceSymbolIndexService,
): ISearchSymbolsResult[] {
	if (!args.query || args.query.trim().length === 0) {
		return [];
	}

	if (!symbolIndex.isReady()) {
		return [];
	}

	let symbols = symbolIndex.getSymbolsByName(args.query.trim());

	if (args.filePattern) {
		const pattern = args.filePattern.trim();
		if (pattern.length > 0) {
			symbols = symbols.filter(s => s.filePath.includes(pattern));
		}
	}

	if (args.kind) {
		const normalizedKind = args.kind.trim().toLowerCase();
		const targetKind = KIND_MAP[normalizedKind];
		if (targetKind !== undefined) {
			symbols = symbols.filter(s => s.kind === targetKind);
		}
	}

	return symbols.slice(0, 30).map(s => ({
		name: s.name,
		kind: s.kind,
		file: s.filePath,
		line: s.range.startLine,
		exported: s.exportedAs ?? null,
		container: s.containerName ?? null,
	}));
}
