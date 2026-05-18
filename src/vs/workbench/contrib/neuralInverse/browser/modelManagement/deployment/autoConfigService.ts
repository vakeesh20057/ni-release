/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';
import { IVoidSettingsService } from '../../../../void/common/voidSettingsService.js';
import { ProviderName } from '../../../../void/common/voidSettingsTypes.js';
import { IDeploymentRegistryService } from './deploymentRegistryService.js';
import { IUnifiedDeployment, getDeploymentEndpoint, IAutoConfigRule } from './deploymentTypes.js';

const AUTO_CONFIG_RULES_KEY = 'neuralInverse.deployment.autoConfigRules';
const AUTO_CONFIG_DISMISSED_KEY = 'neuralInverse.deployment.autoConfigDismissed';

export const IDeploymentAutoConfigService = createDecorator<IDeploymentAutoConfigService>('deploymentAutoConfigService');

export interface IDeploymentAutoConfigService {
	readonly _serviceBrand: undefined;
	getAppliedRules(): IAutoConfigRule[];
	revertRule(deploymentId: string): void;
}

export class DeploymentAutoConfigService extends Disposable implements IDeploymentAutoConfigService {
	readonly _serviceBrand: undefined;

	private _appliedRules: IAutoConfigRule[] = [];
	private _dismissedProviders: Set<string> = new Set();

	constructor(
		@IDeploymentRegistryService private readonly registryService: IDeploymentRegistryService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._loadState();
		this._register(this.registryService.onDeploymentBecameReady(d => this._handleDeploymentReady(d)));
	}

	getAppliedRules(): IAutoConfigRule[] {
		return [...this._appliedRules];
	}

	revertRule(deploymentId: string): void {
		this._appliedRules = this._appliedRules.filter(r => r.deploymentId !== deploymentId);
		this._saveState();
	}

	private _handleDeploymentReady(deployment: IUnifiedDeployment): void {
		const endpoint = getDeploymentEndpoint(deployment);
		if (!endpoint) { return; }

		const provider = endpoint.provider;

		// Check if user already dismissed auto-config for this provider
		if (this._dismissedProviders.has(provider)) { return; }

		// Only auto-config if provider settings are currently unconfigured
		if (this._isProviderConfigured(provider)) {
			return;
		}

		// Apply auto-configuration
		this._applyAutoConfig(deployment, endpoint.url, endpoint.apiKey, endpoint.modelName, provider);
	}

	private _isProviderConfigured(provider: ProviderName): boolean {
		const settings = this.voidSettingsService.state.settingsOfProvider[provider];
		if (!settings) { return false; }

		// Check if endpoint has been manually configured (not default)
		if ('endpoint' in settings) {
			const endpoint = settings.endpoint as string;
			const defaults: Record<string, string> = {
				'ollama': 'http://127.0.0.1:11434',
				'vLLM': 'http://localhost:8000/v1',
				'lmStudio': 'http://localhost:1234/v1',
			};
			const defaultEndpoint = defaults[provider] || '';
			if (endpoint && endpoint !== defaultEndpoint && endpoint.length > 0) {
				return true;
			}
		}

		// Check if API key is set (for vLLM cloud deployments)
		if ('apiKey' in settings) {
			const apiKey = settings.apiKey as string;
			if (apiKey && apiKey.length > 0) {
				return true;
			}
		}

		// Check if models have been configured
		if (settings._didFillInProviderSettings) {
			return true;
		}

		return false;
	}

	private _applyAutoConfig(
		deployment: IUnifiedDeployment,
		endpointUrl: string,
		apiKey: string | undefined,
		modelName: string | undefined,
		provider: ProviderName
	): void {
		// For local deployments, just register models (endpoint is already default)
		if (deployment.kind === 'local') {
			if (deployment.models.length > 0) {
				this.voidSettingsService.setAutodetectedModels(
					provider,
					deployment.models,
					{ enableProviderOnSuccess: true, hideRefresh: false }
				);

				this._recordRule(deployment.id, provider, 'models', deployment.models.join(','));

				this.notificationService.info(
					`Auto-configured ${deployment.displayName}: ${deployment.models.length} model(s) available.`
				);
			}
			return;
		}

		// For cloud deployments, set endpoint + apiKey + model
		this.voidSettingsService.setSettingOfProvider(provider, 'endpoint', endpointUrl);
		this._recordRule(deployment.id, provider, 'endpoint', endpointUrl);

		if (apiKey) {
			this.voidSettingsService.setSettingOfProvider(provider, 'apiKey', apiKey);
			this._recordRule(deployment.id, provider, 'apiKey', '***');
		}

		if (modelName) {
			this.voidSettingsService.setAutodetectedModels(
				provider,
				[modelName],
				{ enableProviderOnSuccess: true, hideRefresh: false }
			);
			this._recordRule(deployment.id, provider, 'model', modelName);
		}

		this.notificationService.prompt(
			Severity.Info,
			`Cloud deployment ready: ${deployment.modelName} connected to ${provider} provider.`,
			[
				{ label: 'OK', run: () => {} },
				{
					label: 'Undo',
					run: () => {
						this._revertCloudConfig(deployment.id, provider);
					}
				},
				{
					label: "Don't auto-configure",
					run: () => {
						this._dismissedProviders.add(provider);
						this._revertCloudConfig(deployment.id, provider);
						this._saveState();
					}
				}
			]
		);
	}

	private _revertCloudConfig(deploymentId: string, provider: ProviderName): void {
		const defaults: Record<string, string> = {
			'ollama': 'http://127.0.0.1:11434',
			'vLLM': 'http://localhost:8000/v1',
			'lmStudio': 'http://localhost:1234/v1',
		};
		this.voidSettingsService.setSettingOfProvider(provider, 'endpoint', defaults[provider] || '');
		this.voidSettingsService.setSettingOfProvider(provider, 'apiKey', '');
		this.revertRule(deploymentId);
	}

	private _recordRule(deploymentId: string, provider: ProviderName, settingKey: string, value: string): void {
		this._appliedRules.push({
			deploymentId,
			provider,
			settingKey,
			value,
			appliedAt: Date.now(),
		});
		this._saveState();
	}

	private _loadState(): void {
		try {
			const rulesRaw = this.storageService.get(AUTO_CONFIG_RULES_KEY, StorageScope.PROFILE);
			if (rulesRaw) {
				this._appliedRules = JSON.parse(rulesRaw);
			}
			const dismissedRaw = this.storageService.get(AUTO_CONFIG_DISMISSED_KEY, StorageScope.PROFILE);
			if (dismissedRaw) {
				const arr = JSON.parse(dismissedRaw) as string[];
				this._dismissedProviders = new Set(arr);
			}
		} catch { /* start fresh */ }
	}

	private _saveState(): void {
		this.storageService.store(AUTO_CONFIG_RULES_KEY, JSON.stringify(this._appliedRules), StorageScope.PROFILE, StorageTarget.USER);
		this.storageService.store(AUTO_CONFIG_DISMISSED_KEY, JSON.stringify([...this._dismissedProviders]), StorageScope.PROFILE, StorageTarget.USER);
	}
}
