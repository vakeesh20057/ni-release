/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { OSS_TOOL_ENFORCEMENT_BLOCK, OSS_EXECUTION_LOOP_BLOCK, OSS_ANTI_PATTERN_BLOCK } from './ossPromptBlocks.js';

export type OSSEnhancementMode = 'agent' | 'power' | 'ask';

/**
 * Builds the full OSS enhancement prompt to prepend/inject into the system message.
 *
 * - 'agent' mode: full enforcement (tool calling + execution loop + anti-patterns)
 * - 'power' mode: full enforcement (same as agent -- Power Mode is autonomous)
 * - 'ask' mode: lighter enforcement (tool calling + anti-patterns, no execution loop)
 */
export function getOSSEnhancementPrompt(mode: OSSEnhancementMode): string {
	const blocks: string[] = [];

	blocks.push(OSS_TOOL_ENFORCEMENT_BLOCK);

	if (mode === 'agent' || mode === 'power') {
		blocks.push(OSS_EXECUTION_LOOP_BLOCK);
	}

	blocks.push(OSS_ANTI_PATTERN_BLOCK);

	blocks.push(OSS_TOOL_MAPPING_BLOCK);

	return blocks.join('\n\n');
}

const OSS_TOOL_MAPPING_BLOCK = `# Tool Name Quick Reference

Use EXACTLY these tool names (not descriptions, not concatenations):

| I want to...             | Call this tool        | NOT this                    |
|--------------------------|----------------------|-----------------------------|
| Create a new file        | write / create_file  | (code block in text)        |
| Read a file              | read / read_file     | (ask user to paste it)      |
| Edit an existing file    | edit / edit_file      | (show diff in text)         |
| Run a shell command      | bash / run_command   | (tell user to run it)       |
| Search for files         | glob / search_files  | (guess the path)            |
| Search file contents     | grep / search_code   | (ask user to search)        |
| List directory           | list / list_directory | (assume structure)          |

Each tool call must be SEPARATE. One tool per call. Do NOT combine tool names.
If a tool returns an error, read the error and adjust -- do not give up.`;
