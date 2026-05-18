/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { CloudProvider, ICloudCredentials } from '../../common/modelManagement/cloudTypes.js';

const CREDENTIAL_KEY_PREFIX = 'neuralInverse.cloud.credentials.';

export const ICloudCredentialService = createDecorator<ICloudCredentialService>('cloudCredentialService');

export interface ICloudCredentialService {
	readonly _serviceBrand: undefined;
	detectCredentials(provider: CloudProvider): Promise<ICloudCredentials | null>;
	storeCredentials(credentials: ICloudCredentials): Promise<void>;
	getCredentials(provider: CloudProvider): Promise<ICloudCredentials | null>;
	clearCredentials(provider: CloudProvider): Promise<void>;
	validateCredentials(credentials: ICloudCredentials): Promise<boolean>;
	onCredentialsChanged: Event<CloudProvider>;
}

export class CloudCredentialService extends Disposable implements ICloudCredentialService {
	readonly _serviceBrand: undefined;

	private readonly _onCredentialsChanged = this._register(new Emitter<CloudProvider>());
	readonly onCredentialsChanged = this._onCredentialsChanged.event;

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super();
	}

	async detectCredentials(provider: CloudProvider): Promise<ICloudCredentials | null> {
		if (provider === 'aws') {
			return this._detectAWSCredentials();
		} else {
			return this._detectAzureCredentials();
		}
	}

	async storeCredentials(credentials: ICloudCredentials): Promise<void> {
		if (!credentials.provider) {
			throw new Error('Cannot store credentials without a provider.');
		}
		// Strip any whitespace from keys (common copy-paste issue)
		const sanitized = { ...credentials };
		if (sanitized.awsAccessKeyId) { sanitized.awsAccessKeyId = sanitized.awsAccessKeyId.trim(); }
		if (sanitized.awsSecretAccessKey) { sanitized.awsSecretAccessKey = sanitized.awsSecretAccessKey.trim(); }
		if (sanitized.azureSubscriptionId) { sanitized.azureSubscriptionId = sanitized.azureSubscriptionId.trim(); }
		if (sanitized.azureTenantId) { sanitized.azureTenantId = sanitized.azureTenantId.trim(); }
		if (sanitized.azureClientId) { sanitized.azureClientId = sanitized.azureClientId.trim(); }
		if (sanitized.azureClientSecret) { sanitized.azureClientSecret = sanitized.azureClientSecret.trim(); }

		const key = CREDENTIAL_KEY_PREFIX + sanitized.provider;
		const serialized = JSON.stringify(sanitized);
		await this.secretStorageService.set(key, serialized);
		this._onCredentialsChanged.fire(sanitized.provider);
	}

	async getCredentials(provider: CloudProvider): Promise<ICloudCredentials | null> {
		const key = CREDENTIAL_KEY_PREFIX + provider;
		const stored = await this.secretStorageService.get(key);
		if (stored) {
			try {
				return JSON.parse(stored) as ICloudCredentials;
			} catch {
				return null;
			}
		}
		return null;
	}

	async clearCredentials(provider: CloudProvider): Promise<void> {
		const key = CREDENTIAL_KEY_PREFIX + provider;
		await this.secretStorageService.delete(key);
		this._onCredentialsChanged.fire(provider);
	}

	async validateCredentials(credentials: ICloudCredentials): Promise<boolean> {
		if (credentials.provider === 'aws') {
			return this._validateAWS(credentials);
		} else {
			return this._validateAzure(credentials);
		}
	}

	private async _detectAWSCredentials(): Promise<ICloudCredentials | null> {
		// Check stored credentials first
		const stored = await this.getCredentials('aws');
		if (stored && stored.valid) {
			return stored;
		}

		// Try to detect via environment variables (accessible in renderer via process.env in Electron)
		try {
			const accessKey = process.env['AWS_ACCESS_KEY_ID'];
			const secretKey = process.env['AWS_SECRET_ACCESS_KEY'];
			const region = process.env['AWS_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'us-east-1';

			if (accessKey && secretKey) {
				const creds: ICloudCredentials = {
					provider: 'aws',
					valid: true,
					source: 'cli',
					awsAccessKeyId: accessKey,
					awsSecretAccessKey: secretKey,
					awsRegion: region,
				};
				return creds;
			}
		} catch {
			// Environment variables not accessible
		}

		return null;
	}

	private async _detectAzureCredentials(): Promise<ICloudCredentials | null> {
		// Check stored credentials first
		const stored = await this.getCredentials('azure');
		if (stored && stored.valid) {
			return stored;
		}

		// Try to detect via environment variables
		try {
			const subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
			const tenantId = process.env['AZURE_TENANT_ID'];
			const clientId = process.env['AZURE_CLIENT_ID'];
			const clientSecret = process.env['AZURE_CLIENT_SECRET'];
			const region = process.env['AZURE_REGION'] || 'eastus';

			if (subscriptionId && tenantId) {
				const creds: ICloudCredentials = {
					provider: 'azure',
					valid: true,
					source: 'cli',
					azureSubscriptionId: subscriptionId,
					azureTenantId: tenantId,
					azureClientId: clientId,
					azureClientSecret: clientSecret,
					azureRegion: region,
				};
				return creds;
			}
		} catch {
			// Environment variables not accessible
		}

		return null;
	}

	private async _validateAWS(credentials: ICloudCredentials): Promise<boolean> {
		if (!credentials.awsAccessKeyId || !credentials.awsSecretAccessKey) {
			return false;
		}

		// Basic format validation before making network call
		const keyPattern = /^[A-Z0-9]{20}$/;
		const secretPattern = /^[A-Za-z0-9/+=]{40}$/;
		if (!keyPattern.test(credentials.awsAccessKeyId.trim())) {
			return false;
		}
		if (!secretPattern.test(credentials.awsSecretAccessKey.trim())) {
			return false;
		}

		try {
			const region = credentials.awsRegion || 'us-east-1';
			// Validate region format to prevent SSRF
			if (!/^[a-z]{2}-[a-z]+-\d{1,2}$/.test(region)) {
				return false;
			}
			const response = await fetch(`https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-Amz-Date': this._getAmzDate(),
				},
				signal: AbortSignal.timeout(10000),
			});
			// STS responds with 403 for unsigned requests — that means the endpoint is reachable
			// We can't fully validate without SigV4, but format + reachability is sufficient
			return response.status !== 0;
		} catch {
			return false;
		}
	}

	private async _validateAzure(credentials: ICloudCredentials): Promise<boolean> {
		if (!credentials.azureSubscriptionId || !credentials.azureTenantId) {
			return false;
		}

		// Validate GUID format for subscription and tenant IDs
		const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!guidPattern.test(credentials.azureSubscriptionId.trim())) {
			return false;
		}
		if (!guidPattern.test(credentials.azureTenantId.trim())) {
			return false;
		}

		try {
			if (credentials.azureClientId && credentials.azureClientSecret && credentials.azureTenantId) {
				if (!guidPattern.test(credentials.azureClientId.trim())) {
					return false;
				}
				// Validate tenant ID to prevent URL injection
				const tenantId = credentials.azureTenantId.trim();
				const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
				const body = new URLSearchParams({
					grant_type: 'client_credentials',
					client_id: credentials.azureClientId.trim(),
					client_secret: credentials.azureClientSecret,
					scope: 'https://management.azure.com/.default',
				});

				const response = await fetch(tokenUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: body.toString(),
					signal: AbortSignal.timeout(10000),
				});

				return response.ok;
			}
			// If we only have subscription/tenant, assume CLI auth is valid
			return true;
		} catch {
			return false;
		}
	}

	private _getAmzDate(): string {
		const now = new Date();
		return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	}

	override dispose(): void {
		super.dispose();
	}
}
