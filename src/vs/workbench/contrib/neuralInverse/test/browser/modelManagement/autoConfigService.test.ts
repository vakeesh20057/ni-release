/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { DeploymentAutoConfigService } from '../../../browser/modelManagement/deployment/autoConfigService.js';
import { IDeploymentRegistryService } from '../../../browser/modelManagement/deployment/deploymentRegistryService.js';
import { IUnifiedDeployment, ILocalDeployment, ICloudDeploymentEntry } from '../../../browser/modelManagement/deployment/deploymentTypes.js';
import { IVoidSettingsService } from '../../../../void/common/voidSettingsService.js';
import { INotificationService, Severity } from '../../../../../../platform/notification/common/notification.js';

class MockRegistryService {
	readonly _serviceBrand: undefined;
	private readonly _onBecameReady = new Emitter<IUnifiedDeployment>();
	readonly onDeploymentBecameReady: Event<IUnifiedDeployment> = this._onBecameReady.event;
	private readonly _onWentDown = new Emitter<IUnifiedDeployment>();
	readonly onDeploymentWentDown: Event<IUnifiedDeployment> = this._onWentDown.event;
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	fireReady(d: IUnifiedDeployment): void { this._onBecameReady.fire(d); }
	dispose(): void {
		this._onBecameReady.dispose();
		this._onWentDown.dispose();
		this._onDidChange.dispose();
	}
}

class MockVoidSettingsService {
	readonly _serviceBrand: undefined;
	state = {
		settingsOfProvider: {
			ollama: { endpoint: 'http://127.0.0.1:11434', _didFillInProviderSettings: false },
			vLLM: { endpoint: 'http://localhost:8000/v1', apiKey: '', _didFillInProviderSettings: false },
			lmStudio: { endpoint: 'http://localhost:1234/v1', _didFillInProviderSettings: false },
		} as any
	};

	setSettingCalls: Array<{ provider: string; key: string; value: string }> = [];
	autodetectCalls: Array<{ provider: string; models: string[] }> = [];

	setSettingOfProvider(provider: string, key: string, value: string): void {
		this.setSettingCalls.push({ provider, key, value });
	}

	setAutodetectedModels(provider: string, models: string[], _opts: any): void {
		this.autodetectCalls.push({ provider, models });
	}
}

class MockNotificationService {
	readonly _serviceBrand: undefined;
	infoCalls: string[] = [];
	promptCalls: Array<{ severity: Severity; message: string }> = [];

	info(message: string): void { this.infoCalls.push(message); }
	prompt(severity: Severity, message: string, _actions?: any[]): void {
		this.promptCalls.push({ severity, message });
	}
	warn(_message: string): void { }
	error(_message: string): void { }
}

