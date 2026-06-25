/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Layer 2: Markdown-to-Tool Extraction
 *
 * When an OSS model outputs markdown code blocks instead of XML tool calls,
 * this module attempts to parse them into actual tool calls. It covers
 * the most common failure patterns:
 * - Shell commands in bash/sh/zsh blocks
 * - File creation with preceding path indicators
 * - Diff/patch blocks indicating edit intent
 * - Inline command suggestions ("run `npm install`")
 */

import type { RawToolCallObj } from '../sendLLMMessageTypes.js';

const CODE_BLOCK_RE = /```(\w+)?\s*\n([\s\S]*?)```/g;

const BASH_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'terminal', 'console', 'cmd', 'powershell', 'ps1']);

const FILE_LANGS = new Set([
	'typescript', 'ts', 'javascript', 'js', 'tsx', 'jsx',
	'python', 'py', 'java', 'kotlin', 'kt', 'go', 'rust', 'rs',
	'c', 'cpp', 'cxx', 'cc', 'h', 'hpp',
	'css', 'scss', 'less', 'html', 'xml', 'svg',
	'json', 'yaml', 'yml', 'toml', 'ini', 'env',
	'sql', 'graphql', 'gql', 'proto',
	'ruby', 'rb', 'php', 'swift', 'dart', 'lua',
	'vue', 'svelte', 'astro',
	'dockerfile', 'makefile', 'cmake',
	'markdown', 'md', 'txt', 'conf', 'cfg',
]);

const FILE_INTENT_RE = /(?:(?:create|write|save|make|generate|add|put)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+|named\s+|at\s+)?|(?:File|Path|file_path|Filename|Location|Output):\s*)`?([^\s`\n"']+)`?/i;

const FILE_PATH_RE = /^\/[^\s]+\.[a-z]{1,6}$|^[a-z][\w\-.]*(?:\/[a-z][\w\-.]*)*\.[a-z]{1,6}$/i;

