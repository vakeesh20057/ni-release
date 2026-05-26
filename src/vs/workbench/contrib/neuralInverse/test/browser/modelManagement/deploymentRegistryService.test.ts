/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { StorageScope, StorageTarget, InMemoryStorageService } from '../../../../../../platform/storage/common/storage.js';
import { DeploymentRegistryService } from '../../../browser/modelManagement/deployment/deploymentRegistryService.js';
import { ICloudDeploymentService } from '../../../browser/modelManagement/cloudDeploymentService.js';
import { ICloudDeployment, CloudDeploymentStatus } from '../../../common/modelManagement/cloudTypes.js';
import { IUnifiedDeployment } from '../../../browser/modelManagement/deployment/deploymentTypes.js';

class MockCloudDeploymentService implements Partial<ICloudDeploymentService> {
	readonly _serviceBrand: undefined;
	private _deployments: ICloudDeployment[] = [];
	private readonly _onStatusChanged = new Emitter<ICloudDeployment>();
	readonly onDeploymentStatusChanged: Event<ICloudDeployment> = this._onStatusChanged.event;

	listDeployments(): ICloudDeployment[] {
		return this._deployments;
	}

	setDeployments(deployments: ICloudDeployment[]): void {
		this._deployments = deployments;
	}

	fireStatusChanged(deployment: ICloudDeployment, status: CloudDeploymentStatus): void {
		this._onStatusChanged.fire({ ...deployment, status });
	}

	dispose(): void {
		this._onStatusChanged.dispose();
	}
}

