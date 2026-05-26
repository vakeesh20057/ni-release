/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	isLocalDeployment,
	isCloudDeployment,
	isDeploymentActive,
	getDeploymentEndpoint,
	ILocalDeployment,
	ICloudDeploymentEntry,
} from '../../../browser/modelManagement/deployment/deploymentTypes.js';

suite('DeploymentTypes — Type Guards', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const localRunning: ILocalDeployment = {
		kind: 'local',
		id: 'local-ollama',
		provider: 'ollama',
		displayName: 'Ollama',
		endpoint: 'http://localhost:11434',
		status: 'running',
		models: ['llama3.3:70b', 'qwen2.5-coder:7b'],
		lastChecked: Date.now(),
	};

	const localStopped: ILocalDeployment = {
		kind: 'local',
		id: 'local-vllm',
		provider: 'vLLM',
		displayName: 'vLLM',
		endpoint: 'http://localhost:8000/v1',
		status: 'stopped',
		models: [],
		lastChecked: Date.now(),
	};

	const localUnreachable: ILocalDeployment = {
		kind: 'local',
		id: 'local-lmstudio',
		provider: 'lmStudio',
		displayName: 'LM Studio',
		endpoint: 'http://localhost:1234/v1',
		status: 'unreachable',
		models: [],
		lastChecked: Date.now(),
	};

	const cloudRunning: ICloudDeploymentEntry = {
		kind: 'cloud',
		id: 'deploy-abc123',
		cloudProvider: 'aws',
		voidProvider: 'vLLM',
		modelId: 'meta-llama/Llama-3.3-70B',
		modelName: 'Llama 3.3 70B',
		endpoint: 'http://54.123.45.67:8000/v1',
		apiKey: 'ni-abcd1234-efgh5678-ijkl9012-mnop3456',
		status: 'running',
		config: { provider: 'aws', instanceType: 'g5.12xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G x4', gpuMemoryGB: 96, estimatedCostPerHour: 5.672 },
		createdAt: Date.now() - 3600000,
		costPerHour: 5.672,
	};

	const cloudProvisioning: ICloudDeploymentEntry = {
		kind: 'cloud',
		id: 'deploy-def456',
		cloudProvider: 'azure',
		voidProvider: 'vLLM',
		modelId: 'deepseek-ai/DeepSeek-R1',
		modelName: 'DeepSeek R1',
		status: 'provisioning',
		config: { provider: 'azure', instanceType: 'Standard_NC24ads_A100_v4', region: 'eastus', gpuType: 'NVIDIA A100', gpuMemoryGB: 80, estimatedCostPerHour: 3.673 },
		createdAt: Date.now(),
		costPerHour: 3.673,
	};

	const cloudFailed: ICloudDeploymentEntry = {
		kind: 'cloud',
		id: 'deploy-ghi789',
		cloudProvider: 'aws',
		voidProvider: 'vLLM',
		modelId: 'qwen/Qwen2.5-Coder-32B',
		modelName: 'Qwen2.5-Coder 32B',
		status: 'failed',
		config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.006 },
		createdAt: Date.now() - 7200000,
		costPerHour: 1.006,
	};

	test('isLocalDeployment correctly identifies local deployments', () => {
		assert.strictEqual(isLocalDeployment(localRunning), true);
		assert.strictEqual(isLocalDeployment(localStopped), true);
		assert.strictEqual(isLocalDeployment(localUnreachable), true);
		assert.strictEqual(isLocalDeployment(cloudRunning), false);
		assert.strictEqual(isLocalDeployment(cloudProvisioning), false);
	});

	test('isCloudDeployment correctly identifies cloud deployments', () => {
		assert.strictEqual(isCloudDeployment(cloudRunning), true);
		assert.strictEqual(isCloudDeployment(cloudProvisioning), true);
		assert.strictEqual(isCloudDeployment(cloudFailed), true);
		assert.strictEqual(isCloudDeployment(localRunning), false);
		assert.strictEqual(isCloudDeployment(localStopped), false);
	});

	test('isDeploymentActive — local running is active', () => {
		assert.strictEqual(isDeploymentActive(localRunning), true);
	});

	test('isDeploymentActive — local stopped/unreachable are not active', () => {
		assert.strictEqual(isDeploymentActive(localStopped), false);
		assert.strictEqual(isDeploymentActive(localUnreachable), false);
	});

	test('isDeploymentActive — cloud running is active', () => {
		assert.strictEqual(isDeploymentActive(cloudRunning), true);
	});

	test('isDeploymentActive — cloud provisioning is active (in progress)', () => {
		assert.strictEqual(isDeploymentActive(cloudProvisioning), true);
	});

	test('isDeploymentActive — cloud deploying-vllm and loading-model are active', () => {
		const deployingVllm: ICloudDeploymentEntry = { ...cloudProvisioning, status: 'deploying-vllm' };
		const loadingModel: ICloudDeploymentEntry = { ...cloudProvisioning, status: 'loading-model' };
		assert.strictEqual(isDeploymentActive(deployingVllm), true);
		assert.strictEqual(isDeploymentActive(loadingModel), true);
	});

	test('isDeploymentActive — cloud failed/stopped/terminated are not active', () => {
		assert.strictEqual(isDeploymentActive(cloudFailed), false);
		const stopped: ICloudDeploymentEntry = { ...cloudFailed, status: 'stopped' };
		const terminated: ICloudDeploymentEntry = { ...cloudFailed, status: 'terminated' };
		assert.strictEqual(isDeploymentActive(stopped), false);
		assert.strictEqual(isDeploymentActive(terminated), false);
	});
});

