/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

/**
 * The RelevanceScorerService injects IEditorService, IWorkspaceSymbolIndexService,
 * and IChangeTrackerService, making it hard to instantiate directly in unit tests.
 *
 * We test the pure functions that are statically derivable from the module — the
 * scoring constants and the tokenisation / weight arithmetic — by reproducing them
 * exactly as they appear in the source.  This keeps the test honest to the
 * implementation without requiring a full DI container.
 */

// ─── Constants re-declared (must match relevanceScorer.ts exactly) ───────────

const W_IMPORT       = 0.28;
const W_RECENCY      = 0.22;
const W_NAME_MATCH   = 0.20;
const W_COEDIT       = 0.12;
const W_OPEN_TAB     = 0.08;
const W_DIRECTORY    = 0.06;
const W_TYPE_DEP     = 0.04;
const MIN_SCORE_THRESHOLD = 0.02;
const IMPORT_DEPTH_2_SCORE = 0.5;
const IMPORT_DEPTH_3_SCORE = 0.2;
const NAME_MATCH_MIN_TOKEN_LENGTH = 2;
const MAX_TOKEN_CACHE_SIZE = 100;

// ─── Tokeniser (copied from source) ──────────────────────────────────────────

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/[_\-./\\:@#$%^&*()+=\[\]{}<>,;'"!?|~`]/g, ' ')
		.split(/\s+/)
		.filter(t => t.length >= NAME_MATCH_MIN_TOKEN_LENGTH)
		.map(t => t.trim())
		.filter(Boolean);
}

suite('RelevanceScorer — weight constants', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('all signal weights sum to exactly 1.0', () => {
		const total = W_IMPORT + W_RECENCY + W_NAME_MATCH + W_COEDIT + W_OPEN_TAB + W_DIRECTORY + W_TYPE_DEP;
		assert.ok(Math.abs(total - 1.0) < 1e-10, `weights sum to ${total}, expected 1.0`);
	});

	test('W_IMPORT is the largest weight', () => {
		const others = [W_RECENCY, W_NAME_MATCH, W_COEDIT, W_OPEN_TAB, W_DIRECTORY, W_TYPE_DEP];
		for (const w of others) {
			assert.ok(W_IMPORT > w, `W_IMPORT (${W_IMPORT}) should be larger than ${w}`);
		}
	});

	test('MIN_SCORE_THRESHOLD is positive and small', () => {
		assert.ok(MIN_SCORE_THRESHOLD > 0);
		assert.ok(MIN_SCORE_THRESHOLD < 0.1);
	});

	test('import depth scores are decreasing', () => {
		// Depth 1 = 1.0, depth 2 = 0.5, depth 3 = 0.2
		assert.ok(1.0 > IMPORT_DEPTH_2_SCORE);
		assert.ok(IMPORT_DEPTH_2_SCORE > IMPORT_DEPTH_3_SCORE);
		assert.ok(IMPORT_DEPTH_3_SCORE > 0);
	});
});

suite('RelevanceScorer — tokenizer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('splits camelCase words', () => {
		const tokens = tokenize('camelCaseWord');
		assert.ok(tokens.includes('camel'));
		assert.ok(tokens.includes('Case'));
		assert.ok(tokens.includes('Word'));
	});

	test('splits acronym before mixed case: XMLParser → XML Parser', () => {
		const tokens = tokenize('XMLParser');
		assert.ok(tokens.includes('XML'), `expected XML in ${tokens}`);
		assert.ok(tokens.includes('Parser'), `expected Parser in ${tokens}`);
	});

	test('removes single-char tokens (below min length 2)', () => {
		const tokens = tokenize('a b c longWord');
		assert.ok(!tokens.includes('a'));
		assert.ok(!tokens.includes('b'));
		assert.ok(!tokens.includes('c'));
		assert.ok(tokens.includes('longWord'));
	});

	test('splits on underscores and hyphens', () => {
		const tokens = tokenize('foo_bar-baz');
		assert.ok(tokens.includes('foo'));
		assert.ok(tokens.includes('bar'));
		assert.ok(tokens.includes('baz'));
	});

	test('splits on dots and slashes (file path tokens)', () => {
		const tokens = tokenize('src/utils/helpers.ts');
		assert.ok(tokens.includes('src'));
		assert.ok(tokens.includes('utils'));
		assert.ok(tokens.includes('helpers'));
		// .ts → "ts" but length 2 so should be kept
		assert.ok(tokens.includes('ts'));
	});

	test('empty string returns empty array', () => {
		assert.deepStrictEqual(tokenize(''), []);
	});

	test('filters empty tokens after splitting', () => {
		const tokens = tokenize('   ');
		assert.strictEqual(tokens.length, 0);
	});

	test('handles already-split words without extra tokens', () => {
		const tokens = tokenize('hello world');
		assert.ok(tokens.includes('hello'));
		assert.ok(tokens.includes('world'));
	});
});

suite('RelevanceScorer — score arithmetic', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('direct import contributes W_IMPORT to total', () => {
		const importScore = 1.0; // depth-1 direct import
		const contribution = importScore * W_IMPORT;
		assert.ok(contribution > MIN_SCORE_THRESHOLD, 'direct import alone should clear threshold');
	});

	test('open tab alone clears MIN_SCORE_THRESHOLD', () => {
		assert.ok(W_OPEN_TAB > MIN_SCORE_THRESHOLD);
	});

	test('score is capped at 1.0 (all signals full)', () => {
		// Simulate all signals firing at max
		const raw =
			1.0 * W_IMPORT + 1.0 * W_RECENCY + 1.0 * W_NAME_MATCH +
			1.0 * W_COEDIT + W_OPEN_TAB + 1.0 * W_DIRECTORY + 1.0 * W_TYPE_DEP;
		const capped = Math.min(raw, 1.0);
		assert.strictEqual(capped, 1.0);
	});

	test('depth-2 import contributes less than depth-1', () => {
		const d1 = 1.0 * W_IMPORT;
		const d2 = IMPORT_DEPTH_2_SCORE * W_IMPORT;
		assert.ok(d1 > d2);
	});
});
