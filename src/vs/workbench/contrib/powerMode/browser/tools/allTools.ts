/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Barrel export for all built-in Power Mode tools.
 * Creates and registers all tools for a given working directory.
 */

import { IPowerTool } from '../../common/powerModeTypes.js';
import { createBashTool } from './bashTool.js';
import { createReadTool } from './readTool.js';
import { createWriteTool } from './writeTool.js';
import { createEditTool } from './editTool.js';
import { createGlobTool } from './globTool.js';
import { createGrepTool } from './grepTool.js';
import { createListTool } from './listTool.js';

/**
 * Create all built-in tools for the given workspace directory.
 */
export function createAllTools(workingDirectory: string): IPowerTool[] {
	return [
		createBashTool(workingDirectory),
		createReadTool(workingDirectory),
		createWriteTool(workingDirectory),
		createEditTool(workingDirectory),
		createGlobTool(workingDirectory),
		createGrepTool(workingDirectory),
		createListTool(workingDirectory),
	];
}
