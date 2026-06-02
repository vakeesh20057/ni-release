/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IVoidSettingsService } from '../../common/voidSettingsService.js';
import { ProviderName, SettingName, displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { IDetectedCredential, AUTO_CONNECT_STORAGE_KEY } from './autoConnectTypes.js';
import { detectAllCredentials } from './envVarDetector.js';
import { IExternalCommandExecutor } from '../externalCommandExecutor.js';


export interface IAutoConnectService {
	readonly _serviceBrand: undefined;
	detectCredentials(): Promise<IDetectedCredential[]>;
	applyCredentials(credentials: IDetectedCredential[]): Promise<void>;
	applyOne(credential: IDetectedCredential): Promise<void>;
	dismissProvider(providerName: ProviderName): void;
	setNeverAskAgain(): void;
	readonly detectedCredentials: IDetectedCredential[];
	readonly onDidDetectCredentials: Event<IDetectedCredential[]>;
}

export const IAutoConnectService = createDecorator<IAutoConnectService>('autoConnectService');

interface PersistedState {
	appliedProviders: string[];
	dismissedProviders: string[];
	neverAskAgain: boolean;
}

export class AutoConnectService extends Disposable implements IAutoConnectService {
	readonly _serviceBrand: undefined;

	private _detectedCredentials: IDetectedCredential[] = [];
	private _appliedProviders = new Set<ProviderName>();
	private _dismissedProviders = new Set<ProviderName>();
	private _neverAskAgain = false;

	private readonly _onDidDetectCredentials = this._register(new Emitter<IDetectedCredential[]>());
	readonly onDidDetectCredentials: Event<IDetectedCredential[]> = this._onDidDetectCredentials.event;

	get detectedCredentials(): IDetectedCredential[] {
		return this._detectedCredentials;
	}

	constructor(
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@IStorageService private readonly _storageService: IStorageService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IFileService private readonly _fileService: IFileService,
		@IExternalCommandExecutor private readonly _commandExecutor: IExternalCommandExecutor,
	) {
		super();
		this._loadPersistedState();
		this._runDetection();
	}

	private _loadPersistedState(): void {
		const raw = this._storageService.get(AUTO_CONNECT_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) return;
		try {
			const state: PersistedState = JSON.parse(raw);
			this._appliedProviders = new Set(state.appliedProviders as ProviderName[]);
			this._dismissedProviders = new Set(state.dismissedProviders as ProviderName[]);
			this._neverAskAgain = state.neverAskAgain ?? false;
		} catch {
			// corrupted state, start fresh
		}
	}

	private _persistState(): void {
		const state: PersistedState = {
			appliedProviders: [...this._appliedProviders],
			dismissedProviders: [...this._dismissedProviders],
			neverAskAgain: this._neverAskAgain,
		};
		this._storageService.store(AUTO_CONNECT_STORAGE_KEY, JSON.stringify(state), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _runDetection(): void {
		if (this._neverAskAgain) return;

		this._resolveGhToken().then(ghToken => {
			return detectAllCredentials(this._fileService, ghToken);
		}).then(all => {
			const newCredentials = all.filter(c =>
				!this._appliedProviders.has(c.providerName) &&
				!this._dismissedProviders.has(c.providerName)
			);

			if (newCredentials.length === 0) return;

			this._detectedCredentials = newCredentials;
			this._onDidDetectCredentials.fire(newCredentials);
			this._showNotification(newCredentials);
		});
	}

	private _showNotification(credentials: IDetectedCredential[]): void {
		const names = credentials.map(c => displayInfoOfProviderName(c.providerName).title);
		const message = names.length === 1
			? `Detected credentials for ${names[0]}. Auto-configure?`
			: `Detected credentials for ${names.join(', ')}. Auto-configure?`;

		this._notificationService.prompt(
			Severity.Info,
			message,
			[
				{
					label: 'Auto-configure',
					run: () => { this.applyCredentials(credentials); }
				},
				{
					label: 'Dismiss',
					run: () => {
						for (const c of credentials) {
							this._dismissedProviders.add(c.providerName);
						}
						this._persistState();
					}
				},
				{
					label: "Don't ask again",
					run: () => { this.setNeverAskAgain(); }
				},
			],
		);
	}

	async detectCredentials(): Promise<IDetectedCredential[]> {
		const ghToken = await this._resolveGhToken();
		const all = await detectAllCredentials(this._fileService, ghToken);
		this._detectedCredentials = all;
		this._onDidDetectCredentials.fire(all);
		return all;
	}

	private async _resolveGhToken(): Promise<string | undefined> {
		try {
			const output = await this._commandExecutor.execute('gh-token', 'gh auth token', 5000, 1024);
			const token = output.trim();
			if (token && token.startsWith('gh') && !token.includes(' ')) {
				return token;
			}
		} catch {
			// gh not installed or not logged in — fall through
		}
		return undefined;
	}

	async applyCredentials(credentials: IDetectedCredential[]): Promise<void> {
		for (const credential of credentials) {
			await this.applyOne(credential);
		}
	}

	async applyOne(credential: IDetectedCredential): Promise<void> {
		const { providerName, settings } = credential;

		for (const [key, value] of Object.entries(settings)) {
			await this._settingsService.setSettingOfProvider(
				providerName,
				key as SettingName,
				value as any,
			);
		}

		this._appliedProviders.add(providerName);
		this._persistState();
	}

	dismissProvider(providerName: ProviderName): void {
		this._dismissedProviders.add(providerName);
		this._persistState();
	}

	setNeverAskAgain(): void {
		this._neverAskAgain = true;
		this._persistState();
	}
}

registerSingleton(IAutoConnectService, AutoConnectService, InstantiationType.Eager);
