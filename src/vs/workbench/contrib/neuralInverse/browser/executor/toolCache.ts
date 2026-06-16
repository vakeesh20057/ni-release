/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Tool Result Cache
 *
 * Per-run in-memory cache for tool execution results.
 * Identical (toolName, args) pairs return cached results without re-executing.
 *
 * Scope: one cache instance per workflow run, shared across all steps.
 * Only successful results are cached. TTL defaults to 5 minutes.
 */

import { IToolResult } from '../../common/workflowTypes.js';

const DEFAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface ICacheEntry {
	result: IToolResult;
	cachedAt: number;
}

export class ToolResultCache {

	private readonly _store = new Map<string, ICacheEntry>();

	/**
	 * Build a stable cache key from tool name and args.
	 * Args are sorted by key for deterministic output regardless of insertion order.
	 */
	key(toolName: string, args: Record<string, unknown>): string {
		return `${toolName}:${_stableStringify(args)}`;
	}

	/** Return a cached result if present and not expired; undefined otherwise. */
	get(cacheKey: string, ttlMs: number = DEFAULT_TTL_MS): IToolResult | undefined {
		const entry = this._store.get(cacheKey);
		if (!entry) return undefined;
		if (Date.now() - entry.cachedAt > ttlMs) {
			this._store.delete(cacheKey);
			return undefined;
		}
		return entry.result;
	}

	/** Store a successful result. Non-successful results are not cached. */
	set(cacheKey: string, result: IToolResult): void {
		if (!result.success) return;
		this._store.set(cacheKey, { result, cachedAt: Date.now() });
	}

	clear(): void {
		this._store.clear();
	}

	get size(): number {
		return this._store.size;
	}
}

// ─── Stable JSON Stringify ────────────────────────────────────────────────────

/** Deterministically serialize an object with sorted keys (no external deps). */
function _stableStringify(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) {
		return '[' + value.map(_stableStringify).join(',') + ']';
	}
	const obj = value as Record<string, unknown>;
	const sorted = Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${_stableStringify(obj[k])}`);
	return '{' + sorted.join(',') + '}';
}
