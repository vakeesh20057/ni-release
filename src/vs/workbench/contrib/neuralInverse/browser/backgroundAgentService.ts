/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
	IBackgroundTask,
	IBackgroundTaskRequest,
	BackgroundTaskStatus,
	MAX_CONCURRENT_BACKGROUND_AGENTS,
} from '../common/backgroundAgentTypes.js';

// ─── Service Interface ────────────────────────────────────────────────────────

export const IBackgroundAgentService = createDecorator<IBackgroundAgentService>('backgroundAgentService');

export interface IBackgroundAgentService {
	readonly _serviceBrand: undefined;
	readonly tasks: ReadonlyMap<string, IBackgroundTask>;
	readonly onDidChangeTask: Event<IBackgroundTask>;
	readonly runningCount: number;

	spawn(request: IBackgroundTaskRequest): IBackgroundTask;
	cancel(taskId: string): void;
	getTaskDiff(taskId: string): Promise<string>;
	removeTask(taskId: string): void;
}

// ─── Implementation ──────────────────────────────────────────────────────────

class BackgroundAgentService extends Disposable implements IBackgroundAgentService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeTask = this._register(new Emitter<IBackgroundTask>());
	readonly onDidChangeTask = this._onDidChangeTask.event;

	private readonly _tasks = new Map<string, IBackgroundTask>();
	private readonly _cancellations = new Map<string, { cancelled: boolean }>();
	private readonly _queue: string[] = [];
	private _running = 0;

	get tasks(): ReadonlyMap<string, IBackgroundTask> { return this._tasks; }
	get runningCount() { return this._running; }

	constructor(
		@IWorkspaceContextService private readonly _workspaceContext: IWorkspaceContextService,
	) {
		super();
	}

	spawn(request: IBackgroundTaskRequest): IBackgroundTask {
		const id = generateUuid().slice(0, 8);
		const branchName = request.branchName || `ni/bg/${id}`;
		const baseBranch = request.baseBranch || 'HEAD';
		const worktreePath = `/tmp/ni-bg-${id}`;

		const task: IBackgroundTask = {
			id,
			request,
			status: 'queued',
			branchName,
			baseBranch,
			worktreePath,
			progress: [],
			commits: [],
		};

		this._tasks.set(id, task);
		this._queue.push(id);
		this._onDidChangeTask.fire(task);
		this._drain();
		return task;
	}

	cancel(taskId: string): void {
		const task = this._tasks.get(taskId);
		if (!task) return;

		const token = this._cancellations.get(taskId);
		if (token) { token.cancelled = true; }

		const queueIdx = this._queue.indexOf(taskId);
		if (queueIdx >= 0) { this._queue.splice(queueIdx, 1); }

		if (task.status !== 'completed' && task.status !== 'failed') {
			this._setStatus(task, 'cancelled');
			this._cleanup(task);
		}
	}

	async getTaskDiff(taskId: string): Promise<string> {
		const task = this._tasks.get(taskId);
		if (!task) return '';
		const folder = this._getWorkspaceRoot();
		if (!folder) return '';
		const result = await this._gitExec(['diff', `${task.baseBranch}...${task.branchName}`], folder);
		return result.stdout;
	}

	removeTask(taskId: string): void {
		const task = this._tasks.get(taskId);
		if (!task) return;
		if (task.status === 'running' || task.status === 'branching' || task.status === 'committing') {
			this.cancel(taskId);
		}
		this._tasks.delete(taskId);
		this._cancellations.delete(taskId);
		this._onDidChangeTask.fire(task);
	}

	// ─── Internal ────────────────────────────────────────────────────────────

	private _drain(): void {
		while (this._running < MAX_CONCURRENT_BACKGROUND_AGENTS && this._queue.length > 0) {
			const taskId = this._queue.shift()!;
			const task = this._tasks.get(taskId);
			if (!task || task.status === 'cancelled') continue;
			this._running++;
			this._executeTask(task).finally(() => {
				this._running--;
				this._drain();
			});
		}
	}

	private async _executeTask(task: IBackgroundTask): Promise<void> {
		const cancellation = { cancelled: false };
		this._cancellations.set(task.id, cancellation);

		const folder = this._getWorkspaceRoot();
		if (!folder) {
			task.error = 'No workspace folder open';
			this._setStatus(task, 'failed');
			return;
		}

		try {
			// 1. Create worktree + branch
			this._setStatus(task, 'branching');
			task.startedAt = Date.now();

			const baseBranch = task.baseBranch === 'HEAD' ? await this._getCurrentBranch(folder) : task.baseBranch;
			task.baseBranch = baseBranch;

			const worktreeResult = await this._gitExec(
				['worktree', 'add', task.worktreePath, '-b', task.branchName],
				folder
			);
			if (worktreeResult.exitCode !== 0) {
				throw new Error(`git worktree add failed: ${worktreeResult.stderr}`);
			}
			task.progress.push(`Created worktree at ${task.worktreePath}`);
			task.progress.push(`Branch: ${task.branchName} (base: ${baseBranch})`);
			this._onDidChangeTask.fire(task);

			if (cancellation.cancelled) { this._setStatus(task, 'cancelled'); return; }

			// 2. Run agent — uses the workflow orchestrator for LLM-driven tool execution.
			// The agent reads/writes files in the worktree and commits its changes.
			this._setStatus(task, 'running');
			task.progress.push('Agent started — executing task...');
			this._onDidChangeTask.fire(task);

			// TODO: Wire WorkflowOrchestrator.run() here once tool CWD override is supported.
			// For now, background agents execute via a simpler loop that's being built.
			// The service infrastructure (worktree, queue, cancel, UI) is fully functional.
			await this._runAgentLoop(task, cancellation);

			if (cancellation.cancelled) { this._setStatus(task, 'cancelled'); return; }

			// 3. Final commit if uncommitted changes exist
			this._setStatus(task, 'committing');
			const statusResult = await this._gitExec(['status', '--porcelain'], task.worktreePath);
			if (statusResult.stdout.trim()) {
				await this._gitExec(['add', '-A'], task.worktreePath);
				await this._gitExec(['commit', '-m', 'chore: final uncommitted changes'], task.worktreePath);
			}

			// 4. Capture commits
			const logResult = await this._gitExec(
				['log', `${task.baseBranch}..${task.branchName}`, '--oneline'],
				task.worktreePath
			);
			task.commits = logResult.stdout.trim().split('\n').filter(Boolean);
			task.progress.push(`Completed with ${task.commits.length} commit(s)`);

			// 5. Optional PR (safe — uses execFile with array args, no shell injection)
			if (task.request.createPR) {
				const pushResult = await this._gitExec(['push', '-u', 'origin', task.branchName], folder);
				if (pushResult.exitCode !== 0) {
					task.progress.push(`Push failed: ${pushResult.stderr}`);
				} else {
					const prResult = await this._ghExec([
						'pr', 'create',
						'--title', task.request.title,
						'--body', `Background agent task: ${task.request.description}`,
						'--head', task.branchName,
					], folder);
					task.progress.push(prResult.exitCode === 0 ? `PR created: ${prResult.stdout.trim()}` : `PR failed: ${prResult.stderr}`);
				}
			}

			task.completedAt = Date.now();
			this._setStatus(task, 'completed');

		} catch (e: any) {
			task.error = e.message;
			task.completedAt = Date.now();
			this._setStatus(task, 'failed');
		} finally {
			this._cleanup(task);
		}
	}

	private async _runAgentLoop(_task: IBackgroundTask, _cancellation: { cancelled: boolean }): Promise<void> {
		// Placeholder: The actual LLM agent loop will be wired here.
		// It will use ILLMMessageService + tool registry with CWD set to worktreePath.
		// For now the service handles the full lifecycle (branch, worktree, commit, cleanup)
		// and the agent execution is pending proper CWD-scoped tool support.
		_task.progress.push('Agent execution pending — orchestrator CWD support required');
		this._onDidChangeTask.fire(_task);
	}

	private async _cleanup(task: IBackgroundTask): Promise<void> {
		const folder = this._getWorkspaceRoot();
		if (!folder) return;
		try {
			await this._gitExec(['worktree', 'remove', task.worktreePath, '--force'], folder);
		} catch {
			// Best effort
		}
	}

	private _setStatus(task: IBackgroundTask, status: BackgroundTaskStatus): void {
		task.status = status;
		this._onDidChangeTask.fire(task);
	}

	private _getWorkspaceRoot(): string | undefined {
		const folders = this._workspaceContext.getWorkspace().folders;
		return folders[0]?.uri.fsPath;
	}

	private async _getCurrentBranch(cwd: string): Promise<string> {
		const result = await this._gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
		return result.stdout.trim() || 'main';
	}

	private async _gitExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return this._execFileAsync('git', args, cwd);
	}

	private async _ghExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return this._execFileAsync('gh', args, cwd);
	}

	private async _execFileAsync(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		const nodeRequire = (globalThis as any).require as NodeRequire | undefined;
		if (!nodeRequire) {
			throw new Error('Background agents require Node.js integration (not available in web).');
		}

		const { execFile } = nodeRequire('child_process') as typeof import('child_process');
		const { promisify } = nodeRequire('util') as typeof import('util');
		const execFileAsync = promisify(execFile);

		try {
			const { stdout, stderr } = await execFileAsync(cmd, args, {
				cwd,
				timeout: 60_000,
				maxBuffer: 4 * 1024 * 1024,
			});
			return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
		} catch (e: any) {
			return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
		}
	}
}

registerSingleton(IBackgroundAgentService, BackgroundAgentService, InstantiationType.Delayed);
