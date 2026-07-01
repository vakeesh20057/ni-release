/**
 * SSH host names created by this extension have the format:
 *   neuralinverse-vscode--<safeHostname>--<owner>--<workspace>.<agent?>
 *
 * The remote authority is:
 *   ssh-remote+neuralinverse-vscode--<safeHostname>--<owner>--<workspace>.<agent?>
 *
 * The --ssh-host-prefix passed to the CLI is:
 *   neuralinverse-vscode--<safeHostname>--
 * After stripping, the CLI sees: <owner>--<workspace>.<agent?>
 */

export const AUTHORITY_PREFIX = 'neuralinverse-vscode--';

export interface AuthorityParts {
	safeHostname: string;
	owner: string;
	workspace: string;
	agent: string;
	sshHost: string;
}

export function parseRemoteAuthority(authority: string): AuthorityParts | null {
	const parts = authority.split('+');
	const sshHost = parts[1];
	if (!sshHost || !sshHost.startsWith(AUTHORITY_PREFIX)) {
		return null;
	}

	const rest = sshHost.slice(AUTHORITY_PREFIX.length);
	const segments = rest.split('--');
	if (segments.length < 3) {
		return null;
	}

	const safeHostname = segments.slice(0, -2).join('--');
	const owner = segments[segments.length - 2];
	const workspaceAndAgent = segments[segments.length - 1];

	let workspace = workspaceAndAgent;
	let agent = 'main';
	const dotIdx = workspaceAndAgent.indexOf('.');
	if (dotIdx > 0) {
		workspace = workspaceAndAgent.slice(0, dotIdx);
		agent = workspaceAndAgent.slice(dotIdx + 1);
	}

	return { safeHostname, owner, workspace, agent, sshHost };
}

export function toRemoteAuthority(
	safeHostname: string,
	owner: string,
	workspace: string,
	agent?: string,
): string {
	let host = `${AUTHORITY_PREFIX}${safeHostname}--${owner}--${workspace}`;
	if (agent) {
		host += `.${agent}`;
	}
	return `ssh-remote+${host}`;
}

export function toSshHost(
	safeHostname: string,
	owner: string,
	workspace: string,
	agent?: string,
): string {
	let host = `${AUTHORITY_PREFIX}${safeHostname}--${owner}--${workspace}`;
	if (agent) {
		host += `.${agent}`;
	}
	return host;
}
