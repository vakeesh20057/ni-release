/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type CloudProvider = 'aws' | 'azure';

export type CloudDeploymentStatus =
	'pending' | 'provisioning' | 'deploying-vllm' | 'loading-model' |
	'running' | 'stopping' | 'stopped' | 'terminating' | 'terminated' | 'failed';

export interface ICloudCredentials {
	provider: CloudProvider;
	valid: boolean;
	source: 'cli' | 'manual';
	// AWS
	awsAccessKeyId?: string;
	awsSecretAccessKey?: string;
	awsRegion?: string;
	// Azure
	azureSubscriptionId?: string;
	azureTenantId?: string;
	azureClientId?: string;
	azureClientSecret?: string;
	azureRegion?: string;
}

export interface ICloudInstanceConfig {
	provider: CloudProvider;
	instanceType: string;
	region: string;
	gpuType: string;
	gpuMemoryGB: number;
	estimatedCostPerHour: number;
}

export interface ICloudDeployment {
	id: string;
	modelId: string;
	modelName: string;
	provider: CloudProvider;
	status: CloudDeploymentStatus;
	instanceId?: string;
	endpoint?: string;
	publicIp?: string;
	apiKeyHash?: string;
	config: ICloudInstanceConfig;
	createdAt: number;
	lastHealthCheck?: number;
	error?: string;
	monthlyCostEstimate?: number;
}

export interface ICloudDeploymentProgress {
	deploymentId: string;
	status: CloudDeploymentStatus;
	message: string;
	percentage?: number;
}

export const AWS_GPU_INSTANCES: ICloudInstanceConfig[] = [
	{ provider: 'aws', instanceType: 'g5.xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.006 },
	{ provider: 'aws', instanceType: 'g5.2xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.212 },
	{ provider: 'aws', instanceType: 'g5.4xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G', gpuMemoryGB: 24, estimatedCostPerHour: 1.624 },
	{ provider: 'aws', instanceType: 'g5.12xlarge', region: 'us-east-1', gpuType: 'NVIDIA A10G x4', gpuMemoryGB: 96, estimatedCostPerHour: 5.672 },
	{ provider: 'aws', instanceType: 'p4d.24xlarge', region: 'us-east-1', gpuType: 'NVIDIA A100 x8', gpuMemoryGB: 640, estimatedCostPerHour: 32.77 },
];

export const AZURE_GPU_INSTANCES: ICloudInstanceConfig[] = [
	{ provider: 'azure', instanceType: 'Standard_NC4as_T4_v3', region: 'eastus', gpuType: 'NVIDIA T4', gpuMemoryGB: 16, estimatedCostPerHour: 0.526 },
	{ provider: 'azure', instanceType: 'Standard_NC8as_T4_v3', region: 'eastus', gpuType: 'NVIDIA T4', gpuMemoryGB: 16, estimatedCostPerHour: 0.752 },
	{ provider: 'azure', instanceType: 'Standard_NC24ads_A100_v4', region: 'eastus', gpuType: 'NVIDIA A100', gpuMemoryGB: 80, estimatedCostPerHour: 3.673 },
	{ provider: 'azure', instanceType: 'Standard_NC48ads_A100_v4', region: 'eastus', gpuType: 'NVIDIA A100 x2', gpuMemoryGB: 160, estimatedCostPerHour: 7.346 },
];

export function getRecommendedInstances(provider: CloudProvider, modelSizeBytes: number): ICloudInstanceConfig[] {
	const modelSizeGB = modelSizeBytes / (1024 * 1024 * 1024);
	const requiredGPUMemory = modelSizeGB * 1.2; // 20% overhead for vLLM

	const instances = provider === 'aws' ? AWS_GPU_INSTANCES : AZURE_GPU_INSTANCES;
	return instances.filter(i => i.gpuMemoryGB >= requiredGPUMemory);
}
