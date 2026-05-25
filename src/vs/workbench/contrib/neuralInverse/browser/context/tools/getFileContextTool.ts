/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IContextPackerService, ContextMode } from '../packer/contextPacker.js';

export interface IGetFileContextArgs {
	file: string;
	budget?: number;
}

/**
 * Core logic for packing relevant context around a file.
 * Returns the pre-packed context string (or empty string if unavailable).
 */
export async function executeGetFileContext(
	args: IGetFileContextArgs,
	contextPacker: IContextPackerService,
	workspaceUriStr: string,
): Promise<string> {
	if (!args.file || args.file.trim().length === 0) {
		return '';
	}

	// Clamp budget to sane range
	const budget = Math.min(Math.max(args.budget || 8192, 256), 65536);

	// Normalize path
	const normalized = args.file.trim().replace(/^\/+/, '');
	const fileUri = normalized.includes('://') ? normalized : `${workspaceUriStr}/${normalized}`;

	try {
		return await contextPacker.packToString({
			mode: 'agent' as ContextMode,
			query: { type: 'file', activeFileUri: fileUri, uri: fileUri },
			budget,
			includeActiveFile: true,
		});
	} catch {
		return '';
	}
}
