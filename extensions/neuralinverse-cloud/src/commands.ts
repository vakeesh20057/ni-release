import * as vscode from 'vscode';
import * as cp from 'node:child_process';
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

	async resetRemoteServer(owner?: string, workspace?: string): Promise<void> {
		const deployment = this.storage.getDeployment();
		if (!deployment) {
			vscode.window.showErrorMessage('Neural Inverse Cloud: Not logged in.');
			return;
		}

		if (!owner || !workspace) {
			const input = await vscode.window.showInputBox({
				title: 'Reset Remote Server',
				prompt: 'Enter owner/workspace whose server cache to clear (e.g. sanjay/myproject)',
				ignoreFocusOut: true,
			});
			if (!input) { return; }
			const parts = input.split('/');
			owner = parts[0];
			workspace = parts[1];
			if (!owner || !workspace) {
				vscode.window.showErrorMessage('Neural Inverse Cloud: Use format owner/workspace.');
				return;
			}
		}

		const cliPath = await ensureCli(this.ctx, deployment.url, this.output);
		if (!cliPath) { return; }

		const prefix = `neuralinverse-vscode--${deployment.safeHostname}--`;
		const sshHost = `${prefix}${owner}--${workspace}.main`;

		const cmd = [
			`"${cliPath}"`,
			`--url ${deployment.url}`,
			`--token ${deployment.token}`,
			'ssh --stdio',
			`--ssh-host-prefix ${prefix}`,
			sshHost,
		].join(' ');

		// Use ssh via CLI proxy to delete the cached server directory
		const deleteCmd = `ssh -o ProxyCommand='${cmd}' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${sshHost} "rm -rf ~/.neuralinverse-server"`;

		this.output.appendLine(`Resetting server cache on ${owner}/${workspace}...`);

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Neural Inverse Cloud: Clearing remote server cache...' },
			() => new Promise<void>((resolve, reject) => {
				cp.exec(deleteCmd, { timeout: 30000 }, (err, _stdout, stderr) => {
					if (err) {
						this.output.appendLine(`Reset error: ${stderr || err.message}`);
						reject(err);
					} else {
						this.output.appendLine('Remote server cache cleared.');
						resolve();
					}
				});
			}),
		).then(
			() => vscode.window.showInformationMessage(
				`Neural Inverse Cloud: Server cache cleared for ${owner}/${workspace}. Reconnect to install fresh server.`
			),
			(err) => vscode.window.showErrorMessage(`Neural Inverse Cloud: Reset failed — ${err.message}`)
		);
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
