/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Layer 3: Auto-Retry with Correction
 *
 * When the model outputs text without any tool calls in an agentic mode,
 * this layer determines if a retry is warranted and provides a targeted
 * correction message that matches the model's apparent intent.
 */

import type { ChatMode } from '../voidSettingsTypes.js';

const AGENTIC_MODES: ReadonlySet<ChatMode> = new Set(['agent', 'copilot', 'validate']);

const MAX_RETRIES = 2;

/**
 * Returns true if the response looks like it should have used tools but didn't.
 * Uses multiple heuristics weighted by confidence:
 * - Code blocks in output (model generated code but didn't execute it)
 * - Narrative intent phrases ("I will create...", "Let me...")
 * - Command suggestions directed at user ("run `npm install`")
 * - File path mentions with modification intent
 */
export function shouldAutoRetry(
	fullText: string,
	toolCallCount: number,
	chatMode: ChatMode,
	retryAttempt: number,
): boolean {
	if (retryAttempt >= MAX_RETRIES) return false;
	if (toolCallCount > 0) return false;
	if (!AGENTIC_MODES.has(chatMode)) return false;
	if (fullText.length < 20) return false;

	// High confidence: model output code in a fenced block
	if (fullText.includes('```')) return true;

	// High confidence: model is telling user to run something
	if (/(?:run|execute|type|enter)\s*[:>]?\s*`[^`]+`/i.test(fullText)) return true;
	if (/(?:you (?:can|should|need to)|please)\s+(?:run|execute|install|create)/i.test(fullText)) return true;

	// Medium confidence: narrative intent + actionable content
	const hasNarrative = /(?:I will|I'll|Let me|Here'?s|I have|I would|I can|First,? I)/i.test(fullText);
	const hasActionContent = /(?:npm |pip |mkdir |cd |git |cargo |yarn |pnpm |docker )/i.test(fullText);
	const hasFilePath = /(?:\/[\w\-.]+){2,}\.[a-z]{1,6}/i.test(fullText);

	if (hasNarrative && (hasActionContent || hasFilePath)) return true;

	// Medium confidence: model lists "steps" or "next steps"
	if (/(?:step\s*\d|next steps|to do this)/i.test(fullText) && hasActionContent) return true;

	return false;
}

/**
 * Returns a targeted correction message based on what the model
 * appeared to be trying to do. The second retry is more aggressive.
 */
export function getCorrectionMessage(retryAttempt: number, fullText?: string): string {
	if (retryAttempt >= 1) {
		// Second retry: extremely direct, minimal explanation
		return `You are STILL outputting text. This is your LAST chance.

Call a tool NOW. Example: <bash><command>echo hello</command></bash>

Do NOT type any text before the tool call. Start your response with < immediately.`;
	}

	// First retry: firm but instructive
	const hasCode = fullText?.includes('```');
	const hasCommand = fullText ? /(?:npm |pip |mkdir |cargo |yarn |git )/i.test(fullText) : false;

	let specific = '';
	if (hasCode && hasCommand) {
		specific = '\nYou wrote code AND commands in text. Both should have been tool calls.';
	} else if (hasCode) {
		specific = '\nYou wrote code in a markdown block. That does NOTHING here. Use the write tool.';
	} else if (hasCommand) {
		specific = '\nYou suggested commands for the user to run. YOU must run them via the bash tool.';
	}

	return `STOP. You output text/markdown instead of calling tools. In this environment, ONLY tool calls have effect.${specific}

Correct format examples:
<bash><command>npm install</command></bash>
<write><file_path>src/index.ts</file_path><content>console.log("hello");\n</content></write>
<read><file_path>package.json</file_path></read>

Rules:
- Start your response with a tool call (the < character), not text
- One tool per XML block, multiple blocks allowed
- No markdown fences, no explanations before acting

Act now.`;
}
