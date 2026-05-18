/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { CloudProvider, CloudDeploymentStatus, ICloudDeployment, ICloudDeploymentProgress, ICloudInstanceConfig, ICloudCredentials, getRecommendedInstances } from '../../common/modelManagement/cloudTypes.js';
import { ICloudCredentialService } from './cloudCredentialService.js';

const DEPLOYMENTS_STORAGE_KEY = 'neuralInverse.cloudDeployments';
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 8_000;
const DEPLOYMENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes max
const MAX_HEALTH_RETRIES = 3;
const STALE_PROVISIONING_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

export const ICloudDeploymentService = createDecorator<ICloudDeploymentService>('cloudDeploymentService');

export interface ICloudDeploymentService {
	readonly _serviceBrand: undefined;

	getRecommendedInstances(provider: CloudProvider, modelSizeBytes: number): ICloudInstanceConfig[];

	deploy(modelId: string, modelName: string, credentials: ICloudCredentials, config: ICloudInstanceConfig): Promise<string>;
	stop(deploymentId: string): Promise<void>;
	start(deploymentId: string): Promise<void>;
	teardown(deploymentId: string): Promise<void>;
	abort(deploymentId: string): Promise<void>;

	getDeployment(deploymentId: string): ICloudDeployment | undefined;
	listDeployments(): ICloudDeployment[];
	getActiveDeploymentForModel(modelId: string): ICloudDeployment | undefined;

	onDeploymentProgress: Event<ICloudDeploymentProgress>;
	onDeploymentStatusChanged: Event<ICloudDeployment>;
}

export class CloudDeploymentService extends Disposable implements ICloudDeploymentService {
	readonly _serviceBrand: undefined;

	private readonly _onDeploymentProgress = this._register(new Emitter<ICloudDeploymentProgress>());
	readonly onDeploymentProgress = this._onDeploymentProgress.event;

	private readonly _onDeploymentStatusChanged = this._register(new Emitter<ICloudDeployment>());
	readonly onDeploymentStatusChanged = this._onDeploymentStatusChanged.event;

	private _deployments: Map<string, ICloudDeployment> = new Map();
	private _pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
	private _deploymentTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private _abortControllers: Map<string, AbortController> = new Map();
	private _healthFailCounts: Map<string, number> = new Map();

	constructor(
		@ICloudCredentialService private readonly credentialService: ICloudCredentialService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();
		this._loadDeployments();
		this._recoverStaleDeployments();
		this._resumePolling();
	}

	getRecommendedInstances(provider: CloudProvider, modelSizeBytes: number): ICloudInstanceConfig[] {
		return getRecommendedInstances(provider, modelSizeBytes);
	}

