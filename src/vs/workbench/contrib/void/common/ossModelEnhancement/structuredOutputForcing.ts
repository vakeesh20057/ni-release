/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Layer 5: Structured Output Forcing
 *
 * For providers that support constrained generation (vLLM guided_json,
 * Ollama format, llama.cpp GBNF grammar), this layer generates the
 * appropriate request parameters to nudge the model toward structured output.
 *
 * NOTE: This is experimental. JSON mode can conflict with XML tool format.
 * Currently only used for single-tool-call scenarios where we know what
 * tool the model should call (e.g., after a correction retry).
 */

import type { ProviderName } from '../voidSettingsTypes.js';

export interface StructuredOutputParams {
	response_format?: { type: 'json_object' | 'text' };
	guided_regex?: string;
	guided_json?: object;
}

const SUPPORTS_STRUCTURED: ReadonlySet<ProviderName> = new Set(['vLLM', 'ollama']);

/**
 * Returns additional request body parameters to encourage structured output,
 * or null if the provider doesn't support it.
 */
export function getStructuredOutputParams(
	providerName: ProviderName,
): StructuredOutputParams | null {
	if (!SUPPORTS_STRUCTURED.has(providerName)) {
		return null;
	}

	// For vLLM: use guided_regex to match XML tool patterns
	if (providerName === 'vLLM') {
		return {
			guided_regex: '<[a-z_]+>.*</[a-z_]+>',
		};
	}

	// For Ollama: we don't force JSON mode because it conflicts with XML tools.
	// Instead we rely on the other layers (prompt, few-shot, retry).
	return null;
}

/**
 * Whether this provider supports structured generation at all.
 */
export function supportsStructuredOutput(providerName: ProviderName): boolean {
	return SUPPORTS_STRUCTURED.has(providerName);
}