suite('DeploymentAutoConfigService — Unit Tests', () => {
	const disposables = new DisposableStore();
	let storageService: InMemoryStorageService;
	let mockRegistry: MockRegistryService;
	let mockSettings: MockVoidSettingsService;
	let mockNotifications: MockNotificationService;

	ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		storageService = disposables.add(new InMemoryStorageService());
		mockRegistry = new MockRegistryService();
		mockSettings = new MockVoidSettingsService();
		mockNotifications = new MockNotificationService();
	});

	teardown(() => {
		disposables.clear();
		mockRegistry.dispose();
	});

	function createService(): DeploymentAutoConfigService {
		const service = new DeploymentAutoConfigService(
			mockRegistry as any,
			mockSettings as any,
			mockNotifications as any,
			storageService,
		);
		disposables.add(service);
		return service;
	}

	test('auto-configures local deployment with models when provider is unconfigured', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3.3:70b', 'codestral:22b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		assert.strictEqual(mockSettings.autodetectCalls.length, 1);
		assert.strictEqual(mockSettings.autodetectCalls[0].provider, 'ollama');
		assert.deepStrictEqual(mockSettings.autodetectCalls[0].models, ['llama3.3:70b', 'codestral:22b']);
	});

	test('does NOT auto-configure when provider already has custom endpoint', () => {
		mockSettings.state.settingsOfProvider.ollama.endpoint = 'http://custom-server:11434';
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3.3:70b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		assert.strictEqual(mockSettings.autodetectCalls.length, 0);
	});

	test('does NOT auto-configure when provider has apiKey set', () => {
		mockSettings.state.settingsOfProvider.vLLM.apiKey = 'sk-existing-key';
		const service = createService();

		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'cloud-1',
			cloudProvider: 'aws',
			voidProvider: 'vLLM',
			modelId: 'model',
			modelName: 'Model',
			endpoint: 'http://1.2.3.4:8000/v1',
			apiKey: 'ni-new-key',
			status: 'running',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
			costPerHour: 1.0,
		};

		mockRegistry.fireReady(cloud);

		assert.strictEqual(mockSettings.setSettingCalls.length, 0);
	});

	test('does NOT auto-configure when _didFillInProviderSettings is true', () => {
		mockSettings.state.settingsOfProvider.ollama._didFillInProviderSettings = true;
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3.3:70b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		assert.strictEqual(mockSettings.autodetectCalls.length, 0);
	});

	test('does NOT auto-configure local deployment with empty models array', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: [],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		assert.strictEqual(mockSettings.autodetectCalls.length, 0);
	});

	test('auto-configures cloud deployment with endpoint + apiKey + model', () => {
		const service = createService();

		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'cloud-1',
			cloudProvider: 'aws',
			voidProvider: 'vLLM',
			modelId: 'meta/llama-70b',
			modelName: 'Llama 70B',
			endpoint: 'http://54.1.2.3:8000/v1',
			apiKey: 'ni-generated-key-1234',
			status: 'running',
			config: { provider: 'aws', instanceType: 'g5.12xlarge', region: 'us-east-1', gpuType: 'A10G x4', gpuMemoryGB: 96, estimatedCostPerHour: 5.672 },
			createdAt: Date.now(),
			costPerHour: 5.672,
		};

		mockRegistry.fireReady(cloud);

		const endpointCall = mockSettings.setSettingCalls.find(c => c.key === 'endpoint');
		const apiKeyCall = mockSettings.setSettingCalls.find(c => c.key === 'apiKey');
		assert.ok(endpointCall);
		assert.strictEqual(endpointCall!.value, 'http://54.1.2.3:8000/v1');
		assert.ok(apiKeyCall);
		assert.strictEqual(apiKeyCall!.value, 'ni-generated-key-1234');
		assert.strictEqual(mockSettings.autodetectCalls.length, 1);
		assert.deepStrictEqual(mockSettings.autodetectCalls[0].models, ['Llama 70B']);
	});

	test('shows notification when auto-configuring cloud deployment', () => {
		const service = createService();

		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'cloud-notify',
			cloudProvider: 'aws',
			voidProvider: 'vLLM',
			modelId: 'model',
			modelName: 'TestModel',
			endpoint: 'http://1:8000/v1',
			apiKey: 'ni-key',
			status: 'running',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
			costPerHour: 1.0,
		};

		mockRegistry.fireReady(cloud);

		assert.strictEqual(mockNotifications.promptCalls.length, 1);
		assert.strictEqual(mockNotifications.promptCalls[0].severity, Severity.Info);
		assert.ok(mockNotifications.promptCalls[0].message.includes('TestModel'));
	});

	test('shows info notification when auto-configuring local deployment', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['model1', 'model2', 'model3'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		assert.strictEqual(mockNotifications.infoCalls.length, 1);
		assert.ok(mockNotifications.infoCalls[0].includes('3 model(s)'));
	});

	test('records applied rules', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3:8b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		const rules = service.getAppliedRules();
		assert.ok(rules.length > 0);
		assert.strictEqual(rules[0].deploymentId, 'local-ollama');
		assert.strictEqual(rules[0].provider, 'ollama');
	});

	test('revertRule removes the rule from applied rules', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3:8b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);
		assert.ok(service.getAppliedRules().length > 0);

		service.revertRule('local-ollama');
		assert.strictEqual(service.getAppliedRules().length, 0);
	});

	test('persists dismissed providers across construction', () => {
		// Simulate a dismissed state stored previously
		storageService.store(
			'neuralInverse.deployment.autoConfigDismissed',
			JSON.stringify(['ollama']),
			StorageScope.PROFILE,
			StorageTarget.USER
		);

		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3:8b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		// Should NOT auto-configure because ollama was dismissed
		assert.strictEqual(mockSettings.autodetectCalls.length, 0);
	});

	test('persists applied rules to storage', () => {
		const service = createService();

		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'running',
			models: ['llama3:8b'],
			lastChecked: Date.now(),
		};

		mockRegistry.fireReady(local);

		const raw = storageService.get('neuralInverse.deployment.autoConfigRules', StorageScope.PROFILE);
		assert.ok(raw);
		const parsed = JSON.parse(raw!);
		assert.ok(Array.isArray(parsed));
		assert.ok(parsed.length > 0);
	});

	test('handles corrupted rules storage gracefully', () => {
		storageService.store(
			'neuralInverse.deployment.autoConfigRules',
			'invalid json {{{{',
			StorageScope.PROFILE,
			StorageTarget.USER
		);

		// Should not throw
		const service = createService();
		assert.deepStrictEqual(service.getAppliedRules(), []);
	});
});