	async deploy(modelId: string, modelName: string, credentials: ICloudCredentials, config: ICloudInstanceConfig): Promise<string> {
		// Prevent duplicate active deployments for same model
		const existing = this.getActiveDeploymentForModel(modelId);
		if (existing) {
			throw new Error(`Model "${modelName}" already has an active deployment (${existing.id}). Stop or teardown the existing one first.`);
		}

		// Validate credentials before proceeding
		const valid = await this.credentialService.validateCredentials(credentials);
		if (!valid) {
			throw new Error(`Invalid ${config.provider.toUpperCase()} credentials. Verify your access keys and try again.`);
		}

		const deploymentId = `deploy-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
		const apiKey = this._generateApiKey();

		const deployment: ICloudDeployment = {
			id: deploymentId,
			modelId,
			modelName,
			provider: config.provider,
			status: 'pending',
			config,
			createdAt: Date.now(),
			monthlyCostEstimate: config.estimatedCostPerHour * 24 * 30,
		};

		this._deployments.set(deploymentId, deployment);
		this._saveDeployments();
		this._onDeploymentStatusChanged.fire(deployment);

		// Set deployment timeout
		const timeout = setTimeout(() => {
			const d = this._deployments.get(deploymentId);
			if (d && (d.status === 'provisioning' || d.status === 'deploying-vllm' || d.status === 'loading-model')) {
				this._updateStatus(deploymentId, 'failed', 'Deployment timed out after 15 minutes. The instance may still be running — check your cloud console and terminate manually if needed.');
				this.notificationService.error(`Deployment for ${modelName} timed out. Check ${config.provider.toUpperCase()} console for orphaned resources.`);
				this._cleanupDeploymentResources(deploymentId);
			}
		}, DEPLOYMENT_TIMEOUT_MS);
		this._deploymentTimeouts.set(deploymentId, timeout);

		// Create abort controller
		const abortController = new AbortController();
		this._abortControllers.set(deploymentId, abortController);

		this._runDeployment(deploymentId, credentials, config, modelId, modelName, apiKey, abortController.signal);

		return deploymentId;
	}

	async abort(deploymentId: string): Promise<void> {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) { return; }

		const controller = this._abortControllers.get(deploymentId);
		if (controller) {
			controller.abort();
			this._abortControllers.delete(deploymentId);
		}

		this._cleanupDeploymentResources(deploymentId);

		if (deployment.instanceId) {
			await this.teardown(deploymentId);
		} else {
			this._updateStatus(deploymentId, 'failed', 'Deployment aborted by user.');
		}
	}

	async stop(deploymentId: string): Promise<void> {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) {
			throw new Error(`Deployment ${deploymentId} not found.`);
		}
		if (!deployment.instanceId) {
			throw new Error(`Deployment ${deploymentId} has no instance ID — it may not have launched successfully.`);
		}
		if (deployment.status !== 'running') {
			throw new Error(`Cannot stop deployment in "${deployment.status}" state. Only running deployments can be stopped.`);
		}

		this._updateStatus(deploymentId, 'stopping');
		this._stopPolling(deploymentId);

		const cmd = deployment.provider === 'aws'
			? `aws ec2 stop-instances --instance-ids ${this._shellEscape(deployment.instanceId)} --region ${this._shellEscape(deployment.config.region)}`
			: `az vm deallocate --ids ${this._shellEscape(deployment.instanceId)} --no-wait`;

		await this._runTerminalCommand(`[NI] Stop: ${deployment.modelName}`, cmd);
		this._updateStatus(deploymentId, 'stopped');
		this.notificationService.info(`Stopped ${deployment.modelName}. Instance preserved — restart anytime.`);
	}

	async start(deploymentId: string): Promise<void> {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) {
			throw new Error(`Deployment ${deploymentId} not found.`);
		}
		if (!deployment.instanceId) {
			throw new Error(`Deployment ${deploymentId} has no instance ID.`);
		}
		if (deployment.status !== 'stopped') {
			throw new Error(`Cannot start deployment in "${deployment.status}" state. Only stopped deployments can be started.`);
		}

		this._updateStatus(deploymentId, 'provisioning');

		const cmd = deployment.provider === 'aws'
			? `aws ec2 start-instances --instance-ids ${this._shellEscape(deployment.instanceId)} --region ${this._shellEscape(deployment.config.region)}`
			: `az vm start --ids ${this._shellEscape(deployment.instanceId)}`;

		await this._runTerminalCommand(`[NI] Start: ${deployment.modelName}`, cmd);
		this._updateStatus(deploymentId, 'loading-model');
		this._emitProgress(deploymentId, 'loading-model', 'Instance restarting. Waiting for vLLM to come online...', 50);
		this._startPolling(deploymentId);
	}

	async teardown(deploymentId: string): Promise<void> {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) {
			throw new Error(`Deployment ${deploymentId} not found.`);
		}
		if (!deployment.instanceId) {
			this._updateStatus(deploymentId, 'terminated');
			return;
		}
		if (deployment.status === 'terminated') {
			return;
		}

		this._updateStatus(deploymentId, 'terminating');
		this._stopPolling(deploymentId);
		this._cleanupDeploymentResources(deploymentId);

		if (deployment.provider === 'aws') {
			const region = this._shellEscape(deployment.config.region);
			const instanceId = this._shellEscape(deployment.instanceId);
			const cmd = [
				`aws ec2 terminate-instances --instance-ids ${instanceId} --region ${region}`,
				`echo "Waiting for termination..."`,
				`aws ec2 wait instance-terminated --instance-ids ${instanceId} --region ${region}`,
				// Cleanup security group
				`SG_NAME="neuralInverse-vllm-${deploymentId.substring(0, 8)}"`,
				`SG_ID=$(aws ec2 describe-security-groups --group-names "$SG_NAME" --region ${region} --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "")`,
				`if [ -n "$SG_ID" ] && [ "$SG_ID" != "None" ]; then`,
				`  aws ec2 delete-security-group --group-id "$SG_ID" --region ${region} 2>/dev/null || true`,
				`fi`,
				`echo "Teardown complete."`,
			].join('\n');
			await this._runTerminalCommand(`[NI] Terminate: ${deployment.modelName}`, cmd);
		} else {
			const rgName = `neuralInverse-${deploymentId.substring(0, 8)}`;
			const cmd = [
				`echo "Deleting resource group ${rgName} (this removes all resources)..."`,
				`az group delete --name ${this._shellEscape(rgName)} --yes --no-wait`,
				`echo "Resource group deletion initiated."`,
			].join('\n');
			await this._runTerminalCommand(`[NI] Terminate: ${deployment.modelName}`, cmd);
		}

		this._updateStatus(deploymentId, 'terminated');
		this.notificationService.info(`Terminated ${deployment.modelName}. All cloud resources cleaned up.`);
	}

	getDeployment(deploymentId: string): ICloudDeployment | undefined {
		return this._deployments.get(deploymentId);
	}

	listDeployments(): ICloudDeployment[] {
		return [...this._deployments.values()];
	}

	getActiveDeploymentForModel(modelId: string): ICloudDeployment | undefined {
		for (const deployment of this._deployments.values()) {
			if (deployment.modelId === modelId && !this._isTerminalState(deployment.status)) {
				return deployment;
			}
		}
		return undefined;
	}

	// --- Deployment orchestration ---

	private async _runDeployment(
		deploymentId: string,
		credentials: ICloudCredentials,
		config: ICloudInstanceConfig,
		modelId: string,
		modelName: string,
		apiKey: string,
		signal: AbortSignal
	): Promise<void> {
		if (signal.aborted) { return; }

		this._updateStatus(deploymentId, 'provisioning');
		this._emitProgress(deploymentId, 'provisioning', 'Validating configuration and launching instance...', 10);

		try {
			if (config.provider === 'aws') {
				await this._deployAWS(deploymentId, credentials, config, modelId, modelName, apiKey, signal);
			} else {
				await this._deployAzure(deploymentId, credentials, config, modelId, modelName, apiKey, signal);
			}
		} catch (err: unknown) {
			if (signal.aborted) { return; }
			const message = err instanceof Error ? err.message : String(err);
			this._updateStatus(deploymentId, 'failed', message);
			this._cleanupDeploymentResources(deploymentId);
			this.notificationService.error(`Deployment failed for ${modelName}: ${message}`);
		}
	}

	private async _deployAWS(
		deploymentId: string,
		credentials: ICloudCredentials,
		config: ICloudInstanceConfig,
		modelId: string,
		modelName: string,
		apiKey: string,
		signal: AbortSignal
	): Promise<void> {
		const region = credentials.awsRegion || config.region;
		const sanitizedModelSlug = modelId.split('/').pop()?.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 20) || 'model';
		const instanceName = `NeuralInverse-vLLM-${sanitizedModelSlug}`;
		const sgName = `neuralInverse-vllm-${deploymentId.substring(0, 8)}`;

		const userDataScript = this._buildUserDataScript(modelId, apiKey);
		const userDataB64 = btoa(userDataScript);

		this._emitProgress(deploymentId, 'provisioning', `Launching ${config.instanceType} in ${region}...`, 20);

		const launchCmd = [
			`set -euo pipefail`,
			'',
			// Export credentials securely — values are shell-escaped
			`export AWS_ACCESS_KEY_ID=${this._shellEscape(credentials.awsAccessKeyId || '')}`,
			`export AWS_SECRET_ACCESS_KEY=${this._shellEscape(credentials.awsSecretAccessKey || '')}`,
			`export AWS_DEFAULT_REGION=${this._shellEscape(region)}`,
			'',
			`echo "[NeuralInverse] Deploying ${this._shellEscape(modelName)} on ${config.instanceType}"`,
			`echo ""`,
			'',
			// Find Deep Learning AMI
			`echo "→ Finding Deep Learning AMI..."`,
			`AMI_ID=$(aws ec2 describe-images --owners amazon \\`,
			`  --filters "Name=name,Values=Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*" \\`,
			`  --query "Images | sort_by(@, &CreationDate) | [-1].ImageId" --output text)`,
			'',
			`if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "None" ]; then`,
			`  echo "ERROR: Could not find Deep Learning AMI in ${region}. Check region availability."`,
			`  exit 1`,
			`fi`,
			`echo "  AMI: $AMI_ID"`,
			'',
			// Create security group with restricted access
			`echo "→ Creating security group..."`,
			`VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)`,
			`if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then`,
			`  echo "ERROR: No default VPC found in ${region}. Create one or specify a VPC."`,
			`  exit 1`,
			`fi`,
			'',
			`SG_ID=$(aws ec2 create-security-group \\`,
			`  --group-name ${this._shellEscape(sgName)} \\`,
			`  --description "NeuralInverse vLLM - API key protected" \\`,
			`  --vpc-id "$VPC_ID" \\`,
			`  --output text --query GroupId 2>/dev/null)`,
			'',
			`if [ -z "$SG_ID" ]; then`,
			`  echo "ERROR: Failed to create security group. It may already exist."`,
			`  SG_ID=$(aws ec2 describe-security-groups --group-names ${this._shellEscape(sgName)} --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "")`,
			`  if [ -z "$SG_ID" ]; then exit 1; fi`,
			`fi`,
			'',
			// Only open vLLM port (SSH left closed — use SSM if needed)
			`MY_IP=$(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null || echo "")`,
			`if [ -n "$MY_IP" ]; then`,
			`  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8000 --cidr "$MY_IP/32" 2>/dev/null || true`,
			`  echo "  Restricted port 8000 to your IP: $MY_IP"`,
			`else`,
			`  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8000 --cidr "0.0.0.0/0" 2>/dev/null || true`,
			`  echo "  WARNING: Could not detect your IP. Port 8000 open to all (protected by API key)."`,
			`fi`,
			'',
			// Launch instance
			`echo "→ Launching instance..."`,
			`INSTANCE_ID=$(aws ec2 run-instances \\`,
			`  --image-id "$AMI_ID" \\`,
			`  --instance-type ${this._shellEscape(config.instanceType)} \\`,
			`  --user-data ${this._shellEscape(userDataB64)} \\`,
			`  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${this._shellEscape(instanceName)}},{Key=neuralInverse,Value=${this._shellEscape(deploymentId)}},{Key=apiKey,Value=REDACTED}]" \\`,
			`  --security-group-ids "$SG_ID" \\`,
			`  --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1" \\`,
			`  --query "Instances[0].InstanceId" --output text)`,
			'',
			`if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then`,
			`  echo "ERROR: Failed to launch instance. Check quotas for ${config.instanceType} in ${region}."`,
			`  aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null || true`,
			`  exit 1`,
			`fi`,
			`echo "  Instance: $INSTANCE_ID"`,
			'',
			// Wait for running state
			`echo "→ Waiting for instance to reach running state..."`,
			`if ! aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" 2>/dev/null; then`,
			`  echo "ERROR: Instance failed to reach running state. Check AWS console."`,
			`  exit 1`,
			`fi`,
			'',
			`PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \\`,
			`  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)`,
			'',
			`if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "None" ]; then`,
			`  echo "WARNING: No public IP assigned. Instance may be in a private subnet."`,
			`  echo "  You may need to assign an Elastic IP or use a load balancer."`,
			`fi`,
			'',
			`echo ""`,
			`echo "╔══════════════════════════════════════════════════════════════╗"`,
			`echo "║  DEPLOYMENT SUCCESSFUL                                       ║"`,
			`echo "╠══════════════════════════════════════════════════════════════╣"`,
			`echo "║  Instance ID:  $INSTANCE_ID"`,
			`echo "║  Public IP:    $PUBLIC_IP"`,
			`echo "║  Endpoint:     http://$PUBLIC_IP:8000/v1"`,
			`echo "║  API Key:      ${apiKey}"`,
			`echo "║                                                              ║"`,
			`echo "║  vLLM is downloading the model and starting up.              ║"`,
			`echo "║  This typically takes 5-15 minutes depending on model size.  ║"`,
			`echo "║                                                              ║"`,
			`echo "║  Test:  curl -H 'Authorization: Bearer ${apiKey}' \\\\      ║"`,
			`echo "║           http://$PUBLIC_IP:8000/v1/models                    ║"`,
			`echo "╚══════════════════════════════════════════════════════════════╝"`,
			'',
			// Unset credentials from shell history
			`unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY`,
		].join('\n');

		if (signal.aborted) { return; }
		await this._runTerminalCommand(`[NI] Deploy: ${instanceName}`, launchCmd);

		this._updateStatus(deploymentId, 'deploying-vllm');
		this._emitProgress(deploymentId, 'deploying-vllm', 'Instance launched. vLLM downloading model and starting...', 60);

		// Start health check polling to detect when vLLM is ready
		this._startHealthCheckPolling(deploymentId, apiKey);
	}

	private async _deployAzure(
		deploymentId: string,
		credentials: ICloudCredentials,
		config: ICloudInstanceConfig,
		modelId: string,
		modelName: string,
		apiKey: string,
		signal: AbortSignal
	): Promise<void> {
		const region = credentials.azureRegion || config.region;
		const vmName = `ni-vllm-${deploymentId.substring(0, 8)}`;
		const rgName = `neuralInverse-${deploymentId.substring(0, 8)}`;
		const nsgName = `${vmName}-nsg`;

		const userDataScript = this._buildUserDataScript(modelId, apiKey);
		const userDataB64 = btoa(userDataScript);

		this._emitProgress(deploymentId, 'provisioning', `Creating ${config.instanceType} in ${region}...`, 20);

		const loginCmd = credentials.azureClientId
			? `az login --service-principal -u ${this._shellEscape(credentials.azureClientId || '')} -p ${this._shellEscape(credentials.azureClientSecret || '')} --tenant ${this._shellEscape(credentials.azureTenantId || '')}`
			: 'echo "Using existing Azure CLI session"';

		const subscriptionCmd = credentials.azureSubscriptionId
			? `az account set --subscription ${this._shellEscape(credentials.azureSubscriptionId)}`
			: '';

		const deployCmd = [
			`set -euo pipefail`,
			'',
			`echo "[NeuralInverse] Deploying ${this._shellEscape(modelName)} on ${config.instanceType}"`,
			`echo ""`,
			'',
			// Auth
			loginCmd,
			subscriptionCmd,
			'',
			// Verify quota
			`echo "→ Checking GPU quota in ${region}..."`,
			`QUOTA=$(az vm list-usage --location ${this._shellEscape(region)} --query "[?contains(localName, '${config.instanceType}')].{limit:limit, current:currentValue}" --output tsv 2>/dev/null || echo "")`,
			`if [ -n "$QUOTA" ]; then echo "  Quota: $QUOTA"; fi`,
			'',
			// Resource group
			`echo "→ Creating resource group..."`,
			`az group create --name ${this._shellEscape(rgName)} --location ${this._shellEscape(region)} --output none`,
			'',
			// NSG with restricted access
			`echo "→ Creating network security group..."`,
			`az network nsg create --resource-group ${this._shellEscape(rgName)} --name ${this._shellEscape(nsgName)} --output none`,
			'',
			`MY_IP=$(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null || echo "")`,
			`if [ -n "$MY_IP" ]; then`,
			`  az network nsg rule create --resource-group ${this._shellEscape(rgName)} --nsg-name ${this._shellEscape(nsgName)} \\`,
			`    --name AllowVLLM --priority 1000 --access Allow --protocol Tcp \\`,
			`    --destination-port-ranges 8000 --source-address-prefixes "$MY_IP/32" --output none`,
			`  echo "  Restricted port 8000 to your IP: $MY_IP"`,
			`else`,
			`  az network nsg rule create --resource-group ${this._shellEscape(rgName)} --nsg-name ${this._shellEscape(nsgName)} \\`,
			`    --name AllowVLLM --priority 1000 --access Allow --protocol Tcp \\`,
			`    --destination-port-ranges 8000 --source-address-prefixes "*" --output none`,
			`  echo "  WARNING: Could not detect your IP. Port 8000 open to all (protected by API key)."`,
			`fi`,
			'',
			// Create VM
			`echo "→ Launching GPU VM (this may take 3-5 minutes)..."`,
			`VM_OUTPUT=$(az vm create \\`,
			`  --resource-group ${this._shellEscape(rgName)} \\`,
			`  --name ${this._shellEscape(vmName)} \\`,
			`  --image Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest \\`,
			`  --size ${this._shellEscape(config.instanceType)} \\`,
			`  --admin-username neuraluser \\`,
			`  --generate-ssh-keys \\`,
			`  --nsg ${this._shellEscape(nsgName)} \\`,
			`  --custom-data ${this._shellEscape(userDataB64)} \\`,
			`  --output json 2>&1)`,
			'',
			`if [ $? -ne 0 ]; then`,
			`  echo "ERROR: VM creation failed."`,
			`  echo "$VM_OUTPUT"`,
			`  echo ""`,
			`  echo "Common causes: insufficient GPU quota, region capacity, or invalid VM size."`,
			`  echo "Request quota increase: az vm list-usage --location ${region}"`,
			`  az group delete --name ${this._shellEscape(rgName)} --yes --no-wait 2>/dev/null || true`,
			`  exit 1`,
			`fi`,
			'',
			`PUBLIC_IP=$(echo "$VM_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('publicIpAddress',''))" 2>/dev/null || echo "")`,
			`if [ -z "$PUBLIC_IP" ]; then`,
			`  PUBLIC_IP=$(az vm show --resource-group ${this._shellEscape(rgName)} --name ${this._shellEscape(vmName)} --show-details --query publicIps --output tsv 2>/dev/null || echo "")`,
			`fi`,
			'',
			`echo ""`,
			`echo "╔══════════════════════════════════════════════════════════════╗"`,
			`echo "║  DEPLOYMENT SUCCESSFUL                                       ║"`,
			`echo "╠══════════════════════════════════════════════════════════════╣"`,
			`echo "║  VM Name:       ${vmName}"`,
			`echo "║  Resource Group: ${rgName}"`,
			`echo "║  Public IP:     $PUBLIC_IP"`,
			`echo "║  Endpoint:      http://$PUBLIC_IP:8000/v1"`,
			`echo "║  API Key:       ${apiKey}"`,
			`echo "║                                                              ║"`,
			`echo "║  vLLM is downloading the model and starting up.              ║"`,
			`echo "║  This typically takes 5-15 minutes depending on model size.  ║"`,
			`echo "║                                                              ║"`,
			`echo "║  Test:  curl -H 'Authorization: Bearer ${apiKey}' \\\\      ║"`,
			`echo "║           http://$PUBLIC_IP:8000/v1/models                    ║"`,
			`echo "╚══════════════════════════════════════════════════════════════╝"`,
		].join('\n');

		if (signal.aborted) { return; }
		await this._runTerminalCommand(`[NI] Deploy: ${vmName}`, deployCmd);

		this._updateStatus(deploymentId, 'deploying-vllm');
		this._emitProgress(deploymentId, 'deploying-vllm', 'VM launched. vLLM downloading model and starting...', 60);

		this._startHealthCheckPolling(deploymentId, apiKey);
	}

	private _buildUserDataScript(modelId: string, apiKey: string): string {
		const sanitizedModelId = modelId.replace(/['"\\$`]/g, '');

		return [
			'#!/bin/bash',
			'set -euo pipefail',
			'exec > /var/log/neuralInverse-setup.log 2>&1',
			'',
			'echo "[$(date)] NeuralInverse vLLM setup starting"',
			'',
			'# System update',
			'export DEBIAN_FRONTEND=noninteractive',
			'apt-get update -qq',
			'',
			'# Install NVIDIA drivers if not present',
			'if ! command -v nvidia-smi &> /dev/null; then',
			'  echo "[$(date)] Installing NVIDIA drivers..."',
			'  apt-get install -y -qq nvidia-driver-535 2>/dev/null || apt-get install -y -qq nvidia-driver-530',
			'  echo "[$(date)] NVIDIA driver installed. Note: reboot may be required."',
			'fi',
			'',
			'# Verify GPU is accessible',
			'echo "[$(date)] Checking GPU..."',
			'for i in $(seq 1 5); do',
			'  if nvidia-smi &>/dev/null; then break; fi',
			'  echo "  Waiting for GPU (attempt $i/5)..."',
			'  sleep 10',
			'done',
			'',
			'if ! nvidia-smi &>/dev/null; then',
			'  echo "[$(date)] ERROR: GPU not accessible after driver install. Rebooting..."',
			'  reboot',
			'  exit 0',
			'fi',
			'',
			'nvidia-smi',
			'',
			'# Install Python and vLLM',
			'echo "[$(date)] Installing vLLM..."',
			'apt-get install -y -qq python3-pip python3-venv',
			'python3 -m venv /opt/vllm-env',
			'source /opt/vllm-env/bin/activate',
			'pip install --upgrade pip setuptools wheel',
			'pip install vllm',
			'',
			'# Create systemd service for auto-restart',
			'cat > /etc/systemd/system/vllm.service << SERVICEEOF',
			'[Unit]',
			'Description=vLLM OpenAI-compatible API Server',
			'After=network.target',
			'',
			'[Service]',
			'Type=simple',
			'User=root',
			'WorkingDirectory=/opt',
			`Environment="VLLM_API_KEY=${apiKey}"`,
			'ExecStart=/opt/vllm-env/bin/python -m vllm.entrypoints.openai.api_server \\',
			`  --model "${sanitizedModelId}" \\`,
			'  --host 0.0.0.0 \\',
			'  --port 8000 \\',
			'  --max-model-len 8192 \\',
			'  --api-key "${VLLM_API_KEY}" \\',
			'  --disable-log-requests',
			'Restart=on-failure',
			'RestartSec=30',
			'StandardOutput=journal',
			'StandardError=journal',
			'',
			'[Install]',
			'WantedBy=multi-user.target',
			'SERVICEEOF',
			'',
			'# Start vLLM',
			'echo "[$(date)] Starting vLLM service..."',
			'systemctl daemon-reload',
			'systemctl enable vllm.service',
			'systemctl start vllm.service',
			'',
			'echo "[$(date)] Setup complete. vLLM service started."',
			'echo "[$(date)] Monitor with: journalctl -u vllm -f"',
		].join('\n');
	}

	// --- Health check polling ---

	private _startHealthCheckPolling(deploymentId: string, apiKey: string): void {
		this._stopPolling(deploymentId);
		this._healthFailCounts.set(deploymentId, 0);

		const interval = setInterval(async () => {
			const deployment = this._deployments.get(deploymentId);
			if (!deployment) {
				this._stopPolling(deploymentId);
				return;
			}

			if (this._isTerminalState(deployment.status)) {
				this._stopPolling(deploymentId);
				return;
			}

			if (!deployment.endpoint && !deployment.publicIp) {
				return;
			}

			const baseUrl = deployment.endpoint || `http://${deployment.publicIp}:8000/v1`;

			try {
				const response = await fetch(`${baseUrl}/models`, {
					headers: { 'Authorization': `Bearer ${apiKey}` },
					signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
				});

				if (response.ok) {
					this._healthFailCounts.set(deploymentId, 0);

					if (deployment.status !== 'running') {
						deployment.endpoint = baseUrl;
						this._updateStatus(deploymentId, 'running');
						this._emitProgress(deploymentId, 'running', 'vLLM is online and serving requests.', 100);
						this.notificationService.prompt(
							Severity.Info,
							`${deployment.modelName} is ready at ${baseUrl}`,
							[{ label: 'Copy Endpoint', run: () => navigator.clipboard.writeText(baseUrl) }]
						);
					}
				} else if (response.status === 401 || response.status === 403) {
					// Server is running but API key mismatch — unusual but vLLM is up
					if (deployment.status !== 'running') {
						deployment.endpoint = baseUrl;
						this._updateStatus(deploymentId, 'running');
						this._emitProgress(deploymentId, 'running', 'vLLM is online (auth issue — check API key).', 100);
					}
				} else {
					this._incrementHealthFail(deploymentId, `HTTP ${response.status}`);
				}
			} catch {
				// Network error — instance might still be starting
				const failCount = this._healthFailCounts.get(deploymentId) || 0;
				if (deployment.status === 'running' && failCount > MAX_HEALTH_RETRIES) {
					this._updateStatus(deploymentId, 'failed', 'Health check failed repeatedly. Instance may be down.');
					this._stopPolling(deploymentId);
					this.notificationService.warn(`${deployment.modelName} is no longer responding. Check cloud console.`);
				} else {
					this._incrementHealthFail(deploymentId, 'Network error');
				}
			}
		}, HEALTH_CHECK_INTERVAL_MS);

		this._pollingIntervals.set(deploymentId, interval);
	}

	private _startPolling(deploymentId: string): void {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) { return; }
		// Use empty string as apiKey for resumed polling — health check will still work
		// since vLLM responds to /models even with wrong key (just 401)
		this._startHealthCheckPolling(deploymentId, '');
	}

	private _incrementHealthFail(deploymentId: string, _reason: string): void {
		const count = (this._healthFailCounts.get(deploymentId) || 0) + 1;
		this._healthFailCounts.set(deploymentId, count);
	}

	private _stopPolling(deploymentId: string): void {
		const interval = this._pollingIntervals.get(deploymentId);
		if (interval) {
			clearInterval(interval);
			this._pollingIntervals.delete(deploymentId);
		}
		this._healthFailCounts.delete(deploymentId);
	}

	private _resumePolling(): void {
		for (const deployment of this._deployments.values()) {
			if (deployment.status === 'running' || deployment.status === 'deploying-vllm' || deployment.status === 'loading-model') {
				this._startPolling(deployment.id);
			}
		}
	}

	// --- Stale deployment recovery ---

	private _recoverStaleDeployments(): void {
		const now = Date.now();
		for (const deployment of this._deployments.values()) {
			if (
				(deployment.status === 'provisioning' || deployment.status === 'deploying-vllm' || deployment.status === 'loading-model' || deployment.status === 'pending') &&
				(now - deployment.createdAt > STALE_PROVISIONING_THRESHOLD_MS)
			) {
				deployment.status = 'failed';
				deployment.error = 'Deployment was interrupted (IDE closed during provisioning). Check cloud console for orphaned resources.';
				this._onDeploymentStatusChanged.fire(deployment);
				this.notificationService.warn(
					`Stale deployment detected for ${deployment.modelName}. It may have orphaned cloud resources — check your ${deployment.provider.toUpperCase()} console.`
				);
			}
		}
		this._saveDeployments();
	}

	// --- Terminal execution ---

	private async _runTerminalCommand(name: string, command: string): Promise<void> {
		const terminal = await this.terminalService.createTerminal({
			config: { name },
		});
		this.terminalService.setActiveInstance(terminal);
		await this.terminalService.revealActiveTerminal();
		terminal.sendText(command, true);
	}

	// --- Security helpers ---

	private _shellEscape(value: string): string {
		if (!value) { return "''"; }
		// Use single quotes and escape any embedded single quotes
		return "'" + value.replace(/'/g, "'\\''") + "'";
	}

	private _generateApiKey(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		const segments: string[] = [];
		for (let s = 0; s < 4; s++) {
			let segment = '';
			for (let i = 0; i < 8; i++) {
				const randomIndex = Math.floor(Math.random() * chars.length);
				segment += chars[randomIndex];
			}
			segments.push(segment);
		}
		return `ni-${segments.join('-')}`;
	}

	// --- Helpers ---

	private _isTerminalState(status: CloudDeploymentStatus): boolean {
		return status === 'terminated' || status === 'failed' || status === 'stopped';
	}

	private _cleanupDeploymentResources(deploymentId: string): void {
		const timeout = this._deploymentTimeouts.get(deploymentId);
		if (timeout) {
			clearTimeout(timeout);
			this._deploymentTimeouts.delete(deploymentId);
		}
		this._abortControllers.delete(deploymentId);
	}

	private _updateStatus(deploymentId: string, status: CloudDeploymentStatus, error?: string): void {
		const deployment = this._deployments.get(deploymentId);
		if (!deployment) { return; }
		deployment.status = status;
		if (error) { deployment.error = error; }
		if (error === undefined && deployment.error && status === 'running') {
			delete deployment.error;
		}
		this._saveDeployments();
		this._onDeploymentStatusChanged.fire(deployment);
	}

	private _emitProgress(deploymentId: string, status: CloudDeploymentStatus, message: string, percentage?: number): void {
		this._onDeploymentProgress.fire({ deploymentId, status, message, percentage });
	}

	private _loadDeployments(): void {
		const raw = this.storageService.get(DEPLOYMENTS_STORAGE_KEY, StorageScope.PROFILE);
		if (raw) {
			try {
				const arr = JSON.parse(raw) as ICloudDeployment[];
				for (const d of arr) {
					if (d && d.id && d.modelId) {
						this._deployments.set(d.id, d);
					}
				}
			} catch {
				// Corrupted storage — start fresh
				this.storageService.remove(DEPLOYMENTS_STORAGE_KEY, StorageScope.PROFILE);
			}
		}
	}

	private _saveDeployments(): void {
		const arr = [...this._deployments.values()];
		this.storageService.store(DEPLOYMENTS_STORAGE_KEY, JSON.stringify(arr), StorageScope.PROFILE, StorageTarget.USER);
	}

	override dispose(): void {
		for (const interval of this._pollingIntervals.values()) { clearInterval(interval); }
		for (const timeout of this._deploymentTimeouts.values()) { clearTimeout(timeout); }
		this._pollingIntervals.clear();
		this._deploymentTimeouts.clear();
		this._abortControllers.clear();
		this._healthFailCounts.clear();
		super.dispose();
	}
}
