import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import * as vscode from 'vscode';

const CLI_NAME = process.platform === 'win32' ? 'neuralinverse.exe' : 'neuralinverse';

export async function ensureCli(
	ctx: vscode.ExtensionContext,
	deploymentUrl: string,
	output: vscode.OutputChannel,
): Promise<string | undefined> {
	const binDir = path.join(ctx.globalStorageUri.fsPath, 'bin');
	const cliPath = path.join(binDir, CLI_NAME);

	try {
		await fs.access(cliPath);
		output.appendLine(`CLI found at: ${cliPath}`);
		return cliPath;
	} catch {
		// not present, try to download
	}

	const enabled = vscode.workspace
		.getConfiguration('neuralinverse.cloud')
		.get<boolean>('enableDownloads', true);

	if (!enabled) {
		vscode.window.showErrorMessage(
			'Neural Inverse Cloud: CLI not found and downloads are disabled. ' +
			'Install the nicloud CLI manually or enable downloads in settings.'
		);
		return undefined;
	}

	return downloadCli(deploymentUrl, binDir, cliPath, output);
}

async function downloadCli(
	deploymentUrl: string,
	binDir: string,
	cliPath: string,
	output: vscode.OutputChannel,
): Promise<string | undefined> {
	const platform = os.platform();
	const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';

	let osName: string;
	switch (platform) {
		case 'darwin': osName = 'darwin'; break;
		case 'linux': osName = 'linux'; break;
		case 'win32': osName = 'windows'; break;
		default:
			vscode.window.showErrorMessage(`Neural Inverse Cloud: Unsupported platform: ${platform}`);
			return undefined;
	}

	const downloadUrl = `${deploymentUrl}/bin/neuralinverse-${osName}-${arch}`;
	output.appendLine(`Downloading CLI from: ${downloadUrl}`);

	try {
		await fs.mkdir(binDir, { recursive: true });

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Neural Inverse Cloud: Downloading CLI...' },
			() => download(downloadUrl, cliPath),
		);

		await fs.chmod(cliPath, 0o755);
		output.appendLine(`CLI downloaded to: ${cliPath}`);
		return cliPath;
	} catch (err) {
		output.appendLine(`CLI download failed: ${err}`);
		vscode.window.showErrorMessage(
			`Neural Inverse Cloud: Failed to download CLI. ${err}`
		);
		return undefined;
	}
}

function download(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const mod = url.startsWith('https') ? https : http;
		const request = mod.get(url, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				const location = res.headers.location;
				if (location) {
					download(location, dest).then(resolve, reject);
					return;
				}
			}
			if (res.statusCode !== 200) {
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', async () => {
				try {
					await fs.writeFile(dest, Buffer.concat(chunks));
					resolve();
				} catch (e) {
					reject(e);
				}
			});
			res.on('error', reject);
		});
		request.on('error', reject);
	});
}
