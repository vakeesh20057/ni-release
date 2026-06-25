/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Layer 0: Detection & Orchestration
export { needsOSSEnhancement } from './ossDetection.js';
export { getEnhancementConfig } from './ossEnhancementOrchestrator.js';
export type { OSSEnhancementConfig } from './ossEnhancementOrchestrator.js';

// Layer 1: Prompt Enhancement
export { getOSSEnhancementPrompt } from './ossPromptEnhancement.js';
export { OSS_TOOL_ENFORCEMENT_BLOCK, OSS_EXECUTION_LOOP_BLOCK, OSS_ANTI_PATTERN_BLOCK } from './ossPromptBlocks.js';

// Layer 2: Markdown-to-Tool Extraction
export { extractToolCallsFromMarkdown } from './markdownToToolExtractor.js';
export type { MarkdownExtractionResult } from './markdownToToolExtractor.js';

// Layer 3: Auto-Retry Correction
export { shouldAutoRetry, getCorrectionMessage } from './autoRetryCorrection.js';

// Layer 4: Few-Shot Injection
export { getFewShotExamples, getMinimalFewShot } from './fewShotInjection.js';
export type { FewShotMessage } from './fewShotInjection.js';

// Layer 5: Structured Output Forcing
export { getStructuredOutputParams, supportsStructuredOutput } from './structuredOutputForcing.js';
export type { StructuredOutputParams } from './structuredOutputForcing.js';

// Layer 6: Progress Feedback Loop
export { wrapToolResultForOSS, getStepContinuationNudge } from './progressFeedbackLoop.js';
