/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IDetectedCredential, ENV_VAR_MAP, AWS_ENV_VARS, AZURE_ENV_VARS, GCP_ENV_VARS } from './autoConnectTypes.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { env } from '../../../../../base/common/process.js';

function getEnv(name: string): string | undefined {
	return env[name] || undefined;
}

function maskKey(key: string): string {
	if (key.length <= 8) return '***';
	return key.slice(0, 4) + '...' + key.slice(-4);
}

function findFirstEnvVar(envVars: readonly string[]): string | undefined {
	for (const v of envVars) {
		const val = getEnv(v);
		if (val && val.trim().length > 0) return val.trim();
	}
	return undefined;
}

function getHomedir(): string {
	return getEnv('HOME') || getEnv('USERPROFILE') || '';
}

function parseIniFile(content: string, section: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = content.split('\n');
	let inSection = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('[')) {
			inSection = trimmed === `[${section}]`;
			continue;
		}
		if (inSection && trimmed.includes('=')) {
			const eqIdx = trimmed.indexOf('=');
			const key = trimmed.slice(0, eqIdx).trim();
			const value = trimmed.slice(eqIdx + 1).trim();
			if (key && value) result[key] = value;
		}
	}
	return result;
}

async function readFileSafe(fileService: IFileService, filePath: string): Promise<string | null> {
	try {
		const content = await fileService.readFile(URI.file(filePath));
		return content.value.toString();
	} catch {
		return null;
	}
}

// --- Parse shell config files for exported env vars ---

async function readShellEnvVars(fileService: IFileService): Promise<Record<string, string>> {
	const home = getHomedir();
	if (!home) return {};

	const shellFiles = [
		`${home}/.zshrc`,
		`${home}/.zprofile`,
		`${home}/.bash_profile`,
		`${home}/.bashrc`,
		`${home}/.profile`,
	];

	const vars: Record<string, string> = {};

	for (const filePath of shellFiles) {
		const content = await readFileSafe(fileService, filePath);
		if (!content) continue;
		for (const line of content.split('\n')) {
			const match = line.match(/^\s*export\s+([A-Z0-9_]+)\s*=\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/);
			if (match) {
				const [, key, value] = match;
				if (key && value && value.trim() && !vars[key]) {
					vars[key] = value.trim();
				}
			}
		}
	}
	return vars;
}

// --- Simple env-var API key providers ---

export async function detectEnvVarCredentials(fileService: IFileService): Promise<IDetectedCredential[]> {
	const results: IDetectedCredential[] = [];

	// First check process.env (works in terminal launches)
	const shellVars = await readShellEnvVars(fileService);

	const lookup = (name: string): string | undefined => getEnv(name) || shellVars[name] || undefined;

	for (const { providerName, envVars } of ENV_VAR_MAP) {
		const key = envVars.map(v => lookup(v)).find(v => v && v.trim().length > 0);
		if (key) {
			results.push({
				providerName,
				source: 'env',
				settings: { apiKey: key },
				maskedDisplay: maskKey(key),
			});
		}
	}

	return results;
}

// --- AWS: env vars → ~/.aws/credentials ---

export async function detectAwsCredentials(fileService: IFileService): Promise<IDetectedCredential | null> {
	const envAccessKey = findFirstEnvVar(AWS_ENV_VARS.accessKeyId);
	const envSecretKey = findFirstEnvVar(AWS_ENV_VARS.secretAccessKey);

	if (envAccessKey && envSecretKey) {
		const region = findFirstEnvVar(AWS_ENV_VARS.region) || 'us-east-1';
		return {
			providerName: 'awsBedrock',
			source: 'env',
			settings: { region },
			maskedDisplay: maskKey(envAccessKey),
		};
	}

	const home = getHomedir();
	if (!home) return null;

	const credContent = await readFileSafe(fileService, `${home}/.aws/credentials`);
	if (!credContent) return null;

	const profile = parseIniFile(credContent, 'default');
	const fileAccessKey = profile['aws_access_key_id'];
	const fileSecretKey = profile['aws_secret_access_key'];

	if (!fileAccessKey || !fileSecretKey) return null;

	let region = findFirstEnvVar(AWS_ENV_VARS.region) || 'us-east-1';
	const configContent = await readFileSafe(fileService, `${home}/.aws/config`);
	if (configContent) {
		const configProfile = parseIniFile(configContent, 'default');
		if (configProfile['region']) region = configProfile['region'];
	}

	return {
		providerName: 'awsBedrock',
		source: 'config-file',
		settings: { region },
		maskedDisplay: maskKey(fileAccessKey),
	};
}

// --- Azure: env vars → ~/.azure/azureProfile.json ---

