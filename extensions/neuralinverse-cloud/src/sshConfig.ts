import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AUTHORITY_PREFIX } from './authority';
import type { Deployment } from './storage';

const START_MARKER = '# --- START-NICLOUD ---';
const END_MARKER = '# --- END-NICLOUD ---';

export async function writeSshConfig(
	deployment: Deployment,
	_owner: string,
	_workspace: string,
	_agent: string,
	cliPath: string,
	output: vscode.OutputChannel,
): Promise<void> {
	const sshDir = path.join(os.homedir(), '.ssh');
	const configPath = path.join(sshDir, 'config');

	await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

	let existing = '';
	try {
		existing = await fs.readFile(configPath, 'utf8');
	} catch {
		// file doesn't exist yet
	}

	const headerCmd = getHeaderCommand();
	const insecure = vscode.workspace
		.getConfiguration('neuralinverse.cloud')
		.get<boolean>('insecure', false);

	const hostPattern = `${AUTHORITY_PREFIX}${deployment.safeHostname}--*`;

	const quotedCliPath = cliPath.includes(' ') ? `"${cliPath}"` : cliPath;
	const prefix = `${AUTHORITY_PREFIX}${deployment.safeHostname}--`;

	// Use --global-config to store session config, matching coder extension pattern.
	// This avoids /bin/sh -c wrappers which break open-remote-ssh's arg splitting.
	const globalConfigDir = path.dirname(cliPath);
	const proxyCmd = [
		quotedCliPath,
		`--global-config "${globalConfigDir}"`,
		`--url ${deployment.url}`,
		`--token ${deployment.token}`,
		'ssh --stdio',
		`--ssh-host-prefix ${prefix}`,
	];
	if (headerCmd) {
		proxyCmd.push(`--header-command "${headerCmd}"`);
	}
	proxyCmd.push('%h');

	const userSshConfig = vscode.workspace
		.getConfiguration('neuralinverse.cloud')
		.get<string[]>('sshConfig', []);

	const lines = [
		`Host ${hostPattern}`,
		`  ProxyCommand ${proxyCmd.join(' ')}`,
		'  ConnectTimeout 30',
		'  StrictHostKeyChecking no',
		'  UserKnownHostsFile /dev/null',
		'  LogLevel ERROR',
		'  ServerAliveInterval 5',
		'  ServerAliveCountMax 3',
	];
	if (insecure) {
		lines.push('  SetEnv NEURALINVERSE_TLS_INSECURE=true');
	}
	for (const item of userSshConfig) {
		lines.push(`  ${item}`);
	}

	const block = `${START_MARKER}\n${lines.join('\n')}\n${END_MARKER}`;

	const startIdx = existing.indexOf(START_MARKER);
	const endIdx = existing.indexOf(END_MARKER);

	let updated: string;
	if (startIdx >= 0 && endIdx >= 0) {
		updated = existing.slice(0, startIdx) + block + existing.slice(endIdx + END_MARKER.length);
	} else {
		updated = existing ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
	}

	await fs.writeFile(configPath, updated, { mode: 0o600 });
	output.appendLine(`SSH config updated: ${configPath}`);
}

function getHeaderCommand(): string {
	return vscode.workspace
		.getConfiguration('neuralinverse.cloud')
		.get<string>('headerCommand', '');
}
