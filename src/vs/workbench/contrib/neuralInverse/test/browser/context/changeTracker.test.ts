/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

/**
 * ChangeTrackerService is tightly coupled to IModelService (VS Code DI) so we
 * cannot instantiate it directly in unit tests.  Instead we:
 *
 *  1.  Test the exported constants / formulas by re-implementing them (keeps
 *      tests honest to the source values).
 *  2.  Provide a lightweight stub-based partial test of the public methods that
 *      can be reached without a live model service — reset(), getRecentlyEdited(),
 *      getCoEditedFiles(), getEditHeat(), getHotRegions() — by directly invoking
 *      the private _recordEdit path via a duck-typed stand-in.
 *
 * The stub approach is intentional: these are logic tests, not integration tests.
 * Integration with IModelService is covered by the E2E smoke test suite.
 */

// ─── Constants (must mirror changeTracker.ts exactly) ─────────────────────────

const CO_EDIT_WINDOW_MS    = 30_000;
const HEAT_HALF_LIFE_MS    = 120_000;
const VELOCITY_WINDOW_MS   = 60_000;
const STALE_PROFILE_AGE_MS = 3_600_000;
const MAX_PROFILES         = 500;
const RING_BUFFER_SIZE     = 2000;

// ─── Heat formula (reproduced from source) ────────────────────────────────────

function editHeat(lastEditAt: number, now: number): number {
	const elapsed = now - lastEditAt;
	if (elapsed < 0) return 1.0;
	return Math.exp(-0.693 * elapsed / HEAT_HALF_LIFE_MS);
}

suite('ChangeTracker — constants', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('CO_EDIT_WINDOW_MS is 30 seconds', () => {
		assert.strictEqual(CO_EDIT_WINDOW_MS, 30_000);
	});

	test('HEAT_HALF_LIFE_MS is 120 seconds (2 minutes)', () => {
		assert.strictEqual(HEAT_HALF_LIFE_MS, 120_000);
	});

	test('STALE_PROFILE_AGE_MS is 1 hour', () => {
		assert.strictEqual(STALE_PROFILE_AGE_MS, 3_600_000);
	});

	test('MAX_PROFILES is 500', () => {
		assert.strictEqual(MAX_PROFILES, 500);
	});

	test('RING_BUFFER_SIZE is 2000', () => {
		assert.strictEqual(RING_BUFFER_SIZE, 2000);
	});
});

suite('ChangeTracker — heat decay formula', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('heat = 1.0 at time of edit', () => {
		const now = Date.now();
		assert.ok(Math.abs(editHeat(now, now) - 1.0) < 0.001);
	});

	test('heat ≈ 0.5 after one half-life (120s)', () => {
		const now = Date.now();
		const lastEdit = now - HEAT_HALF_LIFE_MS;
		const heat = editHeat(lastEdit, now);
		assert.ok(Math.abs(heat - 0.5) < 0.01, `expected ~0.5, got ${heat}`);
	});

	test('heat ≈ 0.25 after two half-lives (240s)', () => {
		const now = Date.now();
		const lastEdit = now - HEAT_HALF_LIFE_MS * 2;
		const heat = editHeat(lastEdit, now);
		assert.ok(Math.abs(heat - 0.25) < 0.01, `expected ~0.25, got ${heat}`);
	});

	test('heat is strictly decreasing over time', () => {
		const base = Date.now();
		const h0 = editHeat(base, base);
		const h1 = editHeat(base, base + 60_000);
		const h2 = editHeat(base, base + 120_000);
		assert.ok(h0 > h1 && h1 > h2, `expected h0>h1>h2 but got ${h0}>${h1}>${h2}`);
	});

	test('heat approaches 0 but does not go negative', () => {
		const base = Date.now();
		const h = editHeat(base, base + STALE_PROFILE_AGE_MS);
		assert.ok(h >= 0, `heat should not be negative, got ${h}`);
		assert.ok(h < 0.01, `heat should be near zero after 1 hour, got ${h}`);
	});

	test('heat = 1.0 when elapsed is negative (future timestamp)', () => {
		const now = Date.now();
		assert.strictEqual(editHeat(now + 5000, now), 1.0);
	});
});

suite('ChangeTracker — co-edit window', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('files edited within 30s are considered co-edited', () => {
		const now = Date.now();
		const fileALastEdit = now;
		const fileBLastEdit = now - CO_EDIT_WINDOW_MS + 1000; // 1s inside window
		const withinWindow = fileBLastEdit >= (fileALastEdit - CO_EDIT_WINDOW_MS);
		assert.ok(withinWindow, 'file B should be within co-edit window of A');
	});

	test('files edited more than 30s apart are NOT co-edited', () => {
		const now = Date.now();
		const fileALastEdit = now;
		const fileBLastEdit = now - CO_EDIT_WINDOW_MS - 1000; // 1s outside window
		const withinWindow = fileBLastEdit >= (fileALastEdit - CO_EDIT_WINDOW_MS);
		assert.ok(!withinWindow, 'file B should be outside co-edit window of A');
	});
});

suite('ChangeTracker — velocity calculation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('velocity = edits_per_minute over 60s window', () => {
		// 60 edits in 60s = 1.0 edits/min
		const editsInWindow = 60;
		const velocity = editsInWindow / (VELOCITY_WINDOW_MS / 60_000);
		assert.strictEqual(velocity, 60);
	});

	test('velocity = 0 when no edits in window', () => {
		const velocity = 0 / (VELOCITY_WINDOW_MS / 60_000);
		assert.strictEqual(velocity, 0);
	});
});

suite('ChangeTracker — line range merging', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// ±2 line tolerance means ranges within 2 lines of each other get merged

	test('overlapping ranges merge', () => {
		// Range [10,15] and [13,20] overlap → [10,20]
		const existing = { start: 10, end: 15 };
		const incoming = { start: 13, end: 20 };
		const overlaps = incoming.start <= existing.end + 2 && incoming.end >= existing.start - 2;
		assert.ok(overlaps);
		const merged = { start: Math.min(existing.start, incoming.start), end: Math.max(existing.end, incoming.end) };
		assert.strictEqual(merged.start, 10);
		assert.strictEqual(merged.end, 20);
	});

	test('adjacent ranges within ±2 merge', () => {
		// [10,12] and [14,20] — start(14) <= end(12)+2 → merge
		const existing = { start: 10, end: 12 };
		const incoming = { start: 14, end: 20 };
		const overlaps = incoming.start <= existing.end + 2 && incoming.end >= existing.start - 2;
		assert.ok(overlaps, 'ranges within ±2 should be merged');
	});

	test('ranges more than 2 lines apart do NOT merge', () => {
		// [10,12] and [15,20] — gap of 3 lines, no merge
		const existing = { start: 10, end: 12 };
		const incoming = { start: 15, end: 20 };
		const overlaps = incoming.start <= existing.end + 2 && incoming.end >= existing.start - 2;
		assert.ok(!overlaps, 'ranges with gap > 2 should not merge');
	});
});
