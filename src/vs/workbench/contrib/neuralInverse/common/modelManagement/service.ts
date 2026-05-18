/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import {
	IAvailableModel,
	IInstalledModel,
	IModelPullProgress,
	IModelTestResult,
	IModelComparisonResult,
	IModelHealthStatus,
	IDiskSpaceInfo,
	IProviderDetectionResult
} from './types.js';
import { ProviderName } from './../../../void/common/voidSettingsTypes.js';

export const IModelManagementService = createDecorator<IModelManagementService>('modelManagementService');

/**
 * Service for managing local LLM models (Ollama, vLLM, LM Studio)
 * Handles discovery, installation, testing, and health monitoring
 */
export interface IModelManagementService {
	readonly _serviceBrand: undefined;

	// Discovery
	/**
	 * Browse available models from a provider's registry
	 * For Ollama: fetches from ollama.com/library
	 * For vLLM/LM Studio: may return empty or local registry
	 */
	browseModels(provider: ProviderName, searchQuery?: string): Promise<IAvailableModel[]>;

	/**
	 * Get details about a specific available model
	 */
	getModelDetails(provider: ProviderName, modelId: string): Promise<IAvailableModel | undefined>;

	// Installation
	/**
	 * List all installed models across providers
	 */
	listInstalledModels(provider?: ProviderName): Promise<IInstalledModel[]>;

	/**
	 * Pull/download a model from registry
	 * Returns a cancellable promise
	 */
	pullModel(provider: ProviderName, modelId: string, token?: CancellationToken): Promise<void>;

	/**
	 * Delete an installed model
	 */
	deleteModel(provider: ProviderName, modelId: string): Promise<void>;

	/**
	 * Event fired during model download progress
	 */
	onPullProgress: Event<IModelPullProgress>;

	// Testing & Validation
	/**
	 * Send a test prompt to a model
	 */
	testModel(provider: ProviderName, modelId: string, testPrompt: string): Promise<IModelTestResult>;

	/**
	 * Compare multiple models side-by-side with the same prompt
	 */
	compareModels(models: { provider: ProviderName; modelId: string }[], testPrompt: string): Promise<IModelComparisonResult>;

	// Health & Status
	/**
	 * Check health status of a provider's endpoint
	 */
	checkProviderHealth(provider: ProviderName): Promise<IModelHealthStatus>;

	/**
	 * Auto-detect available local providers
	 */
	detectProviders(): Promise<IProviderDetectionResult[]>;

	/**
	 * Get disk space information for model storage
	 */
	getDiskSpace(provider: ProviderName): Promise<IDiskSpaceInfo>;

	/**
	 * Event fired when provider health status changes
	 */
	onProviderHealthChanged: Event<IModelHealthStatus>;

	/**
	 * Get recommended models for a specific use case
	 */
	getRecommendedModels(useCase: 'code' | 'firmware' | 'modernization' | 'chat'): Promise<IAvailableModel[]>;
}
