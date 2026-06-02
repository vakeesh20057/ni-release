/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checkpoint / Rewind Service
 *
 * Snapshots workspace file state before each AI write batch, enabling full rewind
 * to any previous checkpoint. Each checkpoint stores git-format diffs (not full copies)
 * so storage is minimal even across many checkpoints.
 *
 * Operations:
 *   createCheckpoint(label)  — snapshot current file state, return checkpointId
 *   listCheckpoints()        — list all checkpoints with metadata
 *   rewindTo(id)             — restore file state to checkpoint (reverse-apply diffs)
 *   forkFrom(id)             — create new git branch from checkpoint, leave files unchanged
 *
 * Storage: .inverse/checkpoints/<id>.json
 * Format: { id, label, timestamp, filesChanged[], diffs: { path: unified_diff }[] }
 *
 * Max 50 checkpoints; auto-prunes oldest when limit reached.
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface ICheckpoint {
	id: string;
	label: string;
	timestamp: number;
	filesChanged: string[];
	branchName?: string;
	commitHash?: string;
}

export interface ICheckpointDetail extends ICheckpoint {
	diffs: Record<string, string>;   // filePath -> unified diff
	fileSnapshots: Record<string, string>;  // filePath -> full content snapshot for binary-safe rewind
}

export interface ICheckpointStatus {
	count: number;
	maxCheckpoints: number;
	oldestTimestamp?: number;
	newestTimestamp?: number;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const ICheckpointService = createDecorator<ICheckpointService>('checkpointService');

export interface ICheckpointService {
	readonly _serviceBrand: undefined;

	readonly onCheckpointCreated: Event<ICheckpoint>;
	readonly onRewind: Event<ICheckpoint>;

	/** Create a checkpoint of current file state. Returns checkpointId. */
	createCheckpoint(label: string, filesChanged?: string[]): Promise<string>;

	/** List all checkpoints, newest first. */
	listCheckpoints(): ICheckpoint[];

	/** Rewind files to the state at a specific checkpoint. */
	rewindTo(checkpointId: string): Promise<void>;

	/** Create a new git branch from checkpoint state, leave working tree unchanged. */
	forkFrom(checkpointId: string, branchName?: string): Promise<string>;

	/** Get diff for a checkpoint. */
	getCheckpointDiff(checkpointId: string): ICheckpointDetail | null;

	/** Delete a specific checkpoint. */
	deleteCheckpoint(checkpointId: string): void;

	/** Get current status. */
	getStatus(): ICheckpointStatus;
}


// ─── Implementation ───────────────────────────────────────────────────────────

const MAX_CHECKPOINTS = 50;
const CHECKPOINT_DIR = '.inverse/checkpoints';

class CheckpointServiceImpl extends Disposable implements ICheckpointService {
	readonly _serviceBrand: undefined;

	private readonly _onCheckpointCreated = this._register(new Emitter<ICheckpoint>());
	readonly onCheckpointCreated: Event<ICheckpoint> = this._onCheckpointCreated.event;

	private readonly _onRewind = this._register(new Emitter<ICheckpoint>());
	readonly onRewind: Event<ICheckpoint> = this._onRewind.event;

	private _checkpoints: Map<string, ICheckpointDetail> = new Map();

	constructor(
		@IWorkspaceContextService private readonly _workspaceCtx: IWorkspaceContextService,
	) {
		super();
		this._loadFromDisk();
	}

	async createCheckpoint(label: string, filesChanged?: string[]): Promise<string> {
		const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const fs = this._requireFS();
		const _folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = _folders.length > 0 ? _folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');

		// Get changed files from git if not provided
		let changed = filesChanged ?? [];
		if (changed.length === 0) {
			changed = await this._getGitChangedFiles(cwd);
		}

		// Snapshot current content of changed files
		const diffs: Record<string, string> = {};
		const snapshots: Record<string, string> = {};

		for (const filePath of changed) {
			const fullPath = `${cwd}/${filePath}`;
			try {
				const content = fs.readFileSync(fullPath, 'utf8');
				snapshots[filePath] = content;
				diffs[filePath] = await this._getGitDiff(cwd, filePath);
			} catch {
				// file may not exist (new file)
				snapshots[filePath] = '';
			}
		}

		const detail: ICheckpointDetail = {
			id,
			label,
			timestamp: Date.now(),
			filesChanged: changed,
			diffs,
			fileSnapshots: snapshots,
		};

		this._checkpoints.set(id, detail);
		this._pruneOldCheckpoints();
		this._saveToDisk(detail);
		this._onCheckpointCreated.fire({ id, label, timestamp: detail.timestamp, filesChanged: changed });

		return id;
	}

