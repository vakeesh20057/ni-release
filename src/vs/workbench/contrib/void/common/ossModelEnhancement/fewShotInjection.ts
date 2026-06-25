/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Layer 4: Few-Shot Injection
 *
 * Injects fake user/assistant turn pairs demonstrating correct XML tool format.
 * This is the single most effective technique for OSS models because it teaches
 * by example rather than instruction, and models are heavily biased toward
 * repeating patterns they see in recent context.
 *
 * The examples cover the core tool types (bash, write, read, edit) and
 * demonstrate multi-tool turns and continuation after results.
 */

export interface FewShotMessage {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * Returns few-shot examples showing correct XML tool usage.
 * Covers: single tool call, multi-tool call, read-then-act, error recovery.
 */
export function getFewShotExamples(): FewShotMessage[] {
	return [
		{
			role: 'user',
			content: 'Create a TypeScript file that exports a greeting function, then install dependencies',
		},
		{
			role: 'assistant',
			content: `<write><file_path>src/greet.ts</file_path><content>export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
</content></write>
<bash><command>npm install typescript @types/node</command></bash>`,
		},
		{
			role: 'user',
			content: '[Tool "write" executed successfully]\n[Tool "bash" executed: added 2 packages]\nNow read package.json and add a build script',
		},
		{
			role: 'assistant',
			content: `<read><file_path>package.json</file_path></read>`,
		},
		{
			role: 'user',
			content: '[Tool "read" result: {"name": "my-app", "scripts": {"test": "jest"}}]\nGood, now add the build script',
		},
		{
			role: 'assistant',
			content: `<edit><file_path>package.json</file_path><old_string>"scripts": {
    "test": "jest"
  }</old_string><new_string>"scripts": {
    "test": "jest",
    "build": "tsc"
  }</new_string></edit>`,
		},
	];
}

/**
 * Returns a condensed single-turn few-shot example for contexts
 * where token budget is tight (e.g., long conversations).
 */
export function getMinimalFewShot(): FewShotMessage[] {
	return [
		{
			role: 'user',
			content: 'Create src/index.ts with a hello world and run it',
		},
		{
			role: 'assistant',
			content: `<write><file_path>src/index.ts</file_path><content>console.log("hello world");
</content></write>
<bash><command>npx ts-node src/index.ts</command></bash>`,
		},
	];
}