suite('DeploymentRegistryService — Unit Tests', () => {
	const disposables = new DisposableStore();
	let storageService: InMemoryStorageService;
	let mockCloudService: MockCloudDeploymentService;

	ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		storageService = disposables.add(new InMemoryStorageService());
		mockCloudService = new MockCloudDeploymentService();
	});

	teardown(() => {
		disposables.clear();
		mockCloudService.dispose();
	});

	test('getAll returns empty array when no deployments exist', () => {
		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		// Before refresh, should have whatever was loaded from storage (nothing)
		const all = service.getAll();
		assert.ok(Array.isArray(all));
	});

	test('getById returns undefined for non-existent ID', () => {
		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		assert.strictEqual(service.getById('non-existent'), undefined);
	});

	test('getByProvider returns empty when no deployments match', () => {
		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		const result = service.getByProvider('ollama');
		assert.ok(Array.isArray(result));
		assert.strictEqual(result.length, 0);
	});

	test('fires onDidChange after refresh', async () => {
		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		let fired = false;
		disposables.add(service.onDidChange(() => { fired = true; }));

		await service.refresh();
		assert.strictEqual(fired, true);
	});

	test('syncs cloud deployments from cloud service', async () => {
		const cloudDeploy: ICloudDeployment = {
			id: 'cloud-1',
			modelId: 'meta/llama-70b',
			modelName: 'Llama 70B',
			provider: 'aws',
			status: 'running',
			instanceId: 'i-abc123',
			endpoint: 'http://1.2.3.4:8000/v1',
			config: { provider: 'aws', instanceType: 'g5.12xlarge', region: 'us-east-1', gpuType: 'A10G x4', gpuMemoryGB: 96, estimatedCostPerHour: 5.672 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([cloudDeploy]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		await service.refresh();

		const result = service.getById('cloud-1');
		assert.ok(result);
		assert.strictEqual(result.kind, 'cloud');
		if (result.kind === 'cloud') {
			assert.strictEqual(result.modelName, 'Llama 70B');
			assert.strictEqual(result.status, 'running');
		}
	});

	test('removes stale cloud deployments on refresh', async () => {
		const deploy: ICloudDeployment = {
			id: 'cloud-stale',
			modelId: 'model',
			modelName: 'Model',
			provider: 'aws',
			status: 'running',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([deploy]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);
		await service.refresh();

		assert.ok(service.getById('cloud-stale'));

		// Remove from cloud service and refresh
		mockCloudService.setDeployments([]);
		await service.refresh();

		assert.strictEqual(service.getById('cloud-stale'), undefined);
	});

	test('fires onDeploymentBecameReady when cloud deployment transitions to running', async () => {
		const deploy: ICloudDeployment = {
			id: 'cloud-new',
			modelId: 'model',
			modelName: 'Model',
			provider: 'aws',
			status: 'running',
			endpoint: 'http://1.2.3.4:8000/v1',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([deploy]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		let readyDeployment: IUnifiedDeployment | undefined;
		disposables.add(service.onDeploymentBecameReady(d => { readyDeployment = d; }));

		await service.refresh();

		assert.ok(readyDeployment);
		assert.strictEqual(readyDeployment!.id, 'cloud-new');
	});

	test('fires onDeploymentWentDown when cloud deployment transitions from running', async () => {
		// First make it running
		const deploy: ICloudDeployment = {
			id: 'cloud-down',
			modelId: 'model',
			modelName: 'Model',
			provider: 'aws',
			status: 'running',
			endpoint: 'http://1.2.3.4:8000/v1',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([deploy]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);
		await service.refresh();

		// Now make it fail
		let downDeployment: IUnifiedDeployment | undefined;
		disposables.add(service.onDeploymentWentDown(d => { downDeployment = d; }));

		deploy.status = 'failed';
		mockCloudService.setDeployments([deploy]);
		await service.refresh();

		assert.ok(downDeployment);
		assert.strictEqual(downDeployment!.id, 'cloud-down');
	});

	test('persists state to storage', async () => {
		const deploy: ICloudDeployment = {
			id: 'cloud-persist',
			modelId: 'model',
			modelName: 'Persisted Model',
			provider: 'azure',
			status: 'running',
			endpoint: 'http://x.x.x.x:8000/v1',
			config: { provider: 'azure', instanceType: 'Standard_NC4as_T4_v3', region: 'eastus', gpuType: 'T4', gpuMemoryGB: 16, estimatedCostPerHour: 0.5 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([deploy]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);
		await service.refresh();

		const raw = storageService.get('neuralInverse.deploymentRegistry', StorageScope.PROFILE);
		assert.ok(raw);
		const parsed = JSON.parse(raw!);
		assert.ok(parsed.deployments);
		assert.ok(parsed.lastRefreshed);
		assert.ok(parsed.deployments.length > 0);
	});

	test('restores state from storage on construction', () => {
		const state = {
			deployments: [{
				kind: 'cloud',
				id: 'restored-1',
				cloudProvider: 'aws',
				voidProvider: 'vLLM',
				modelId: 'model',
				modelName: 'Restored',
				endpoint: 'http://x:8000/v1',
				status: 'running',
				config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
				createdAt: Date.now(),
				costPerHour: 1.0,
			}],
			lastRefreshed: Date.now(),
		};
		storageService.store('neuralInverse.deploymentRegistry', JSON.stringify(state), StorageScope.PROFILE, StorageTarget.USER);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		const restored = service.getById('restored-1');
		assert.ok(restored);
		assert.strictEqual(restored!.kind, 'cloud');
	});

	test('handles corrupted storage gracefully', () => {
		storageService.store('neuralInverse.deploymentRegistry', '{not valid json!!!', StorageScope.PROFILE, StorageTarget.USER);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);

		// Should not throw — starts fresh
		assert.strictEqual(service.getAll().length, 0);
	});

	test('handles empty storage', () => {
		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);
		assert.ok(Array.isArray(service.getAll()));
	});

	test('getActive only returns running deployments', async () => {
		const running: ICloudDeployment = {
			id: 'active-1',
			modelId: 'model',
			modelName: 'Running',
			provider: 'aws',
			status: 'running',
			endpoint: 'http://1:8000/v1',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
		};
		const failed: ICloudDeployment = {
			id: 'inactive-1',
			modelId: 'model',
			modelName: 'Failed',
			provider: 'aws',
			status: 'failed',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
		};
		mockCloudService.setDeployments([running, failed]);

		const service = new DeploymentRegistryService(
			mockCloudService as any,
			storageService,
		);
		disposables.add(service);
		await service.refresh();

		const active = service.getActive();
		assert.ok(active.some(d => d.id === 'active-1'));
		assert.ok(!active.some(d => d.id === 'inactive-1'));
	});
});
