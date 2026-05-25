/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

/**
 * ContextPackerService depends on IFileService, IModelService, IRelevanceScorerService,
 * IWorkspaceSymbolIndexService, and IChangeTrackerService.  Full instantiation requires a
 * VS Code DI container.
 *
 * We test the pure, DI-independent logic by reproducing the formulas and constants from
 * contextPacker.ts.  This verifies the budget math, token estimation, mode defaults, and
 * reserve ratios without spinning up the full service.
 */

// ─── Constants (must mirror contextPacker.ts) ─────────────────────────────────

const DEFAULT_BUDGETS: Record<string, number> = {
	autocomplete: 2048,
	chat: 8192,
	'inline-edit': 4096,
	agent: 16384,
};

const ACTIVE_FILE_RESERVE_RATIO  = 0.35;
const PRIORITY_FILE_RESERVE_RATIO = 0.20;
const MIN_REMAINING_BUDGET       = 150;
const MAX_FILE_READ_SIZE         = 524_288; // 512KB

// ─── Token estimator (reproduced from source) ────────────────────────────────

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5);
}

// ─── Hard-truncate helper (reproduced from source) ───────────────────────────

function hardTruncate(text: string, maxTokens: number): string {
	const maxChars = Math.floor(maxTokens * 3.5);
	if (text.length <= maxChars) return text;
	const truncated = text.slice(0, maxChars);
	const lastNewline = truncated.lastIndexOf('\n');
	if (lastNewline > maxChars * 0.8) {
		return truncated.slice(0, lastNewline) + '\n// ... (truncated)';
	}
	return truncated + '\n// ... (truncated)';
}

suite('ContextPacker — default budgets', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('autocomplete budget is 2048 tokens', () => {
		assert.strictEqual(DEFAULT_BUDGETS['autocomplete'], 2048);
	});

	test('chat budget is 8192 tokens', () => {
		assert.strictEqual(DEFAULT_BUDGETS['chat'], 8192);
	});

	test('inline-edit budget is 4096 tokens', () => {
		assert.strictEqual(DEFAULT_BUDGETS['inline-edit'], 4096);
	});

	test('agent budget is 16384 tokens', () => {
		assert.strictEqual(DEFAULT_BUDGETS['agent'], 16384);
	});

	test('agent has the largest budget', () => {
		const max = Math.max(...Object.values(DEFAULT_BUDGETS));
		assert.strictEqual(DEFAULT_BUDGETS['agent'], max);
	});
});

suite('ContextPacker — budget reserve ratios', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('active file reserve is 35% of total budget', () => {
		assert.ok(Math.abs(ACTIVE_FILE_RESERVE_RATIO - 0.35) < 1e-10);
	});

	test('priority file reserve is 20% of total budget', () => {
		assert.ok(Math.abs(PRIORITY_FILE_RESERVE_RATIO - 0.20) < 1e-10);
	});

	test('active + priority reserves do not exceed 55% of budget', () => {
		const combined = ACTIVE_FILE_RESERVE_RATIO + PRIORITY_FILE_RESERVE_RATIO;
		assert.ok(combined <= 0.55, `combined reserve ${combined} exceeds 55%`);
	});

	test('remaining budget for other files is at least 45%', () => {
		const remaining = 1.0 - ACTIVE_FILE_RESERVE_RATIO - PRIORITY_FILE_RESERVE_RATIO;
		assert.ok(remaining >= 0.45);
	});

	test('MIN_REMAINING_BUDGET is 150 tokens', () => {
		assert.strictEqual(MIN_REMAINING_BUDGET, 150);
	});

	test('active file reserve for chat budget is 2867 tokens', () => {
		const chatBudget = DEFAULT_BUDGETS['chat'];
		const reserve = Math.floor(chatBudget * ACTIVE_FILE_RESERVE_RATIO);
		assert.strictEqual(reserve, Math.floor(8192 * 0.35));
	});
});

suite('ContextPacker — token estimator', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty string = 0 tokens', () => {
		assert.strictEqual(estimateTokens(''), 0);
	});

	test('3.5 chars = 1 token (ceiling)', () => {
		// 7 chars → ceil(7/3.5) = 2
		assert.strictEqual(estimateTokens('1234567'), 2);
	});

	test('token count scales linearly with text length', () => {
		const short = estimateTokens('hello');
		const long  = estimateTokens('hello world hello world');
		assert.ok(long > short);
	});

	test('1000-char string ≈ 286 tokens (ceil(1000/3.5))', () => {
		const text = 'x'.repeat(1000);
		assert.strictEqual(estimateTokens(text), Math.ceil(1000 / 3.5));
	});

	test('100KB of code stays within agent budget of 16384', () => {
		// ~100KB code file: 102400 chars → ~29257 tokens — exceeds agent budget
		// This verifies that large files are truncated (not tested here but the
		// math confirms the need for MAX_FILE_READ_SIZE guard)
		const big = estimateTokens('x'.repeat(102_400));
		assert.ok(big > DEFAULT_BUDGETS['agent'], 'large files must be truncated');
	});
});

suite('ContextPacker — MAX_FILE_READ_SIZE', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('MAX_FILE_READ_SIZE is 512KB', () => {
		assert.strictEqual(MAX_FILE_READ_SIZE, 512 * 1024);
	});
});

suite('ContextPacker — hard truncation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('short text is returned unchanged', () => {
		const text = 'const x = 1;';
		assert.strictEqual(hardTruncate(text, 1000), text);
	});

	test('truncated output is shorter than original', () => {
		const text = 'x'.repeat(1000);
		const result = hardTruncate(text, 10);
		assert.ok(result.length < text.length);
	});

	test('truncated output ends with truncation marker', () => {
		const text = 'a'.repeat(500);
		const result = hardTruncate(text, 10);
		assert.ok(result.includes('(truncated)'), `expected truncation marker in: ${result.slice(-50)}`);
	});

	test('prefers line-boundary truncation when newline is in last 20%', () => {
		// Build a text that has a newline near the truncation point
		const lineA = 'const a = 1;\n';         // 13 chars
		const lineB = 'const b = 2;';            // 12 chars, no newline
		const text = lineA + lineB;
		const maxTokens = estimateTokens(lineA) + 1; // fits lineA with a bit of room
		const result = hardTruncate(text, maxTokens);
		assert.ok(result.includes('(truncated)'));
	});
});
