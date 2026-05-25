/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IAvailableModel, ProviderName } from '../../common/modelManagement/types.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IModelMarketplaceService = createDecorator<IModelMarketplaceService>('modelMarketplaceService');

export interface IModelMarketplaceService {
	readonly _serviceBrand: undefined;

	/**
	 * Fetch models from HuggingFace API
	 */
	fetchModels(provider: ProviderName, searchQuery?: string): Promise<IAvailableModel[]>;

	/**
	 * Get domain-specific search terms
	 */
	getDomainSearchTerms(): string[];
}

export class ModelMarketplaceService extends Disposable implements IModelMarketplaceService {
	readonly _serviceBrand: undefined;

	private readonly HUGGINGFACE_API = 'https://huggingface.co/api/models';
	private readonly DOMAIN_SEARCHES = ['code', 'firmware', 'embedded', 'legacy', 'cobol', 'fortran', 'compliance', 'automotive', 'safety'];

	constructor() {
		super();
	}

	getDomainSearchTerms(): string[] {
		return [...this.DOMAIN_SEARCHES];
	}

	async fetchModels(provider: ProviderName, searchQuery?: string): Promise<IAvailableModel[]> {

		const searchTerm = searchQuery || 'code';
		const searches = this._buildSearchTerms(searchTerm);
		const allModels: IAvailableModel[] = [];
		const seenIds = new Set<string>();

		// Fetch from HuggingFace API with multiple domain searches
		for (const term of searches.slice(0, 5)) {
			try {
				const url = `${this.HUGGINGFACE_API}?search=${encodeURIComponent(term)}&sort=downloads&direction=-1&limit=100&filter=gguf`;

				const response = await fetch(url, {
					method: 'GET',
					headers: { 'Accept': 'application/json' },
					signal: AbortSignal.timeout(10000)
				});

				if (!response.ok) {
					console.warn(`HuggingFace API failed for term "${term}":`, response.status);
					continue;
				}

				const data = await response.json();

				if (Array.isArray(data)) {
					for (const m of data) {
						const modelId = m.id || m.modelId;
						if (!modelId || seenIds.has(modelId)) continue;

						// Check if model has GGUF files (required for local inference)
						const hasGGUF = provider === 'vLLM' || (m.tags && Array.isArray(m.tags) && m.tags.includes('gguf'));
						if (!hasGGUF) continue;

						seenIds.add(modelId);

						// Extract organization name for avatar API lookup
						const orgName = modelId.split('/')[0];

						allModels.push({
							id: modelId,
							name: modelId,
							provider: provider,
							description: m.description || `${m.downloads || 0} downloads`,
							size: this._estimateModelSize(modelId),
							tags: [...(Array.isArray(m.tags) ? m.tags : []), provider, ...this._detectDomainTags(modelId, m.tags || [])],
							contextWindow: this._estimateContextWindow(modelId),
							capabilities: this._detectCapabilities(m.tags || []),
							avatar: orgName // Store org/user name for async avatar fetch
						});
					}
				}
			} catch (err) {
				console.error(`Failed to fetch models for term "${term}":`, err);
			}
		}

		// Sort by NeuralInverse relevance score
		allModels.sort((a, b) => this._calculateRelevanceScore(b) - this._calculateRelevanceScore(a));

		return allModels;
	}

	private _buildSearchTerms(query: string): string[] {
		const terms = [query];

		// Add NeuralInverse domain variations
		const lowerQuery = query.toLowerCase();
		if (lowerQuery.includes('code')) {
			terms.push('coder', 'codegen', 'qwen-coder', 'deepseek-coder');
		} else if (lowerQuery.includes('firmware') || lowerQuery.includes('embedded')) {
			terms.push('firmware', 'embedded', 'c code', 'automotive');
		} else if (lowerQuery.includes('legacy')) {
			terms.push('cobol', 'fortran', 'mainframe', 'legacy code');
		} else if (lowerQuery.includes('compliance') || lowerQuery.includes('safety')) {
			terms.push('safety', 'compliance', 'automotive', 'medical');
		} else {
			// Default: add code-related terms
			terms.push('code', 'coder', 'qwen');
		}

		return terms;
	}