const INLINE_COMMAND_RE = /(?:(?:run|execute|type|enter|use)\s*[:>]?\s*)`([^`\n]+)`/gi;

const READ_INTENT_RE = /(?:let me (?:read|check|look at|open|see)|(?:reading|checking|opening|viewing)\s+(?:the\s+)?(?:file\s+)?)`?([^\s`\n"']+\.[a-z]{1,6})`?/i;

export interface MarkdownExtractionResult {
	extractedToolCalls: RawToolCallObj[];
	hadCodeBlocks: boolean;
}

let _extractionIdCounter = 0;

function makeToolCall(name: string, params: Record<string, string>): RawToolCallObj {
	return {
		name,
		rawParams: params,
		doneParams: Object.keys(params) as RawToolCallObj['doneParams'],
		isDone: true,
		id: `md-extract-${++_extractionIdCounter}`,
	};
}

function extractPathFromContext(precedingText: string): string | null {
	// Strategy 1: explicit "File: path" or "create file called path" pattern
	const intentMatch = FILE_INTENT_RE.exec(precedingText);
	if (intentMatch && intentMatch[1]) {
		const candidate = intentMatch[1].replace(/[`'",:;]/g, '');
		if (FILE_PATH_RE.test(candidate)) return candidate;
	}

	// Strategy 2: backtick-quoted path in last 3 lines
	const lines = precedingText.split('\n').slice(-4);
	for (let i = lines.length - 1; i >= 0; i--) {
		const backtickPath = lines[i].match(/`([a-zA-Z][\w\-./]*\.[a-z]{1,6})`/);
		if (backtickPath && backtickPath[1]) return backtickPath[1];
	}

	// Strategy 3: bare path-looking string in last 2 lines
	const lastLines = lines.slice(-2).join('\n');
	const barePath = lastLines.match(/(?:^|\s)((?:[a-zA-Z][\w\-]*\/)+[\w\-]+\.[a-z]{1,6})(?:\s|$|:)/m);
	if (barePath && barePath[1]) return barePath[1];

	return null;
}

function extractInlineCommands(fullText: string): RawToolCallObj[] {
	const results: RawToolCallObj[] = [];
	const seen = new Set<string>();

	let match: RegExpExecArray | null;
	INLINE_COMMAND_RE.lastIndex = 0;
	while ((match = INLINE_COMMAND_RE.exec(fullText)) !== null) {
		const cmd = match[1].trim();
		if (cmd.length > 3 && !seen.has(cmd) && !cmd.includes('`') && looksLikeCommand(cmd)) {
			seen.add(cmd);
			results.push(makeToolCall('bash', { command: cmd }));
		}
	}
	return results;
}

function looksLikeCommand(text: string): boolean {
	const commandPrefixes = [
		'npm ', 'npx ', 'yarn ', 'pnpm ', 'bun ',
		'pip ', 'python ', 'python3 ',
		'cargo ', 'rustup ', 'go ',
		'git ', 'mkdir ', 'cd ', 'rm ', 'cp ', 'mv ', 'touch ', 'cat ',
		'curl ', 'wget ', 'chmod ', 'chown ',
		'docker ', 'kubectl ', 'terraform ',
		'apt ', 'brew ', 'dnf ', 'pacman ',
		'tsc ', 'eslint ', 'prettier ',
		'node ', 'deno ',
	];
	const lower = text.toLowerCase();
	return commandPrefixes.some(p => lower.startsWith(p)) || lower.startsWith('./') || lower.startsWith('sudo ');
}

/**
 * Attempt to extract tool calls from markdown code blocks in the model's text output.
 * Returns null if no confident extraction can be made.
 */
export function extractToolCallsFromMarkdown(
	fullText: string,
): MarkdownExtractionResult | null {
	const blocks: Array<{ lang: string; content: string; precedingText: string; index: number }> = [];

	let match: RegExpExecArray | null;
	CODE_BLOCK_RE.lastIndex = 0;
	while ((match = CODE_BLOCK_RE.exec(fullText)) !== null) {
		const lang = (match[1] || '').toLowerCase();
		const content = match[2].trim();
		const precedingText = fullText.substring(Math.max(0, match.index - 300), match.index);
		blocks.push({ lang, content, precedingText, index: match.index });
	}

	if (blocks.length === 0) {
		// Still check for inline command suggestions: "run `npm install`"
		const inlineCmds = extractInlineCommands(fullText);
		if (inlineCmds.length > 0) {
			return { extractedToolCalls: inlineCmds, hadCodeBlocks: false };
		}
		return null;
	}

	const toolCalls: RawToolCallObj[] = [];

	for (const block of blocks) {
		if (!block.content) continue;

		// Bash/shell commands -> bash tool
		if (BASH_LANGS.has(block.lang)) {
			// Split multi-line commands separated by blank lines into separate calls
			const commands = block.content.split(/\n{2,}/).map(c => c.trim()).filter(Boolean);
			for (const cmd of commands) {
				toolCalls.push(makeToolCall('bash', { command: cmd }));
			}
			continue;
		}

		// Diff/patch -> cannot reliably convert to edit tool, extract as bash apply
		if (block.lang === 'diff' || block.lang === 'patch') {
			continue;
		}

		// File creation: look for path indicators in preceding text
		if (FILE_LANGS.has(block.lang) || !block.lang) {
			const filePath = extractPathFromContext(block.precedingText);
			if (filePath && block.content.length > 5) {
				toolCalls.push(makeToolCall('write', { file_path: filePath, content: block.content }));
				continue;
			}
		}

		// Unlabeled code block with substantial content + detectable path
		if (!block.lang && block.content.length > 20) {
			// Could be bash if it looks like shell
			if (looksLikeCommand(block.content.split('\n')[0])) {
				toolCalls.push(makeToolCall('bash', { command: block.content }));
				continue;
			}
		}
	}

	// Also pick up inline commands from the non-code-block text
	const inlineCmds = extractInlineCommands(fullText);
	// Only add inline commands that weren't already captured from code blocks
	const existingCmds = new Set(toolCalls.filter(t => t.name === 'bash').map(t => t.rawParams['command']));
	for (const cmd of inlineCmds) {
		if (!existingCmds.has(cmd.rawParams['command'])) {
			toolCalls.push(cmd);
		}
	}

	// Also check for read intent: "Let me check package.json"
	const readMatch = READ_INTENT_RE.exec(fullText);
	if (readMatch && readMatch[1] && FILE_PATH_RE.test(readMatch[1])) {
		toolCalls.push(makeToolCall('read', { file_path: readMatch[1] }));
	}

	if (toolCalls.length === 0) {
		return { extractedToolCalls: [], hadCodeBlocks: true };
	}

	return {
		extractedToolCalls: toolCalls,
		hadCodeBlocks: true,
	};
}
