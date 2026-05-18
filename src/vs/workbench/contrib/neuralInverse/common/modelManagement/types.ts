/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProviderName } from './../../../void/common/voidSettingsTypes.js';

// Re-export for consumers
export type { ProviderName };

/**
 * Represents a model available in a registry (not yet installed)
 */
export interface IAvailableModel {
	id: string;
	name: string;
	provider: ProviderName;
	description?: string;
	size?: number; // bytes
	tags?: string[];
	digest?: string;
	modified?: Date;
	contextWindow?: number;
	capabilities?: ModelCapability[];
	avatar?: string; // HuggingFace organization/user name for avatar fetching
}

export type ModelCapability = 'chat' | 'code' | 'tool-calling' | 'vision' | 'reasoning';

/**
 * Represents an installed model
 */
export interface IInstalledModel {
	id: string;
	name: string;
	provider: ProviderName;
	size: number; // bytes on disk
	digest: string;
	modified: Date;
	format?: 'gguf' | 'safetensors' | 'pytorch' | 'other';
	parameters?: string; // e.g., "7B", "70B"
	quantization?: string; // e.g., "Q4_K_M", "Q8_0"
}

/**
 * Model pull/download progress
 */
export interface IModelPullProgress {
	modelId: string;
	provider: ProviderName;
	status: 'queued' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'failed' | 'cancelled';
	total?: number; // total bytes
	downloaded?: number; // bytes downloaded
	percentage?: number; // 0-100
	speed?: number; // bytes per second
	eta?: number; // seconds remaining
	error?: string;
}

/**
 * Model test result
 */
export interface IModelTestResult {
	modelId: string;
	provider: ProviderName;
	success: boolean;
	latency: {
		timeToFirstToken?: number; // ms
		totalTime: number; // ms
		tokensPerSecond?: number;
	};
	tokens?: {
		input: number;
		output: number;
	};
	response?: string;
	error?: string;
}

/**
 * Model health status
 */
export interface IModelHealthStatus {
	provider: ProviderName;
	status: 'healthy' | 'degraded' | 'offline' | 'error';
	endpoint?: string;
	latency?: number; // ms
	error?: string;
	lastChecked: Date;
}

/**
 * Model comparison result (for side-by-side testing)
 */
export interface IModelComparisonResult {
	models: {
		modelId: string;
		provider: ProviderName;
		result: IModelTestResult;
	}[];
	prompt: string;
	timestamp: Date;
}

/**
 * Disk space info
 */
export interface IDiskSpaceInfo {
	available: number; // bytes
	total: number; // bytes
	used: number; // bytes
	modelStoragePath: string;
}

/**
 * Provider detection result
 */
export interface IProviderDetectionResult {
	provider: ProviderName;
	detected: boolean;
	endpoint: string;
	configured: boolean; // already configured in settings
	modelsAvailable?: number;
}
