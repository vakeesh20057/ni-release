/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Trigger Guard
 *
 * Evaluates pre-flight conditions before an automatic workflow trigger fires.
 * ALL guards must pass (AND semantics). If any fails, the trigger is suppressed.
 *
 * ## Guard Types
 *
 * - glob-match:    The triggering file path must match the given glob pattern
 * - command-exit:  A shell command must exit 0 (uses sentinel file pattern)
 * - file-exists:   A workspace-relative path must exist
 * - expression:    Evaluated against trigger context using conditionalEvaluator
 */

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { match as globMatch } from '../../../../../base/common/glob.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ITriggerGuardConfig } from '../../common/workflowTypes.js';
import { evaluateCondition } from '../orchestrator/conditionalEvaluator.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface ITriggerContext {
	/** URI of the file that triggered the event (for file-save triggers) */
	fileUri?: string;
	/** Raw context string passed by the trigger manager */
	context?: string;
}

export interface IGuardResult {
	pass: boolean;
	/** The guard config that caused failure (for logging) */
	failedGuard?: ITriggerGuardConfig;
	failReason?: string;
}

/**
 * Evaluate all guards. Returns pass=true only if every guard passes.
 * Short-circuits on the first failure.
 */
export async function evaluateGuards(
	guards: ITriggerGuardConfig[],
	triggerContext: ITriggerContext,
	workspaceRoot: URI,
	fileService: IFileService,
	terminalService: ITerminalService,
): Promise<IGuardResult> {
	for (const guard of guards) {
		const result = await _evaluateGuard(guard, triggerContext, workspaceRoot, fileService, terminalService);
		if (!result.pass) {
			return { pass: false, failedGuard: guard, failReason: result.failReason };
		}
	}
	return { pass: true };
}

async function _evaluateGuard(
	guard: ITriggerGuardConfig,
	ctx: ITriggerContext,
	workspaceRoot: URI,
	fileService: IFileService,
	terminalService: ITerminalService,
): Promise<{ pass: boolean; failReason?: string }> {
	let pass: boolean;
	let reason: string | undefined;

	switch (guard.type) {

		case 'glob-match': {
			if (!guard.glob) { pass = true; break; }
			const filePath = ctx.fileUri ?? '';
			const rootPath = workspaceRoot.fsPath.endsWith('/') ? workspaceRoot.fsPath : workspaceRoot.fsPath + '/';
			const relativePath = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length) : filePath;
			pass = globMatch(guard.glob, relativePath);
			if (!pass) reason = `File "${relativePath}" does not match glob "${guard.glob}"`;
			break;
		}

		case 'command-exit': {
			if (!guard.command?.trim()) { pass = true; break; }
			const timeoutMs = guard.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
			const exitCode = await _runCommandForExitCode(
				guard.command.trim(), workspaceRoot, fileService, terminalService, timeoutMs,
			);
			if (exitCode === null) {
				pass = false;
				reason = `Guard command timed out: ${guard.command}`;
			} else {
				pass = exitCode === 0;
				if (!pass) reason = `Guard command exited ${exitCode}: ${guard.command}`;
			}
			break;
		}

		case 'file-exists': {
			if (!guard.filePath) { pass = true; break; }
			const uri = URI.joinPath(workspaceRoot, guard.filePath);
			pass = await fileService.exists(uri);
			if (!pass) reason = `Required file "${guard.filePath}" does not exist`;
			break;
		}

		case 'expression': {
			if (!guard.expression) { pass = true; break; }
			try {
				const contextJson = JSON.stringify({
					fileUri: ctx.fileUri,
					context: ctx.context,
				});
				pass = evaluateCondition(contextJson, guard.expression);
			} catch (e: any) {
				pass = false;
				reason = `Guard expression error: ${e.message}`;
			}
			break;
		}

		default:
			pass = true;
	}

	// Apply negation
	if (guard.negate) {
		pass = !pass;
		if (!pass) reason = reason ? `(negated) ${reason}` : `Guard negated`;
	}

	return { pass, failReason: reason };
}

// ─── Command Exit Code via Sentinel File ──────────────────────────────────────
// Reuses the same sentinel pattern from workflowTriggerManager.ts

async function _runCommandForExitCode(
	command: string,
	workspaceRoot: URI,
	fileService: IFileService,
	terminalService: ITerminalService,
	timeoutMs: number,
): Promise<number | null> {
	const sentinelUri = URI.joinPath(workspaceRoot, `.inverse_guard_${Date.now()}_exit`);
	try { await fileService.del(sentinelUri); } catch { }

	let terminal = terminalService.instances.find(inst => inst.title === 'Inverse Guard');
	if (!terminal) {
		terminal = await terminalService.createTerminal({ config: { name: 'Inverse Guard', isTransient: true } });
	}

	const sentinelPath = sentinelUri.fsPath;
	const shellCmd = isWindows
		? `(${command}) && echo 0 > "${sentinelPath}" || echo 1 > "${sentinelPath}"`
		: `(${command}); echo $? > "${sentinelPath}"`;

	terminal.sendText(shellCmd, true);

	// Poll for sentinel
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			if (await fileService.exists(sentinelUri)) {
				const raw = await fileService.readFile(sentinelUri);
				try { await fileService.del(sentinelUri); } catch { }
				return parseInt(raw.value.toString().trim(), 10);
			}
		} catch { }
		await new Promise<void>(r => setTimeout(r, 500));
	}

	try { await fileService.del(sentinelUri); } catch { }
	return null;
}
