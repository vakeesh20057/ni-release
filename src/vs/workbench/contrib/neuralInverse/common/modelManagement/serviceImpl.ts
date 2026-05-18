/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IModelManagementService } from './service.js';
import {
	IAvailableModel,
	IInstalledModel,
	IModelPullProgress,
	IModelTestResult,
	IModelComparisonResult,
	IModelHealthStatus,
	IDiskSpaceInfo,
	IProviderDetectionResult,
	ModelCapability
} from './types.js';
import { ProviderName } from './../../../void/common/voidSettingsTypes.js';
import { ILLMMessageService } from './../../../void/common/sendLLMMessageService.js';
import { IVoidSettingsService } from './../../../void/common/voidSettingsService.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';

export class ModelManagementService extends Disposable implements IModelManagementService {
	readonly _serviceBrand: undefined;

	private readonly _onPullProgress = this._register(new Emitter<IModelPullProgress>());
	readonly onPullProgress: Event<IModelPullProgress> = this._onPullProgress.event;

	private readonly _onProviderHealthChanged = this._register(new Emitter<IModelHealthStatus>());
	readonly onProviderHealthChanged: Event<IModelHealthStatus> = this._onProviderHealthChanged.event;

	// Track active pull operations
	private activePulls: Map<string, { cancel: () => void }> = new Map();

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		super();
	}

	// Discovery
	async browseModels(provider: ProviderName, searchQuery?: string): Promise<IAvailableModel[]> {
		console.log('browseModels called with provider:', provider, 'search:', searchQuery);

		try {
			// Fetch LIVE from HuggingFace API with NeuralInverse-specific filters
			const searchParam = searchQuery || this._getDefaultSearch();
			const allModels: IAvailableModel[] = [];
			const seenIds = new Set<string>();

			// Try multiple search terms
			const searches = [searchParam, ...this._getNeuralInverseSearchTerms(searchParam)];

			for (const term of searches.slice(0, 3)) { // Limit to 3 searches to avoid rate limits
				try {
					// Use correct HuggingFace API endpoint
					const url = `https://huggingface.co/api/models?search=${encodeURIComponent(term)}&sort=downloads&direction=-1&limit=20`;
					console.log('Fetching from HuggingFace:', url);

					const response = await fetch(url, {
						method: 'GET',
						headers: {
							'Accept': 'application/json'
						}
					});

					console.log('HuggingFace response status:', response.status);

					if (response.ok) {
						const data = await response.json();
						console.log('HuggingFace data received:', data?.length, 'models');

						if (Array.isArray(data)) {
							for (const m of data) {
								const modelId = m.id || m.modelId;
								// Filter by GGUF availability for Ollama/LMStudio
								const hasGGUF = provider === 'vLLM' || (m.tags && m.tags.includes('gguf'));

								if (modelId && !seenIds.has(modelId) && hasGGUF) {
									seenIds.add(modelId);
									allModels.push({
										id: modelId,
										name: modelId,
										provider: provider,
										description: m.description || `${m.downloads || 0} downloads`,
										size: this._estimateModelSize(modelId),
										tags: [...(m.tags || []), provider, ...this._detectDomainTags(modelId, m.tags || [])],
										contextWindow: this._estimateContextWindow(modelId),
										capabilities: this._detectCapabilities(m.tags || [])
									});
								}
							}
						}
					}
				} catch (err) {
					console.warn('Failed to fetch term:', term, err);
					continue;
				}
			}

			console.log('Total models fetched:', allModels.length);

			if (allModels.length > 0) {
				// Sort by relevance to NeuralInverse use cases
				allModels.sort((a, b) => {
					const aScore = this._calculateNeuralInverseScore(a);
					const bScore = this._calculateNeuralInverseScore(b);
					return bScore - aScore;
				});

				return allModels;
			}
		} catch (e) {
			console.error('Failed to fetch from HuggingFace:', e);
		}

		// Fallback to curated list
		console.log('Using fallback curated list');
		if (provider === 'ollama') {
			return this._browseOllamaLibrary(searchQuery);
		}
		return [];
	}

	private _getDefaultSearch(): string {
		return 'code';
	}

	private _getNeuralInverseSearchTerms(baseSearch: string): string[] {
		// NeuralInverse domain-specific search terms
		const domains = [
			'code', 'coder', 'codellama', 'starcoder', 'deepseek',
			'firmware', 'embedded', 'legacy', 'cobol', 'fortran',
			'modernization', 'migration', 'refactor',
			'compliance', 'safety', 'iso26262', 'automotive',
			'qwen', 'mistral', 'llama'
		];

		// If user is searching for something specific, include it with domain terms
		if (baseSearch && baseSearch !== 'code') {
			return domains.filter(d => d !== baseSearch).slice(0, 3);
		}

		return domains.slice(0, 5);
	}

	private _detectDomainTags(modelId: string, existingTags: string[]): string[] {
		const id = modelId.toLowerCase();
		const tags: string[] = [];

		// Detect NeuralInverse-relevant domains
		if (id.includes('code') || id.includes('coder')) tags.push('code');
		if (id.includes('embed') || id.includes('firmware')) tags.push('firmware');
		if (id.includes('legacy') || id.includes('cobol') || id.includes('fortran')) tags.push('legacy');
		if (id.includes('safety') || id.includes('compliance')) tags.push('compliance');
		if (id.includes('automotive') || id.includes('iso')) tags.push('automotive');
		if (id.includes('qwen')) tags.push('recommended');
		if (id.includes('deepseek')) tags.push('recommended');

		return tags;
	}

	private _calculateNeuralInverseScore(model: IAvailableModel): number {
		let score = 0;
		const name = model.name.toLowerCase();
		const tags = model.tags?.join(' ').toLowerCase() || '';

		// Prioritize code-specialized models
		if (name.includes('coder') || name.includes('code')) score += 10;
		if (name.includes('qwen')) score += 8;
		if (name.includes('deepseek')) score += 8;
		if (name.includes('starcoder')) score += 7;
		if (name.includes('codellama')) score += 7;

		// Domain-specific bonuses
		if (name.includes('firmware') || name.includes('embedded')) score += 5;
		if (name.includes('legacy') || name.includes('cobol')) score += 5;
		if (name.includes('safety') || name.includes('compliance')) score += 5;

		// Tag bonuses
		if (tags.includes('code')) score += 3;
		if (tags.includes('gguf')) score += 2; // GGUF preferred for local
		if (model.capabilities?.includes('code')) score += 2;

		return score;
	}

	private _estimateModelSize(modelId: string): number {
		const name = modelId.toLowerCase();
		if (name.includes('7b')) return 4 * 1024 * 1024 * 1024;
		if (name.includes('13b')) return 7 * 1024 * 1024 * 1024;
		if (name.includes('34b') || name.includes('32b')) return 19 * 1024 * 1024 * 1024;
		if (name.includes('70b')) return 40 * 1024 * 1024 * 1024;
		return 5 * 1024 * 1024 * 1024;
	}

	private _estimateContextWindow(modelId: string): number {
		const name = modelId.toLowerCase();
		if (name.includes('32k')) return 32000;
		if (name.includes('128k')) return 128000;
		if (name.includes('200k')) return 200000;
		return 4096;
	}

	private _detectCapabilities(tags: string[]): ModelCapability[] {
		const caps: ModelCapability[] = ['chat'];
		const tagStr = tags.join(' ').toLowerCase();
		if (tagStr.includes('code')) caps.push('code');
		if (tagStr.includes('tool') || tagStr.includes('function')) caps.push('tool-calling');
		if (tagStr.includes('vision')) caps.push('vision');
		if (tagStr.includes('reasoning')) caps.push('reasoning');
		return caps;
	}

	async getModelDetails(provider: ProviderName, modelId: string): Promise<IAvailableModel | undefined> {
		if (provider === 'ollama') {
			const models = await this._browseOllamaLibrary(modelId);
			return models.find(m => m.id === modelId);
		}
		return undefined;
	}

	// Installation
	async listInstalledModels(provider?: ProviderName): Promise<IInstalledModel[]> {
		const localProviders: Array<'ollama' | 'vLLM' | 'lmStudio'> = ['ollama', 'vLLM', 'lmStudio'];
		const providers = provider ?
			(localProviders.includes(provider as any) ? [provider as 'ollama' | 'vLLM' | 'lmStudio'] : []) :
			localProviders;
		const allModels: IInstalledModel[] = [];

		for (const prov of providers) {
			const models = await this._listInstalledForProvider(prov);
			allModels.push(...models);
		}

		return allModels;
	}

	async pullModel(provider: ProviderName, modelId: string, token?: CancellationToken): Promise<void> {
		if (provider !== 'ollama') {
			throw new Error(`Pull not supported for provider: ${provider}`);
		}

		const pullKey = `${provider}:${modelId}`;

		// Check if already pulling
		if (this.activePulls.has(pullKey)) {
			throw new Error(`Model ${modelId} is already being pulled`);
		}

		// Check disk space first
		const diskSpace = await this.getDiskSpace(provider);
		const modelInfo = await this.getModelDetails(provider, modelId);
		if (modelInfo?.size && diskSpace.available < modelInfo.size) {
			throw new Error(`Insufficient disk space. Need ${this._formatBytes(modelInfo.size)}, have ${this._formatBytes(diskSpace.available)}`);
		}

		return new Promise<void>((resolve, reject) => {
			let cancelled = false;

			// Setup cancellation
			const cancel = () => {
				cancelled = true;
				this.activePulls.delete(pullKey);
				this._onPullProgress.fire({
					modelId,
					provider,
					status: 'cancelled'
				});
			};

			this.activePulls.set(pullKey, { cancel });

			if (token) {
				token.onCancellationRequested(() => cancel());
			}

			// Emit queued status
			this._onPullProgress.fire({
				modelId,
				provider,
				status: 'queued'
			});

			// Call Ollama pull API
			this._ollamaPull(modelId, provider, cancelled)
				.then(() => {
					this.activePulls.delete(pullKey);
					this._onPullProgress.fire({
						modelId,
						provider,
						status: 'completed',
						percentage: 100
					});
					// Auto-register model in settings
					this.voidSettingsService.setAutodetectedModels(provider, [modelId], { enableProviderOnSuccess: true, hideRefresh: false });
					resolve();
				})
				.catch((err) => {
					this.activePulls.delete(pullKey);
					this._onPullProgress.fire({
						modelId,
						provider,
						status: 'failed',
						error: err.message
					});
					reject(err);
				});
		});
	}

	async deleteModel(provider: ProviderName, modelId: string): Promise<void> {
		if (provider !== 'ollama') {
			throw new Error(`Delete not supported for provider: ${provider}`);
		}

		const settings = this.voidSettingsService.state.settingsOfProvider[provider];
		let endpoint = 'endpoint' in settings ? settings.endpoint as string : 'http://localhost:11434';
		endpoint = endpoint.replace('127.0.0.1', 'localhost'); // Fix CSP

		const response = await fetch(`${endpoint}/api/delete`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: modelId })
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to delete model: ${errorText || response.statusText}`);
		}

		// Model removed from disk - will be auto-detected as gone on next refresh
	}

	// Testing & Validation
	async testModel(provider: ProviderName, modelId: string, testPrompt: string): Promise<IModelTestResult> {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;
		let outputTokens = 0;

		return new Promise((resolve, reject) => {
			const requestId = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages' as const,
				messages: [{ role: 'user' as const, content: testPrompt }],
				separateSystemMessage: undefined,
				chatMode: null,
				modelSelection: { providerName: provider, modelName: modelId },
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				logging: { loggingName: 'modelTest' },
				mcpTools: undefined,
				onAbort: () => { },
				onText: ({ fullText }) => {
					if (firstTokenTime === undefined) {
						firstTokenTime = Date.now();
					}
					outputTokens++;
				},
				onFinalMessage: ({ fullText }) => {
					const totalTime = Date.now() - startTime;
					const ttft = firstTokenTime ? firstTokenTime - startTime : totalTime;
					const tokensPerSecond = outputTokens > 0 ? (outputTokens / (totalTime / 1000)) : 0;

					resolve({
						modelId,
						provider,
						success: true,
						latency: {
							timeToFirstToken: ttft,
							totalTime,
							tokensPerSecond
						},
						tokens: {
							input: Math.ceil(testPrompt.length / 4),
							output: outputTokens
						},
						response: fullText
					});
				},
				onError: ({ message }) => {
					reject(new Error(message || 'Model test failed'));
				}
			});

			if (!requestId) {
				reject(new Error('Failed to initiate model test'));
			}
		});
	}

	async compareModels(models: { provider: ProviderName; modelId: string }[], testPrompt: string): Promise<IModelComparisonResult> {
		const results = await Promise.all(
			models.map(async ({ provider, modelId }) => ({
				modelId,
				provider,
				result: await this.testModel(provider, modelId, testPrompt)
			}))
		);

		return {
			models: results,
			prompt: testPrompt,
			timestamp: new Date()
		};
	}

	// Health & Status
	async checkProviderHealth(provider: ProviderName): Promise<IModelHealthStatus> {
		if (provider !== 'ollama' && provider !== 'vLLM' && provider !== 'lmStudio') {
			return {
				provider,
				status: 'error',
				error: 'Health check not supported for this provider',
				lastChecked: new Date()
			};
		}

		const settings = this.voidSettingsService.state.settingsOfProvider[provider];
		let endpoint = 'endpoint' in settings ? settings.endpoint as string : undefined;
		if (endpoint) {
			endpoint = endpoint.replace('127.0.0.1', 'localhost'); // Fix CSP
		}

		if (!endpoint) {
			return {
				provider,
				status: 'error',
				endpoint,
				error: 'Endpoint not configured',
				lastChecked: new Date()
			};
		}

		// TODO: Implement actual health check ping
		// For now, return mock status
		return {
			provider,
			status: 'healthy',
			endpoint,
			latency: 45,
			lastChecked: new Date()
		};
	}

	async detectProviders(): Promise<IProviderDetectionResult[]> {
		const localProviders: ProviderName[] = ['ollama', 'vLLM', 'lmStudio'];
		const results: IProviderDetectionResult[] = [];

		for (const provider of localProviders) {
			const settings = this.voidSettingsService.state.settingsOfProvider[provider];
			let endpoint = 'endpoint' in settings ? settings.endpoint as string : '';
		endpoint = endpoint.replace('127.0.0.1', 'localhost'); // Fix CSP
			const configured = settings._didFillInProviderSettings || false;

			// Fix CSP issue: Replace 127.0.0.1 with localhost
			endpoint = endpoint.replace('127.0.0.1', 'localhost');

			// Ping the endpoint to check if running
			let detected = false;
			let modelsAvailable = 0;

			try {
				const response = await fetch(`${endpoint}/api/tags`, {
					method: 'GET',
					signal: AbortSignal.timeout(3000) // 3s timeout
				});

				if (response.ok) {
					detected = true;
					const data = await response.json();
					modelsAvailable = data.models?.length || 0;
				}
			} catch (err) {
				// Provider not running
				detected = false;
			}

			results.push({
				provider,
				detected,
				endpoint,
				configured,
				modelsAvailable
			});
		}

		return results;
	}

	async getDiskSpace(provider: ProviderName): Promise<IDiskSpaceInfo> {
		// Disk space checking requires filesystem access through main process
		// For now, assume sufficient space (models will fail on pull if not enough)
		// TODO: Add IPC call to main process to check actual disk space using Node.js fs
		const modelStoragePath = provider === 'ollama' ? '~/.ollama/models' :
			provider === 'vLLM' ? '~/.cache/huggingface' : '~/.cache/lm-studio';

		return {
			available: 100 * 1024 * 1024 * 1024, // Conservative estimate
			total: 500 * 1024 * 1024 * 1024,
			used: 400 * 1024 * 1024 * 1024,
			modelStoragePath
		};
	}

	async getRecommendedModels(useCase: 'code' | 'firmware' | 'modernization' | 'chat'): Promise<IAvailableModel[]> {
		const allModels = await this._browseOllamaLibrary();

		// Recommendations across all providers
		const recommendations: Record<string, string[]> = {
			code: [
				// Ollama
				'qwen2.5-coder:32b', 'codestral:22b', 'qwen2.5-coder:7b', 'codellama:13b',
				// vLLM
				'Qwen/Qwen2.5-Coder-32B-Instruct', 'meta-llama/CodeLlama-34b-Instruct-hf',
				// LM Studio
				'qwen2.5-coder-32b-instruct', 'codellama-34b-instruct'
			],
			firmware: [
				// Ollama
				'codestral:22b', 'qwen2.5-coder:32b', 'starcoder2:15b', 'deepseek-coder:33b',
				// vLLM
				'deepseek-ai/deepseek-coder-33b-instruct',
				// LM Studio
				'deepseek-coder-33b-instruct'
			],
			modernization: [
				// Ollama
				'deepseek-coder-v2:236b', 'qwen2.5-coder:32b', 'codellama:70b', 'qwen2.5:72b',
				// vLLM
				'Qwen/Qwen2.5-Coder-32B-Instruct', 'deepseek-ai/deepseek-coder-33b-instruct',
				// LM Studio
				'qwen2.5-coder-32b-instruct', 'deepseek-coder-33b-instruct'
			],
			chat: [
				// Ollama
				'llama3.1:70b', 'qwen2.5:72b', 'mixtral:8x7b', 'llama3.1:8b',
				// vLLM
				'meta-llama/Meta-Llama-3.1-70B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3',
				// LM Studio
				'llama-3.1-70b-instruct', 'mistral-7b-instruct-v0.3'
			]
		};

		const recommendedIds = recommendations[useCase] || [];
		return allModels.filter(m => recommendedIds.includes(m.id));
	}

	// Private helpers
	private async _browseOllamaLibrary(searchQuery?: string): Promise<IAvailableModel[]> {
		// Curated model library for all local providers
		// In future, could fetch from provider APIs or a JSON registry
		const allModels: IAvailableModel[] = [
			// === OLLAMA MODELS ===
			// Code models (priority for NeuralInverse)
			{
				id: 'qwen2.5-coder:32b',
				name: 'Qwen2.5 Coder 32B',
				provider: 'ollama',
				description: 'State-of-the-art code model from Alibaba Cloud. Excellent for code generation, modernization, and firmware development.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'qwen', 'recommended'],
				contextWindow: 128000,
				capabilities: ['chat', 'code', 'tool-calling']
			},
			{
				id: 'qwen2.5-coder:7b',
				name: 'Qwen2.5 Coder 7B',
				provider: 'ollama',
				description: 'Smaller, faster Qwen coder. Great for quick iterations and hardware-constrained environments.',
				size: 4.7 * 1024 * 1024 * 1024,
				tags: ['code', 'qwen', 'fast'],
				contextWindow: 128000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'codellama:70b',
				name: 'Code Llama 70B',
				provider: 'ollama',
				description: 'Meta\'s largest Code Llama model. Strong performance on legacy code understanding.',
				size: 38 * 1024 * 1024 * 1024,
				tags: ['code', 'llama', 'meta'],
				contextWindow: 100000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'codellama:13b',
				name: 'Code Llama 13B',
				provider: 'ollama',
				description: 'Balanced Code Llama model. Good quality with reasonable resource usage.',
				size: 7.4 * 1024 * 1024 * 1024,
				tags: ['code', 'llama', 'meta'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'deepseek-coder-v2:236b',
				name: 'DeepSeek Coder V2 236B',
				provider: 'ollama',
				description: 'Massive DeepSeek model. Exceptional for complex COBOL/FORTRAN migrations.',
				size: 136 * 1024 * 1024 * 1024,
				tags: ['code', 'deepseek', 'large'],
				contextWindow: 163000,
				capabilities: ['chat', 'code', 'reasoning']
			},
			{
				id: 'deepseek-coder:33b',
				name: 'DeepSeek Coder 33B',
				provider: 'ollama',
				description: 'DeepSeek\'s popular code model. Strong at embedded C and assembly.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'deepseek'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'starcoder2:15b',
				name: 'StarCoder2 15B',
				provider: 'ollama',
				description: 'BigCode\'s open-source code model. Good for firmware and embedded work.',
				size: 9 * 1024 * 1024 * 1024,
				tags: ['code', 'bigcode'],
				contextWindow: 16000,
				capabilities: ['code']
			},
			{
				id: 'codestral:22b',
				name: 'Codestral 22B',
				provider: 'ollama',
				description: 'Mistral\'s code-specialized model. Fast inference, good for firmware.',
				size: 12.4 * 1024 * 1024 * 1024,
				tags: ['code', 'mistral', 'fast', 'recommended'],
				contextWindow: 32000,
				capabilities: ['chat', 'code', 'tool-calling']
			},

			// Chat/reasoning models
			{
				id: 'llama3.1:70b',
				name: 'Llama 3.1 70B',
				provider: 'ollama',
				description: 'Meta\'s latest large model. Strong reasoning for migration planning.',
				size: 40 * 1024 * 1024 * 1024,
				tags: ['chat', 'reasoning', 'llama'],
				contextWindow: 131000,
				capabilities: ['chat', 'reasoning', 'tool-calling']
			},
			{
				id: 'llama3.1:8b',
				name: 'Llama 3.1 8B',
				provider: 'ollama',
				description: 'Fast and efficient Llama model. Good for quick tasks.',
				size: 4.7 * 1024 * 1024 * 1024,
				tags: ['chat', 'llama', 'fast'],
				contextWindow: 131000,
				capabilities: ['chat', 'tool-calling']
			},
			{
				id: 'qwen2.5:72b',
				name: 'Qwen2.5 72B',
				provider: 'ollama',
				description: 'Qwen\'s flagship chat model. Excellent reasoning for compliance checks.',
				size: 41 * 1024 * 1024 * 1024,
				tags: ['chat', 'reasoning', 'qwen'],
				contextWindow: 128000,
				capabilities: ['chat', 'reasoning', 'tool-calling']
			},
			{
				id: 'mistral:7b',
				name: 'Mistral 7B',
				provider: 'ollama',
				description: 'Fast and capable small model. Good for local testing.',
				size: 4.1 * 1024 * 1024 * 1024,
				tags: ['chat', 'mistral', 'fast'],
				contextWindow: 32000,
				capabilities: ['chat']
			},
			{
				id: 'mixtral:8x7b',
				name: 'Mixtral 8x7B',
				provider: 'ollama',
				description: 'Mistral\'s MoE model. Efficient large model for mixed workloads.',
				size: 26 * 1024 * 1024 * 1024,
				tags: ['chat', 'reasoning', 'mistral'],
				contextWindow: 32000,
				capabilities: ['chat', 'reasoning']
			},

			// === vLLM MODELS ===
			// vLLM uses HuggingFace model IDs
			{
				id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
				name: 'Qwen2.5 Coder 32B (vLLM)',
				provider: 'vLLM',
				description: 'Qwen coder optimized for vLLM. High throughput for production use.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'qwen', 'recommended'],
				contextWindow: 128000,
				capabilities: ['chat', 'code', 'tool-calling']
			},
			{
				id: 'meta-llama/CodeLlama-34b-Instruct-hf',
				name: 'Code Llama 34B (vLLM)',
				provider: 'vLLM',
				description: 'Code Llama optimized for vLLM server deployment.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'llama', 'meta'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'deepseek-ai/deepseek-coder-33b-instruct',
				name: 'DeepSeek Coder 33B (vLLM)',
				provider: 'vLLM',
				description: 'DeepSeek coder for high-throughput vLLM deployments.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'deepseek'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
				name: 'Llama 3.1 70B (vLLM)',
				provider: 'vLLM',
				description: 'Llama 3.1 optimized for vLLM. Production-grade reasoning.',
				size: 40 * 1024 * 1024 * 1024,
				tags: ['chat', 'reasoning', 'llama', 'recommended'],
				contextWindow: 131000,
				capabilities: ['chat', 'reasoning', 'tool-calling']
			},
			{
				id: 'mistralai/Mistral-7B-Instruct-v0.3',
				name: 'Mistral 7B (vLLM)',
				provider: 'vLLM',
				description: 'Fast Mistral model optimized for vLLM batch inference.',
				size: 4.1 * 1024 * 1024 * 1024,
				tags: ['chat', 'mistral', 'fast'],
				contextWindow: 32000,
				capabilities: ['chat']
			},

			// === LM STUDIO MODELS ===
			// LM Studio uses GGUF format model names
			{
				id: 'qwen2.5-coder-32b-instruct',
				name: 'Qwen2.5 Coder 32B (LM Studio)',
				provider: 'lmStudio',
				description: 'Qwen coder GGUF for LM Studio. Desktop-friendly with quantization.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'qwen', 'recommended'],
				contextWindow: 128000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'codellama-34b-instruct',
				name: 'Code Llama 34B (LM Studio)',
				provider: 'lmStudio',
				description: 'Code Llama GGUF optimized for LM Studio desktop app.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'llama', 'meta'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'deepseek-coder-33b-instruct',
				name: 'DeepSeek Coder 33B (LM Studio)',
				provider: 'lmStudio',
				description: 'DeepSeek GGUF for LM Studio. Good for embedded C work.',
				size: 19 * 1024 * 1024 * 1024,
				tags: ['code', 'deepseek'],
				contextWindow: 16000,
				capabilities: ['chat', 'code']
			},
			{
				id: 'llama-3.1-70b-instruct',
				name: 'Llama 3.1 70B (LM Studio)',
				provider: 'lmStudio',
				description: 'Llama 3.1 GGUF with quantization options in LM Studio.',
				size: 40 * 1024 * 1024 * 1024,
				tags: ['chat', 'reasoning', 'llama', 'recommended'],
				contextWindow: 131000,
				capabilities: ['chat', 'reasoning']
			},
			{
				id: 'mistral-7b-instruct-v0.3',
				name: 'Mistral 7B (LM Studio)',
				provider: 'lmStudio',
				description: 'Mistral GGUF optimized for LM Studio. Fast on consumer hardware.',
				size: 4.1 * 1024 * 1024 * 1024,
				tags: ['chat', 'mistral', 'fast'],
				contextWindow: 32000,
				capabilities: ['chat']
			}
		];

		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			return allModels.filter(m =>
				m.id.toLowerCase().includes(query) ||
				m.name.toLowerCase().includes(query) ||
				m.description?.toLowerCase().includes(query) ||
				m.tags?.some(t => t.toLowerCase().includes(query))
			);
		}

		return allModels;
	}

	private async _listInstalledForProvider(provider: 'ollama' | 'vLLM' | 'lmStudio'): Promise<IInstalledModel[]> {
		// Use existing llmMessageService list functionality
		return new Promise((resolve) => {
			if (provider === 'ollama') {
				this.llmMessageService.ollamaList({
					providerName: provider,
					onSuccess: ({ models }) => {
						const installed: IInstalledModel[] = models.map(m => ({
							id: m.name,
							name: m.name,
							provider,
							size: m.size || 0,
							digest: m.digest || '',
							modified: new Date(m.modified_at || Date.now()),
							format: 'gguf'
						}));
						resolve(installed);
					},
					onError: () => {
						resolve([]);
					}
				});
			} else {
				// vLLM or LM Studio
				this.llmMessageService.openAICompatibleList({
					providerName: provider,
					onSuccess: ({ models }) => {
						const installed: IInstalledModel[] = models.map(m => ({
							id: m.id,
							name: m.id,
							provider,
							size: 0, // Not provided by OpenAI-compatible API
							digest: '',
							modified: new Date()
						}));
						resolve(installed);
					},
					onError: () => {
						resolve([]);
					}
				});
			}
		});
	}

	private async _ollamaPull(modelId: string, provider: ProviderName, cancelled: boolean): Promise<void> {
		const settings = this.voidSettingsService.state.settingsOfProvider[provider];
		let endpoint = 'endpoint' in settings ? settings.endpoint as string : 'http://localhost:11434';
		endpoint = endpoint.replace('127.0.0.1', 'localhost'); // Fix CSP

		const response = await fetch(`${endpoint}/api/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: modelId, stream: true }),
			signal: cancelled ? AbortSignal.abort() : undefined
		});

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.statusText}`);
		}

		if (!response.body) {
			throw new Error('No response body from Ollama API');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				if (cancelled) {
					reader.cancel();
					break;
				}

				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const data = JSON.parse(line);

						// Parse Ollama pull response format
						if (data.status === 'downloading') {
							const percentage = data.completed && data.total ?
								Math.round((data.completed / data.total) * 100) : 0;

							this._onPullProgress.fire({
								modelId,
								provider,
								status: 'downloading',
								percentage,
								downloaded: data.completed,
								total: data.total
							});
						} else if (data.status === 'verifying sha256 digest' || data.status === 'writing manifest') {
							this._onPullProgress.fire({
								modelId,
								provider,
								status: 'verifying',
								percentage: 95
							});
						} else if (data.status === 'success') {
							// Pull completed successfully
							break;
						} else if (data.error) {
							throw new Error(data.error);
						}
					} catch (parseErr) {
						// Skip malformed JSON lines
						console.warn('Failed to parse Ollama response line:', line, parseErr);
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private _formatBytes(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
	}
}

registerSingleton(IModelManagementService, ModelManagementService, InstantiationType.Eager);
