/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ICloudDeploymentService } from '../cloudDeploymentService.js';
import { IUnifiedDeployment, ILocalDeployment, ICloudDeploymentEntry, isDeploymentActive } from './deploymentTypes.js';
import { ProviderName } from '../../../../void/common/voidSettingsTypes.js';

const REGISTRY_STORAGE_KEY = 'neuralInverse.deploymentRegistry';
const LOCAL_HEALTH_CHECK_INTERVAL = 30_000;
const LOCAL_HEALTH_CHECK_TIMEOUT = 5_000;

export const IDeploymentRegistryService = createDecorator<IDeploymentRegistryService>('deploymentRegistryService');

export interface IDeploymentRegistryService {
	readonly _serviceBrand: undefined;

	getAll(): IUnifiedDeployment[];
	getActive(): IUnifiedDeployment[];
	getByProvider(provider: ProviderName): IUnifiedDeployment[];
	getById(id: string): IUnifiedDeployment | undefined;

	refresh(): Promise<void>;

	onDidChange: Event<void>;
	onDeploymentBecameReady: Event<IUnifiedDeployment>;
	onDeploymentWentDown: Event<IUnifiedDeployment>;
}

interface ILocalProviderConfig {
	provider: ProviderName;
	displayName: string;
	defaultEndpoint: string;
	healthPath: string;
	modelsPath: string;
}

const LOCAL_PROVIDERS: ILocalProviderConfig[] = [
	{ provider: 'ollama', displayName: 'Ollama', defaultEndpoint: 'http://localhost:11434', healthPath: '/', modelsPath: '/api/tags' },
	{ provider: 'vLLM', displayName: 'vLLM', defaultEndpoint: 'http://localhost:8000/v1', healthPath: '/models', modelsPath: '/models' },
	{ provider: 'lmStudio', displayName: 'LM Studio', defaultEndpoint: 'http://localhost:1234/v1', healthPath: '/models', modelsPath: '/models' },
];

