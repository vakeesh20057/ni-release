import * as vscode from 'vscode';
import { UriHandler } from './uriHandler';
import { Storage } from './storage';
import { Commands } from './commands';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('Neural Inverse Cloud');
	ctx.subscriptions.push(output);

	const storage = new Storage(ctx);
	const commands = new Commands(ctx, storage, output);
	const uriHandler = new UriHandler(storage, commands, output);

	ctx.subscriptions.push(
		vscode.window.registerUriHandler(uriHandler),
		vscode.commands.registerCommand('neuralinverse.cloud.login', () => commands.login()),
		vscode.commands.registerCommand('neuralinverse.cloud.logout', () => commands.logout()),
		vscode.commands.registerCommand('neuralinverse.cloud.open', () => commands.open()),
		vscode.commands.registerCommand('neuralinverse.cloud.resetRemoteServer', () => commands.resetRemoteServer()),
	);

	const deployment = storage.getDeployment();
	if (deployment) {
		await vscode.commands.executeCommand('setContext', 'nicloud.authenticated', true);
	}

	output.appendLine('Neural Inverse Cloud extension activated');
}

export function deactivate(): void {}