	private _calculateRelevanceScore(model: IAvailableModel): number {
		let score = 0;
		const name = model.name.toLowerCase();
		const desc = (model.description || '').toLowerCase();

		// Code models (highest priority)
		if (name.includes('coder') || name.includes('code')) score += 10;
		if (name.includes('qwen') && name.includes('coder')) score += 8;
		if (name.includes('deepseek') && name.includes('coder')) score += 8;

		// NeuralInverse domains
		if (name.includes('firmware') || name.includes('embedded')) score += 5;
		if (name.includes('legacy') || name.includes('cobol') || name.includes('fortran')) score += 5;
		if (name.includes('safety') || name.includes('compliance')) score += 5;
		if (name.includes('automotive') || name.includes('iso26262')) score += 5;

		// Size preference (7B-34B models preferred)
		if (name.includes('7b') || name.includes('8b')) score += 3;
		if (name.includes('13b') || name.includes('14b')) score += 2;
		if (name.includes('32b') || name.includes('34b')) score += 1;

		// Quantization preference (Q4_K_M is sweet spot)
		if (name.includes('q4_k_m')) score += 2;
		if (name.includes('q5_k_m')) score += 1;

		// Download count (from description)
		const downloads = parseInt(desc.match(/(\d+)\s*downloads?/)?.[1] || '0');
		if (downloads > 100000) score += 3;
		else if (downloads > 10000) score += 2;
		else if (downloads > 1000) score += 1;

		return score;
	}

	private _detectDomainTags(modelId: string, existingTags: string[]): string[] {
		const tags: string[] = [];
		const name = modelId.toLowerCase();

		if (name.includes('firmware') || name.includes('embedded')) tags.push('firmware', 'embedded');
		if (name.includes('legacy') || name.includes('cobol')) tags.push('legacy');
		if (name.includes('safety') || name.includes('compliance')) tags.push('compliance');
		if (name.includes('automotive')) tags.push('automotive');
		if (name.includes('coder') || name.includes('code')) tags.push('code');

		return tags;
	}

	private _estimateModelSize(modelId: string): number {
		const name = modelId.toLowerCase();

		// Extract size from model name (e.g., "7b", "13b", "70b")
		const sizeMatch = name.match(/\b(\d+)b\b/);
		if (sizeMatch) {
			const params = parseInt(sizeMatch[1]);

			// Estimate based on quantization
			if (name.includes('q4_k_m') || name.includes('q4')) {
				return params * 0.6 * 1024 * 1024 * 1024; // ~0.6GB per billion params for Q4
			} else if (name.includes('q5') || name.includes('q8')) {
				return params * 0.8 * 1024 * 1024 * 1024; // ~0.8GB per billion params
			} else {
				return params * 1.0 * 1024 * 1024 * 1024; // ~1GB per billion params
			}
		}

		// Defaults
		if (name.includes('large')) return 20 * 1024 * 1024 * 1024;
		if (name.includes('small')) return 4 * 1024 * 1024 * 1024;
		return 8 * 1024 * 1024 * 1024; // 8GB default
	}

	private _estimateContextWindow(modelId: string): number {
		const name = modelId.toLowerCase();

		if (name.includes('32k')) return 32768;
		if (name.includes('16k')) return 16384;
		if (name.includes('8k')) return 8192;
		if (name.includes('qwen')) return 32768; // Qwen typically has 32k context
		if (name.includes('coder')) return 16384; // Code models typically 16k+

		return 4096; // Conservative default
	}

	private _detectCapabilities(tags: string[]): Array<'chat' | 'code' | 'tool-calling' | 'vision' | 'reasoning'> {
		const capabilities: Array<'chat' | 'code' | 'tool-calling' | 'vision' | 'reasoning'> = ['chat'];

		for (const tag of tags) {
			const lower = tag.toLowerCase();
			if (lower.includes('code') || lower.includes('coder')) capabilities.push('code');
			if (lower.includes('tool') || lower.includes('function-calling')) capabilities.push('tool-calling');
			if (lower.includes('vision') || lower.includes('multimodal')) capabilities.push('vision');
			if (lower.includes('reasoning') || lower.includes('think')) capabilities.push('reasoning');
		}

		return [...new Set(capabilities)];
	}

	override dispose(): void {
		super.dispose();
	}
}