export async function detectAzureCredentials(fileService: IFileService): Promise<IDetectedCredential | null> {
	const apiKey = findFirstEnvVar(AZURE_ENV_VARS.apiKey);
	if (apiKey) {
		const endpoint = findFirstEnvVar(AZURE_ENV_VARS.endpoint);
		const settings: Record<string, string> = { apiKey };
		if (endpoint) {
			const match = endpoint.match(/https?:\/\/([^.]+)\.openai\.azure\.com/);
			if (match) settings.project = match[1];
		}
		return {
			providerName: 'microsoftAzure',
			source: 'env',
			settings,
			maskedDisplay: maskKey(apiKey),
		};
	}

	const home = getHomedir();
	if (!home) return null;

	const azureProfile = await readFileSafe(fileService, `${home}/.azure/azureProfile.json`);
	if (!azureProfile) return null;

	try {
		const profile = JSON.parse(azureProfile);
		const subscriptions = profile?.subscriptions;
		if (subscriptions && subscriptions.length > 0) {
			const defaultSub = subscriptions.find((s: any) => s.isDefault) || subscriptions[0];
			return {
				providerName: 'microsoftAzure',
				source: 'config-file',
				settings: {},
				maskedDisplay: `Azure CLI (${defaultSub.name || defaultSub.id || 'logged in'})`,
			};
		}
	} catch { /* malformed */ }

	return null;
}

// --- GCP: env vars → ~/.config/gcloud/application_default_credentials.json ---

export async function detectGcpCredentials(fileService: IFileService): Promise<IDetectedCredential | null> {
	const credentials = findFirstEnvVar(GCP_ENV_VARS.credentials);
	const project = findFirstEnvVar(GCP_ENV_VARS.project);

	if (credentials || project) {
		const settings: Record<string, string> = {};
		if (project) settings.project = project;
		settings.region = findFirstEnvVar(GCP_ENV_VARS.region) || 'us-west2';
		return {
			providerName: 'googleVertex',
			source: credentials ? 'config-file' : 'env',
			settings,
			maskedDisplay: project || 'ADC configured',
		};
	}

	const home = getHomedir();
	if (!home) return null;

	const adcContent = await readFileSafe(fileService, `${home}/.config/gcloud/application_default_credentials.json`);
	if (!adcContent) return null;

	try {
		const adc = JSON.parse(adcContent);
		if (adc.client_id || adc.type === 'authorized_user' || adc.type === 'service_account') {
			let detectedProject = '';
			let detectedRegion = 'us-west2';

			const propsContent = await readFileSafe(fileService, `${home}/.config/gcloud/properties`);
			if (propsContent) {
				const coreSection = parseIniFile(propsContent, 'core');
				if (coreSection['project']) detectedProject = coreSection['project'];
				const computeSection = parseIniFile(propsContent, 'compute');
				if (computeSection['region']) detectedRegion = computeSection['region'];
			}

			const settings: Record<string, string> = { region: detectedRegion };
			if (detectedProject) settings.project = detectedProject;

			return {
				providerName: 'googleVertex',
				source: 'config-file',
				settings,
				maskedDisplay: detectedProject || `gcloud ADC (${adc.type})`,
			};
		}
	} catch { /* malformed */ }

	return null;
}

// --- GitHub CLI: ~/.config/gh/hosts.yml or external token ---

export async function detectGitHubCliCredentials(fileService: IFileService, externalToken?: string): Promise<IDetectedCredential | null> {
	const home = getHomedir();

	// Strategy 1: token provided externally (from `gh auth token` shell-out)
	if (externalToken && externalToken.trim().length >= 4) {
		let user = '';
		if (home) {
			const hostsContent = await readFileSafe(fileService, `${home}/.config/gh/hosts.yml`);
			if (hostsContent) {
				const userMatch = hostsContent.match(/user:\s*(.+)/);
				if (userMatch) user = userMatch[1].trim();
			}
		}
		return {
			providerName: 'githubModels',
			source: 'cli-auth',
			settings: { apiKey: externalToken.trim() },
			maskedDisplay: user ? `gh cli (${user})` : maskKey(externalToken.trim()),
		};
	}

	// Strategy 2: token stored in hosts.yml directly (older gh versions / non-keychain)
	if (!home) return null;

	const hostsPath = `${home}/.config/gh/hosts.yml`;
	const content = await readFileSafe(fileService, hostsPath);
	if (!content) return null;

	const tokenMatch = content.match(/oauth_token:\s*(.+)/);
	if (!tokenMatch) return null;

	const token = tokenMatch[1].trim();
	if (!token || token.length < 4) return null;

	let user = '';
	const userMatch = content.match(/user:\s*(.+)/);
	if (userMatch) user = userMatch[1].trim();

	return {
		providerName: 'githubModels',
		source: 'cli-auth',
		settings: { apiKey: token },
		maskedDisplay: user ? `gh cli (${user})` : maskKey(token),
	};
}

// --- Aggregate ---

export async function detectAllCredentials(fileService: IFileService, ghCliToken?: string): Promise<IDetectedCredential[]> {
	const results: IDetectedCredential[] = [];

	results.push(...await detectEnvVarCredentials(fileService));

	const [aws, azure, gcp, ghCli] = await Promise.all([
		detectAwsCredentials(fileService),
		detectAzureCredentials(fileService),
		detectGcpCredentials(fileService),
		detectGitHubCliCredentials(fileService, ghCliToken),
	]);

	if (aws) results.push(aws);
	if (azure) results.push(azure);
	if (gcp) results.push(gcp);

	// Only add GitHub CLI credential if env-var detection didn't already find githubModels
	if (ghCli && !results.some(r => r.providerName === 'githubModels')) {
		results.push(ghCli);
	}

	return results;
}
