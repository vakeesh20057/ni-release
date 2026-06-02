/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Process Runner — subprocess execution with stdout/stderr capture.
 *
 * In Electron desktop (non-sandboxed), uses `child_process.spawn` directly.
 * Provides structured results with exit code, stdout, stderr, and duration.
 *
 * Used by build system, flash tools, binary analysis, and instrument backends.
 */

export interface IProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	signal?: string;
	timedOut: boolean;
}

export interface IProcessOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
	onStdout?: (line: string) => void;
	onStderr?: (line: string) => void;
}

/**
 * Run a command with arguments, capturing all output.
 * Returns a structured result with exit code, stdout, stderr.
 *
 * @throws Error if child_process is unavailable (pure browser environment)
 */
export async function runProcess(command: string, args: string[], options?: IProcessOptions): Promise<IProcessResult> {
	const cp = _getChildProcess();
	if (!cp) {
		throw new Error('Process execution unavailable — child_process not accessible in this environment.');
	}

	const startTime = Date.now();
	const timeoutMs = options?.timeoutMs ?? 60_000;

	return new Promise<IProcessResult>((resolve) => {
		const proc = cp.spawn(command, args, {
			cwd: options?.cwd,
			env: options?.env ? { ...process.env, ...options.env } : undefined,
			timeout: timeoutMs,
			shell: false,
		});

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		proc.stdout?.on('data', (data: Buffer | string) => {
			const chunk = String(data);
			stdout += chunk;
			if (options?.onStdout) {
				for (const line of chunk.split('\n')) {
					if (line) options.onStdout(line);
				}
			}
		});

		proc.stderr?.on('data', (data: Buffer | string) => {
			const chunk = String(data);
			stderr += chunk;
			if (options?.onStderr) {
				for (const line of chunk.split('\n')) {
					if (line) options.onStderr(line);
				}
			}
		});

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill('SIGTERM');
		}, timeoutMs);

		proc.on('close', (code: number | null, signal: string | null) => {
			clearTimeout(timer);
			resolve({
				exitCode: code ?? 1,
				stdout: stdout.trimEnd(),
				stderr: stderr.trimEnd(),
				durationMs: Date.now() - startTime,
				signal: signal ?? undefined,
				timedOut,
			});
		});

		proc.on('error', (err: Error) => {
			clearTimeout(timer);
			resolve({
				exitCode: 127,
				stdout: '',
				stderr: err.message,
				durationMs: Date.now() - startTime,
				timedOut: false,
			});
		});
	});
}

/**
 * Run a shell command string (via /bin/sh -c or cmd /c).
 */
export async function runShell(command: string, options?: IProcessOptions): Promise<IProcessResult> {
	const isWin = typeof process !== 'undefined' && process.platform === 'win32';
	const shell = isWin ? 'cmd' : '/bin/sh';
	const shellArgs = isWin ? ['/c', command] : ['-c', command];
	return runProcess(shell, shellArgs, options);
}

/**
 * Check if a command exists on the system PATH.
 * Returns the full path if found, undefined otherwise.
 */
export async function which(command: string): Promise<string | undefined> {
	const isWin = typeof process !== 'undefined' && process.platform === 'win32';
	const whichCmd = isWin ? 'where' : 'which';

	try {
		const result = await runProcess(whichCmd, [command], { timeoutMs: 5000 });
		if (result.exitCode === 0 && result.stdout) {
			return result.stdout.split('\n')[0]!.trim();
		}
	} catch { /* unavailable */ }
	return undefined;
}

/**
 * Check if child_process is available in this environment.
 */
export function isProcessAvailable(): boolean {
	return _getChildProcess() !== null;
}


function _getChildProcess(): typeof import('child_process') | null {
	try {
		const nodeRequire = (globalThis as Record<string, unknown>)['require'] as ((m: string) => unknown) | undefined;
		if (!nodeRequire) return null;
		return nodeRequire('child_process') as typeof import('child_process');
	} catch {
		return null;
	}
}
