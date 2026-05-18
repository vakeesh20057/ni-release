/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProviderName } from '../../../../void/common/voidSettingsTypes.js';
import { CloudProvider, CloudDeploymentStatus, ICloudInstanceConfig } from '../../../common/modelManagement/cloudTypes.js';

export type DeploymentKind = 'local' | 'cloud';

export type LocalDeploymentStatus = 'running' | 'stopped' | 'unreachable' | 'unknown';

export type UnifiedDeploymentStatus =
	| LocalDeploymentStatus
	| CloudDeploymentStatus;

export interface IDeploymentEndpoint {
	url: string;
	apiKey?: string;
	provider: ProviderName;
	modelName?: string;
}

export interface ILocalDeployment {
	kind: 'local';
	id: string;
	provider: ProviderName;
	displayName: string;
	endpoint: string;
	status: LocalDeploymentStatus;
	models: string[];
	lastChecked: number;
}

export interface ICloudDeploymentEntry {
	kind: 'cloud';
	id: string;
	cloudProvider: CloudProvider;
	voidProvider: ProviderName;
	modelId: string;
	modelName: string;
	endpoint?: string;
	apiKey?: string;
	status: CloudDeploymentStatus;
	config: ICloudInstanceConfig;
	createdAt: number;
	costPerHour: number;
}

export type IUnifiedDeployment = ILocalDeployment | ICloudDeploymentEntry;

export interface IDeploymentRegistryState {
	deployments: IUnifiedDeployment[];
	lastRefreshed: number;
}

export interface IAutoConfigRule {
	deploymentId: string;
	provider: ProviderName;
	settingKey: string;
	value: string;
	appliedAt: number;
}

export function isLocalDeployment(d: IUnifiedDeployment): d is ILocalDeployment {
	return d.kind === 'local';
}

export function isCloudDeployment(d: IUnifiedDeployment): d is ICloudDeploymentEntry {
	return d.kind === 'cloud';
}

export function isDeploymentActive(d: IUnifiedDeployment): boolean {
	if (d.kind === 'local') {
		return d.status === 'running';
	}
	return d.status === 'running' || d.status === 'deploying-vllm' || d.status === 'loading-model' || d.status === 'provisioning';
}

export function getDeploymentEndpoint(d: IUnifiedDeployment): IDeploymentEndpoint | null {
	if (d.kind === 'local') {
		if (d.status !== 'running') { return null; }
		return {
			url: d.endpoint,
			provider: d.provider,
			modelName: d.models[0],
		};
	}
	if (d.status !== 'running' || !d.endpoint) { return null; }
	return {
		url: d.endpoint,
		apiKey: d.apiKey,
		provider: d.voidProvider,
		modelName: d.modelName,
	};
}