export class DeploymentRegistryService extends Disposable implements IDeploymentRegistryService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDeploymentBecameReady = this._register(new Emitter<IUnifiedDeployment>());
	readonly onDeploymentBecameReady = this._onDeploymentBecameReady.event;

	private readonly _onDeploymentWentDown = this._register(new Emitter<IUnifiedDeployment>());
	readonly onDeploymentWentDown = this._onDeploymentWentDown.event;

	private _deployments: Map<string, IUnifiedDeployment> = new Map();
	private _healthCheckInterval: ReturnType<typeof setInterval> | undefined;
	private _previousStates: Map<string, boolean> = new Map();

	constructor(
		@ICloudDeploymentService private readonly cloudDeploymentService: ICloudDeploymentService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._loadState();
		this._subscribeToCloudChanges();
		this._startLocalHealthChecks();
		this.refresh();
	}

	getAll(): IUnifiedDeployment[] {
		return [...this._deployments.values()];
	}

	getActive(): IUnifiedDeployment[] {
		return this.getAll().filter(isDeploymentActive);
	}

	getByProvider(provider: ProviderName): IUnifiedDeployment[] {
		return this.getAll().filter(d => {
			if (d.kind === 'local') { return d.provider === provider; }
			return d.voidProvider === provider;
		});
	}

	getById(id: string): IUnifiedDeployment | undefined {
		return this._deployments.get(id);
	}

	async refresh(): Promise<void> {
		await this._refreshLocalDeployments();
		this._syncCloudDeployments();
		this._saveState();
		this._onDidChange.fire();
	}

	// --- Local provider detection ---

	private async _refreshLocalDeployments(): Promise<void> {
		for (const config of LOCAL_PROVIDERS) {
			const id = `local-${config.provider}`;
			const existing = this._deployments.get(id) as ILocalDeployment | undefined;
			const previouslyActive = this._previousStates.get(id) ?? false;

			try {
				const healthResp = await fetch(`${config.defaultEndpoint}${config.healthPath}`, {
					signal: AbortSignal.timeout(LOCAL_HEALTH_CHECK_TIMEOUT),
				});

				if (healthResp.ok) {
					const models = await this._fetchLocalModels(config);
					const deployment: ILocalDeployment = {
						kind: 'local',
						id,
						provider: config.provider,
						displayName: config.displayName,
						endpoint: config.defaultEndpoint,
						status: 'running',
						models,
						lastChecked: Date.now(),
					};
					this._deployments.set(id, deployment);

					if (!previouslyActive) {
						this._previousStates.set(id, true);
						this._onDeploymentBecameReady.fire(deployment);
					}
				} else {
					this._markLocalDown(id, config, 'unreachable', previouslyActive);
				}
			} catch {
				this._markLocalDown(id, config, existing ? 'unreachable' : 'stopped', previouslyActive);
			}
		}
	}

	private _markLocalDown(id: string, config: ILocalProviderConfig, status: 'unreachable' | 'stopped', wasPreviouslyActive: boolean): void {
		const deployment: ILocalDeployment = {
			kind: 'local',
			id,
			provider: config.provider,
			displayName: config.displayName,
			endpoint: config.defaultEndpoint,
			status,
			models: [],
			lastChecked: Date.now(),
		};
		this._deployments.set(id, deployment);

		if (wasPreviouslyActive) {
			this._previousStates.set(id, false);
			this._onDeploymentWentDown.fire(deployment);
		}
	}

	private async _fetchLocalModels(config: ILocalProviderConfig): Promise<string[]> {
		try {
			const resp = await fetch(`${config.defaultEndpoint}${config.modelsPath}`, {
				signal: AbortSignal.timeout(LOCAL_HEALTH_CHECK_TIMEOUT),
			});
			if (!resp.ok) { return []; }

			const data = await resp.json();

			if (config.provider === 'ollama') {
				// Ollama returns { models: [{ name, ... }] }
				return (data.models || []).map((m: { name: string }) => m.name);
			} else {
				// OpenAI-compatible: { data: [{ id, ... }] }
				return (data.data || []).map((m: { id: string }) => m.id);
			}
		} catch {
			return [];
		}
	}

	// --- Cloud deployment sync ---

	private _syncCloudDeployments(): void {
		const cloudDeployments = this.cloudDeploymentService.listDeployments();

		// Remove stale cloud entries
		for (const [id, d] of this._deployments) {
			if (d.kind === 'cloud' && !cloudDeployments.find(cd => cd.id === id)) {
				this._deployments.delete(id);
			}
		}

		for (const cd of cloudDeployments) {
			const previouslyActive = this._previousStates.get(cd.id) ?? false;

			const entry: ICloudDeploymentEntry = {
				kind: 'cloud',
				id: cd.id,
				cloudProvider: cd.provider,
				voidProvider: 'vLLM',
				modelId: cd.modelId,
				modelName: cd.modelName,
				endpoint: cd.endpoint,
				status: cd.status,
				config: cd.config,
				createdAt: cd.createdAt,
				costPerHour: cd.config.estimatedCostPerHour,
			};
			this._deployments.set(cd.id, entry);

			const nowActive = cd.status === 'running';
			if (nowActive && !previouslyActive) {
				this._previousStates.set(cd.id, true);
				this._onDeploymentBecameReady.fire(entry);
			} else if (!nowActive && previouslyActive) {
				this._previousStates.set(cd.id, false);
				this._onDeploymentWentDown.fire(entry);
			}
		}
	}

	private _subscribeToCloudChanges(): void {
		this._register(this.cloudDeploymentService.onDeploymentStatusChanged(() => {
			this._syncCloudDeployments();
			this._saveState();
			this._onDidChange.fire();
		}));
	}

	// --- Health check loop ---

	private _startLocalHealthChecks(): void {
		this._healthCheckInterval = setInterval(() => {
			this._refreshLocalDeployments().then(() => {
				this._saveState();
				this._onDidChange.fire();
			});
		}, LOCAL_HEALTH_CHECK_INTERVAL);
	}

	// --- Persistence ---

	private _loadState(): void {
		const raw = this.storageService.get(REGISTRY_STORAGE_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const state = JSON.parse(raw);
				if (state.deployments && Array.isArray(state.deployments)) {
					for (const d of state.deployments) {
						if (d && d.id) {
							this._deployments.set(d.id, d);
							this._previousStates.set(d.id, isDeploymentActive(d));
						}
					}
				}
			} catch { /* corrupted — start fresh */ }
		}
	}

	private _saveState(): void {
		const state = {
			deployments: [...this._deployments.values()],
			lastRefreshed: Date.now(),
		};
		this.storageService.store(REGISTRY_STORAGE_KEY, JSON.stringify(state), StorageScope.PROFILE, StorageTarget.USER);
	}

	override dispose(): void {
		if (this._healthCheckInterval) {
			clearInterval(this._healthCheckInterval);
		}
		super.dispose();
	}
}