	listCheckpoints(): ICheckpoint[] {
		return Array.from(this._checkpoints.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.map(({ id, label, timestamp, filesChanged, branchName, commitHash }) =>
				({ id, label, timestamp, filesChanged, branchName, commitHash }),
			);
	}

	async rewindTo(checkpointId: string): Promise<void> {
		const detail = this._checkpoints.get(checkpointId);
		if (!detail) {
			throw new Error(`Checkpoint ${checkpointId} not found. Use fw_checkpoint_list to see available checkpoints.`);
		}

		const fs = this._requireFS();
		const _folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = _folders.length > 0 ? _folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');

		// Restore file snapshots
		for (const [filePath, content] of Object.entries(detail.fileSnapshots)) {
			const fullPath = `${cwd}/${filePath}`;
			try {
				if (content === '') {
					// File was new at this checkpoint — remove it
					if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); }
				} else {
					// Ensure directory exists
					const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
					if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
					fs.writeFileSync(fullPath, content, 'utf8');
				}
			} catch (e) {
				throw new Error(`Failed to restore ${filePath}: ${(e as Error).message}`);
			}
		}

		this._onRewind.fire({ id: checkpointId, label: detail.label, timestamp: detail.timestamp, filesChanged: detail.filesChanged });
	}

	async forkFrom(checkpointId: string, branchName?: string): Promise<string> {
		const detail = this._checkpoints.get(checkpointId);
		if (!detail) {
			throw new Error(`Checkpoint ${checkpointId} not found.`);
		}

		const branch = branchName ?? `ni-fork-${checkpointId.replace('cp_', '').substring(0, 8)}`;
		const _folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = _folders.length > 0 ? _folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');
		const fs = this._requireFS();

		// Create new git branch from current HEAD
		await this._runGit(['checkout', '-b', branch], cwd);

		// Apply checkpoint file snapshots to the new branch
		for (const [filePath, content] of Object.entries(detail.fileSnapshots)) {
			const fullPath = `${cwd}/${filePath}`;
			try {
				if (content === '') {
					// File did not exist at checkpoint — remove it from this branch
					if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); }
				} else {
					const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
					if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
					fs.writeFileSync(fullPath, content, 'utf8');
				}
			} catch (e) {
				// Non-fatal — log but continue
				console.error(`[CheckpointService] Failed to restore ${filePath} on fork: ${(e as Error).message}`);
			}
		}

		// Stage and commit the restored files on the new branch
		if (Object.keys(detail.fileSnapshots).length > 0) {
			try {
				await this._runGit(['add', '-A'], cwd);
				await this._runGit(['commit', '-m', `[Neural Inverse] Checkpoint fork: ${detail.label}`], cwd);
			} catch {
				// Working tree may already match — commit failure is acceptable
			}
		}

		// Return to original branch
		await this._runGit(['checkout', '-'], cwd);

		// Update checkpoint with branch name
		detail.branchName = branch;
		this._checkpoints.set(checkpointId, detail);
		this._saveToDisk(detail);

		return branch;
	}

	getCheckpointDiff(checkpointId: string): ICheckpointDetail | null {
		return this._checkpoints.get(checkpointId) ?? null;
	}

	deleteCheckpoint(checkpointId: string): void {
		this._checkpoints.delete(checkpointId);
		const fs = this._requireFS();
		const path = `${CHECKPOINT_DIR}/${checkpointId}.json`;
		try {
			if (fs.existsSync(path)) { fs.unlinkSync(path); }
		} catch { /* ignore */ }
	}

	getStatus(): ICheckpointStatus {
		const checkpoints = Array.from(this._checkpoints.values());
		return {
			count: checkpoints.length,
			maxCheckpoints: MAX_CHECKPOINTS,
			oldestTimestamp: checkpoints.length > 0 ? Math.min(...checkpoints.map(c => c.timestamp)) : undefined,
			newestTimestamp: checkpoints.length > 0 ? Math.max(...checkpoints.map(c => c.timestamp)) : undefined,
		};
	}

	// ─── Storage ──────────────────────────────────────────────────────────────

	private _loadFromDisk(): void {
		const fs = this._requireFSSafe();
		if (!fs) { return; }

		const _folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = _folders.length > 0 ? _folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');
		const dir = `${cwd}/${CHECKPOINT_DIR}`;

		if (!fs.existsSync(dir)) { return; }

		try {
			const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
			for (const file of files) {
				try {
					const content = fs.readFileSync(`${dir}/${file}`, 'utf8');
					const detail = JSON.parse(content) as ICheckpointDetail;
					this._checkpoints.set(detail.id, detail);
				} catch { /* skip corrupt files */ }
			}
		} catch { /* directory not readable */ }
	}

	private _saveToDisk(detail: ICheckpointDetail): void {
		const fs = this._requireFSSafe();
		if (!fs) { return; }

		const _folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = _folders.length > 0 ? _folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');
		const dir = `${cwd}/${CHECKPOINT_DIR}`;

		try {
			if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
			fs.writeFileSync(`${dir}/${detail.id}.json`, JSON.stringify(detail, null, 2), 'utf8');
		} catch (e) {
			// Disk write failed — checkpoint is in-memory only. Log warning.
			console.warn(`[CheckpointService] Failed to persist checkpoint ${detail.id} to disk: ${(e as Error).message}. Checkpoint survives only until process restart.`);
		}
	}

	private _pruneOldCheckpoints(): void {
		if (this._checkpoints.size <= MAX_CHECKPOINTS) { return; }

		const sorted = Array.from(this._checkpoints.values())
			.sort((a, b) => a.timestamp - b.timestamp);

		const toDelete = sorted.slice(0, this._checkpoints.size - MAX_CHECKPOINTS);
		for (const cp of toDelete) {
			this.deleteCheckpoint(cp.id);
		}
	}

	// ─── Git helpers ──────────────────────────────────────────────────────────

	private async _getGitChangedFiles(cwd: string): Promise<string[]> {
		try {
			const output = await this._runGit(['diff', '--name-only', 'HEAD'], cwd);
			const staged = await this._runGit(['diff', '--cached', '--name-only'], cwd);
			const untracked = await this._runGit(['ls-files', '--others', '--exclude-standard'], cwd);
			return [...new Set([
				...output.split('\n'),
				...staged.split('\n'),
				...untracked.split('\n'),
			].filter(Boolean))];
		} catch {
			return [];
		}
	}

	private async _getGitDiff(cwd: string, filePath: string): Promise<string> {
		try {
			return await this._runGit(['diff', 'HEAD', '--', filePath], cwd);
		} catch {
			return '';
		}
	}

	private _runGit(args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const cp = (globalThis as Record<string, unknown>)['require']
				? (((globalThis as Record<string, unknown>)['require'] as (m: string) => unknown)('child_process') as typeof import('child_process'))
				: null;

			if (!cp) { resolve(''); return; }

			const proc = cp.spawn('git', args, { cwd, timeout: 10000 });
			let out = '';
			let err = '';

			proc.stdout?.on('data', (d: unknown) => { out += String(d); });
			proc.stderr?.on('data', (d: unknown) => { err += String(d); });

			proc.on('close', (code: number) => {
				if (code !== 0) { reject(new Error(err.trim() || `git ${args[0]} failed`)); }
				else { resolve(out.trim()); }
			});

			proc.on('error', (e: Error) => reject(e));
		});
	}

	private _requireFS(): typeof import('fs') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('Checkpoint service requires Node.js environment.'); }
		return (req as NodeRequire)('fs') as typeof import('fs');
	}

	private _requireFSSafe(): typeof import('fs') | null {
		try { return this._requireFS(); } catch { return null; }
	}
}


registerSingleton(ICheckpointService, CheckpointServiceImpl, InstantiationType.Delayed);
