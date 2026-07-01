import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface Deployment {
	url: string;
	token: string;
	safeHostname: string;
}

const DEPLOYMENT_KEY = 'nicloud.deployment';

export class Storage {
	constructor(private readonly ctx: vscode.ExtensionContext) {}

	getDeployment(): Deployment | undefined {
		return this.ctx.globalState.get<Deployment>(DEPLOYMENT_KEY);
	}

	async setDeployment(deployment: Deployment): Promise<void> {
		await this.ctx.globalState.update(DEPLOYMENT_KEY, deployment);
		await vscode.commands.executeCommand('setContext', 'nicloud.authenticated', true);
		await this._writeTokenFile(deployment.token);
	}

	async clearDeployment(): Promise<void> {
		await this.ctx.globalState.update(DEPLOYMENT_KEY, undefined);
		await vscode.commands.executeCommand('setContext', 'nicloud.authenticated', false);
		await this._writeTokenFile('');
	}

	private async _writeTokenFile(token: string): Promise<void> {
		const tokenPath = path.join(this.ctx.globalStorageUri.fsPath, 'session_token');
		try {
			await fs.mkdir(this.ctx.globalStorageUri.fsPath, { recursive: true });
			await fs.writeFile(tokenPath, token, { mode: 0o600 });
		} catch { /* best effort */ }
	}

	getSessionToken(): string | undefined {
		return this.getDeployment()?.token;
	}

	toSafeHostname(url: string): string {
		try {
			const u = new URL(url);
			return u.hostname.replace(/\./g, '-');
		} catch {
			return url.replace(/[^a-zA-Z0-9-]/g, '-');
		}
	}
}
