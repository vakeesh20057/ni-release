/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Translation Engine — Public Exports & DI Registration
 *
 * Import this file as a side-effect to register the TranslationEngineService in the DI container:
 *
 * ```ts
 * import '...neuralInverseModernisation/browser/engine/translation/index.js';
 * ```
 *
 * All external consumers should import from this file, not from internal modules.
 */

// ── Public service interface ──────────────────────────────────────────────────
export {
	ITranslationEngineService,
	BatchAlreadyRunningError,
} from './service.js';
export type {
	ITranslationSchedulePreview,
	ITranslationSchedulePreviewEntry,
} from './service.js';

// ── Translation options & results ─────────────────────────────────────────────
export type {
	ITranslationOptions,
	ITranslationResult,
	ITranslationVerificationResult,
	IVerificationCheck,
	TranslationOutcome,
	TranslationConfidence,
} from './impl/translationTypes.js';
export {
	DEFAULT_TRANSLATION_OPTIONS,
	CONFIDENCE_SCORE,
} from './impl/translationTypes.js';

// ── Batch progress events ─────────────────────────────────────────────────────
export type {
	ITranslationBatchProgress,
	ITranslationUnitStartedEvent,
	ITranslationUnitCompletedEvent,
	ITranslationBatchCompletedEvent,
	ITranslationBatchMetrics,
	ILanguagePairMetrics,
	IBatchTranslationOptions,
} from './impl/batchTranslationEngine.js';

// ── Metrics helpers ───────────────────────────────────────────────────────────
export {
	formatConfidenceScore,
	outcomeLabel,
} from './impl/translationMetrics.js';

// ── Target file path suggestion (used by UI to preview output locations) ──────
export { suggestTargetFilePath } from './impl/translationRecorder.js';

// ── Language pair registry (used by project setup wizard) ────────────────────
export {
	getLanguagePairProfile,
	getTargetFileExtension,
	listLanguagePairProfiles,
} from './impl/languagePairRegistry.js';

// ── Chunker (used by UI to show oversized unit warnings) ─────────────────────
export type {
	ISourceChunk,
	IChunkSplitResult,
	IChunkStitchInput,
	IStitchResult,
} from './impl/translationChunker.js';
export { splitIntoChunks, stitchChunks, buildChunkContextPrefix } from './impl/translationChunker.js';

// ── Schedule preview utilities ────────────────────────────────────────────────
export { getRiskLevelsInPriorityOrder } from './impl/translationScheduler.js';


// ── DI registration ───────────────────────────────────────────────────────────
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { ITranslationEngineService as _ITranslationEngineService } from './service.js';
import { TranslationEngineServiceImpl } from './TranslationEngineServiceImpl.js';

registerSingleton(_ITranslationEngineService, TranslationEngineServiceImpl, InstantiationType.Delayed);
