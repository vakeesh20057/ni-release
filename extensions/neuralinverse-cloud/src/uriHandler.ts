import * as vscode from 'vscode';
import { Storage } from './storage';
import { Commands } from './commands';

/**
 * Handles URIs of the form:
 *   neuralinverse://neuralinverse.cloud/open?owner=X&workspace=Y&url=Z&token=T&agent=A&folder=F
 */
export class UriHandler implements vscode.UriHandler {
	constructor(
		private readonly storage: Storage,
		private readonly commands: Commands,
		private readonly output: vscode.OutputChannel,
	) {}

	async handleUri(uri: vscode.Uri): Promise<void> {
		this.output.appendLine(`Handling URI: ${uri.path}`);

		if (uri.path === '/open') {
			await this.handleOpen(uri);
		} else {
			this.output.appendLine(`Unknown URI path: ${uri.path}`);
		}
	}

	private async handleOpen(uri: vscode.Uri): Promise<void> {
		const params = new URLSearchParams(uri.query);

		const owner = params.get('owner');
		const workspace = params.get('workspace');
		const url = params.get('url');
		const token = params.get('token');

		if (!owner || !workspace || !url || !token) {
			vscode.window.showErrorMessage(
				'Neural Inverse Cloud: Invalid connection URL. Missing required parameters (owner, workspace, url, token).'
			);
			return;
		}

		const safeHostname = this.storage.toSafeHostname(url);
		await this.storage.setDeployment({ url, token, safeHostname });

		const agent = params.get('agent') || undefined;
		const folder = params.get('folder') || undefined;

		await this.commands.openWorkspace(owner, workspace, agent, folder);
	}
}
