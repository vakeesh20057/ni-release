import * as vscode from 'vscode';
import { parseRemoteAuthority } from './authority';
import { writeSshConfig } from './sshConfig';
import { ensureCli } from './cli';
import { Storage } from './storage';

export class Remote {
	constructor(
		private readonly ctx: vscode.ExtensionContext,
		private readonly storage: Storage,
		private readonly output: vscode.OutputChannel,
	) {}

	async setup(remoteAuthority: string): Promise<void> {
		const parts = parseRemoteAuthority(remoteAuthority);
		if (!parts) {
			return;
		}

		this.output.appendLine(`Remote setup: ${parts.owner}/${parts.workspace} (agent=${parts.agent})`);

		const deployment = this.storage.getDeployment();
		if (!deployment) {
			vscode.window.showErrorMessage(
				'Neural Inverse Cloud: Not logged in. Click the Desktop button from your cloud dashboard to connect.'
			);
			return;
		}

		if (deployment.safeHostname !== parts.safeHostname) {
			this.output.appendLine(
				`Hostname mismatch: stored=${deployment.safeHostname}, authority=${parts.safeHostname}`
			);
		}

		const cliPath = await ensureCli(this.ctx, deployment.url, this.output);
		if (!cliPath) {
			return;
		}

		await writeSshConfig(
			deployment,
			parts.owner,
			parts.workspace,
			parts.agent,
			cliPath,
			this.output,
		);
	}
}