suite('DeploymentTypes — getDeploymentEndpoint', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns endpoint for running local deployment', () => {
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
		const ep = getDeploymentEndpoint(local);
		assert.ok(ep);
		assert.strictEqual(ep.url, 'http://localhost:11434');
		assert.strictEqual(ep.provider, 'ollama');
		assert.strictEqual(ep.modelName, 'llama3.3:70b');
		assert.strictEqual(ep.apiKey, undefined);
	});

	test('returns null for non-running local deployment', () => {
		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-vllm',
			provider: 'vLLM',
			displayName: 'vLLM',
			endpoint: 'http://localhost:8000/v1',
			status: 'stopped',
			models: [],
			lastChecked: Date.now(),
		};
		assert.strictEqual(getDeploymentEndpoint(local), null);
	});

	test('returns null for unreachable local deployment', () => {
		const local: ILocalDeployment = {
			kind: 'local',
			id: 'local-ollama',
			provider: 'ollama',
			displayName: 'Ollama',
			endpoint: 'http://localhost:11434',
			status: 'unreachable',
			models: [],
			lastChecked: Date.now(),
		};
		assert.strictEqual(getDeploymentEndpoint(local), null);
	});

	test('returns endpoint with apiKey for running cloud deployment', () => {
		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'deploy-xyz',
			cloudProvider: 'aws',
			voidProvider: 'vLLM',
			modelId: 'model-id',
			modelName: 'Model Name',
			endpoint: 'http://1.2.3.4:8000/v1',
			apiKey: 'ni-test-key-1234',
			status: 'running',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
			costPerHour: 1.0,
		};
		const ep = getDeploymentEndpoint(cloud);
		assert.ok(ep);
		assert.strictEqual(ep.url, 'http://1.2.3.4:8000/v1');
		assert.strictEqual(ep.apiKey, 'ni-test-key-1234');
		assert.strictEqual(ep.provider, 'vLLM');
		assert.strictEqual(ep.modelName, 'Model Name');
	});

	test('returns null for cloud deployment without endpoint', () => {
		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'deploy-noep',
			cloudProvider: 'azure',
			voidProvider: 'vLLM',
			modelId: 'model-id',
			modelName: 'Model',
			endpoint: undefined,
			status: 'running',
			config: { provider: 'azure', instanceType: 'Standard_NC4as_T4_v3', region: 'eastus', gpuType: 'T4', gpuMemoryGB: 16, estimatedCostPerHour: 0.5 },
			createdAt: Date.now(),
			costPerHour: 0.5,
		};
		assert.strictEqual(getDeploymentEndpoint(cloud), null);
	});

	test('returns null for non-running cloud deployment', () => {
		const cloud: ICloudDeploymentEntry = {
			kind: 'cloud',
			id: 'deploy-prov',
			cloudProvider: 'aws',
			voidProvider: 'vLLM',
			modelId: 'model-id',
			modelName: 'Model',
			endpoint: 'http://1.2.3.4:8000/v1',
			status: 'provisioning',
			config: { provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.0 },
			createdAt: Date.now(),
			costPerHour: 1.0,
		};
		assert.strictEqual(getDeploymentEndpoint(cloud), null);
	});

	test('local deployment with empty models array returns undefined modelName', () => {
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
		const ep = getDeploymentEndpoint(local);
		assert.ok(ep);
		assert.strictEqual(ep.modelName, undefined);
	});
});
