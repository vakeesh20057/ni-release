/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * OSS Enhancement Orchestrator
 *
 * Single entry point that determines which enhancement layers are active
 * for a given provider/model/mode combination. Each layer can be independently
 * toggled based on the chat mode and provider capabilities.
 */

import type { ProviderName, ChatMode } from '../voidSettingsTypes.js';
import { needsOSSEnhancement } from './ossDetection.js';
import { supportsStructuredOutput } from './structuredOutputForcing.js';

export interface OSSEnhancementConfig {
	enabled: boolean;
	promptEnhancement: boolean;
	markdownExtraction: boolean;
	autoRetry: boolean;
	fewShotInjection: boolean;
	structuredOutput: boolean;
	progressFeedback: boolean;
	maxRetries: number;
}

const DISABLED_CONFIG: OSSEnhancementConfig = {
	enabled: false,
	promptEnhancement: false,
	markdownExtraction: false,
	autoRetry: false,
	fewShotInjection: false,
	structuredOutput: false,
	progressFeedback: false,
	maxRetries: 0,
};

const AGENTIC_MODES: ReadonlySet<ChatMode> = new Set(['agent', 'copilot', 'validate', 'power']);

/**
 * Returns the enhancement configuration for a given request context.
 *
 * Layer activation matrix:
 * | Layer              | agent/copilot/power | ask/chat |
 * |--------------------|--------------------:|--------:|
 * | promptEnhancement  | yes                 | yes     |
 * | markdownExtraction | yes                 | yes     |
 * | autoRetry          | yes                 | no      |
 * | fewShotInjection   | yes                 | yes     |
 * | structuredOutput   | yes (if supported)  | no      |
 * | progressFeedback   | yes                 | no      |
 */
export function getEnhancementConfig(
	providerName: ProviderName | undefined,
	modelName: string | undefined,
	chatMode: ChatMode,
): OSSEnhancementConfig {
	if (!providerName || !modelName || !needsOSSEnhancement(providerName, modelName)) {
		return DISABLED_CONFIG;
	}

	const isAgentic = AGENTIC_MODES.has(chatMode);

	return {
		enabled: true,
		promptEnhancement: true,
		markdownExtraction: true,
		autoRetry: isAgentic,
		fewShotInjection: true,
		structuredOutput: isAgentic && supportsStructuredOutput(providerName),
		progressFeedback: isAgentic,
		maxRetries: isAgentic ? 2 : 0,
	};
}
