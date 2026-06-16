/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

type ComputeFn = () => string | null

type SystemPromptSection = {
	name: string
	compute: ComputeFn
	cacheBreak: boolean
}

const _sectionCache = new Map<string, string | null>()

/**
 * Create a memoized system prompt section.
 * Computed once, cached until clearSystemPromptSections() is called.
 */
export function systemPromptSection(
	name: string,
	compute: ComputeFn,
): SystemPromptSection {
	return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
	name: string,
	compute: ComputeFn,
	_reason: string,
): SystemPromptSection {
	return { name, compute, cacheBreak: true }
}

/**
 * Resolve all system prompt sections, returning prompt strings.
 */
export function resolveSystemPromptSections(
	sections: SystemPromptSection[],
): (string | null)[] {
	return sections.map(s => {
		if (!s.cacheBreak && _sectionCache.has(s.name)) {
			return _sectionCache.get(s.name) ?? null
		}
		const value = s.compute()
		_sectionCache.set(s.name, value)
		return value
	})
}

/**
 * Clear all system prompt section state. Call on new chat thread.
 */
export function clearSystemPromptSections(): void {
	_sectionCache.clear()
}
