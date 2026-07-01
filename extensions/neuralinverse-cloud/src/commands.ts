import * as vscode from 'vscode';
import { Storage } from './storage';
import { toRemoteAuthority } from './authority';
import { writeSshConfig } from './sshConfig';
import { ensureCli } from './cli';

export class Commands {
	constructor(
		private readonly ctx: vscode.ExtensionContext,
		private readonly storage: Storage,
		private readonly output: vscode.OutputChannel,
	) {}

	async login(urlOverride?: string): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('neuralinverse.cloud');
		const defaultUrl = urlOverride || cfg.get<string>('defaultUrl') || '';

		const url = await vscode.window.showInputBox({
			title: 'Neural Inverse Cloud URL',
			prompt: 'Enter your Neural Inverse Cloud deployment URL',
			value: defaultUrl || 'https://cloud.neuralinverse.com',
			ignoreFocusOut: true,
		});
		if (!url) {
			return;
		}

		const token = await vscode.window.showInputBox({
			title: 'Session Token',
			prompt: 'Paste your session token (from the web dashboard)',
			password: true,
			ignoreFocusOut: true,
		});
		if (!token) {
			return;
		}

		const safeHostname = this.storage.toSafeHostname(url);
		await this.storage.setDeployment({ url, token, safeHostname });
		vscode.window.showInformationMessage(`Neural Inverse Cloud: Logged in to ${url}`);
	}

	async logout(): Promise<void> {
		await this.storage.clearDeployment();
		vscode.window.showInformationMessage('Neural Inverse Cloud: Logged out.');
	}

	async open(): Promise<void> {
		const deployment = this.storage.getDeployment();
		if (!deployment) {
			const action = await vscode.window.showErrorMessage(
				'Neural Inverse Cloud: Not logged in.',
				'Log In',
			);
			if (action === 'Log In') {
				await this.login();
			}
			return;
		}

		const input = await vscode.window.showInputBox({
			title: 'Open Workspace',
			prompt: 'Enter owner/workspace (e.g. sanjay/myproject)',
			ignoreFocusOut: true,
		});
		if (!input) {
			return;
		}

		const [owner, workspace] = input.split('/');
		if (!owner || !workspace) {
			vscode.window.showErrorMessage('Neural Inverse Cloud: Use format owner/workspace.');
			return;
		}

		await this.openWorkspace(owner, workspace);
	}

	async openWorkspace(
		owner: string,
		workspace: string,
		agent?: string,
		folder?: string,
	): Promise<void> {
		const deployment = this.storage.getDeployment();
		if (!deployment) {
			vscode.window.showErrorMessage('Neural Inverse Cloud: Not logged in.');
			return;
		}

		this.output.appendLine(`Opening workspace: ${owner}/${workspace} (agent=${agent || 'main'})`);

		const cliPath = await ensureCli(this.ctx, deployment.url, this.output);
		if (!cliPath) {
			return;
		}

		await writeSshConfig(
			deployment,
			owner,
			workspace,
			agent || 'main',
			cliPath,
			this.output,
		);

		const remoteAuthority = toRemoteAuthority(
			deployment.safeHostname,
			owner,
			workspace,
			agent,
		);
		const folderPath = folder || `/home/${owner}`;

		const remoteUri = vscode.Uri.from({
			scheme: 'vscode-remote',
			authority: remoteAuthority,
			path: folderPath,
		});

		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, {
			forceNewWindow: true,
		});
	}
}
