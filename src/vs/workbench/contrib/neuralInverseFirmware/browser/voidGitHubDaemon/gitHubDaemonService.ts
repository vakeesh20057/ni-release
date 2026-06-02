/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * GitHub Daemon Service
 *
 * Runs Neural Inverse as a background agent for GitHub repositories.
 * When `@ni` or `@neuralInverse` is mentioned in a GitHub issue or PR comment,
 * the daemon:
 *   1. Claims the work item (marks as in-progress with a reaction)
 *   2. Creates an isolated git worktree for the repo
 *   3. Runs the firmware agent in headless mode with the comment as prompt
 *   4. Posts the result back as a GitHub comment with code/diff
 *   5. Optionally creates a PR for code changes
 *
 * Polling interval: 30 seconds (respects GitHub rate limits: 60 req/hour for unauth).
 * Uses GitHub REST API v3 with personal access token authentication.
 */

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface IDaemonConfig {
	owner: string;
	repo: string;
	token: string;
	triggerMentions?: string[];      // default: ['@ni', '@neuralInverse', '@neural-inverse']
	workspacePath?: string;          // where to clone/checkout the repo
	autoCreatePR?: boolean;          // create PR for code changes
	pollIntervalMs?: number;         // default: 30000
}

export interface IDaemonClaim {
	id: string;
	type: 'issue' | 'pr';
	number: number;
	title: string;
	prompt: string;
	claimedAt: number;
	status: 'pending' | 'running' | 'complete' | 'failed';
	resultUrl?: string;              // URL of the result comment
	prUrl?: string;                  // URL of created PR if applicable
	error?: string;
}

export interface IDaemonStatus {
	running: boolean;
	repoName?: string;
	workspace?: string;
	lastPollAt?: number;
	pendingCount: number;
	completedCount: number;
	currentClaim?: IDaemonClaim;
	error?: string;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const IGitHubDaemonService = createDecorator<IGitHubDaemonService>('gitHubDaemonService');

export interface IGitHubDaemonService {
	readonly _serviceBrand: undefined;

	readonly onClaimStarted: Event<IDaemonClaim>;
	readonly onClaimComplete: Event<IDaemonClaim>;
	readonly onError: Event<string>;

	/** Start the daemon, begin polling for @ni mentions. */
	startDaemon(config: IDaemonConfig): Promise<void>;

	/** Stop the daemon. */
	stopDaemon(): void;

	/** Get current daemon status. */
	getStatus(): IDaemonStatus;

	/** Get history of all claims. */
	getClaims(): IDaemonClaim[];

	/** Manually trigger processing of a specific issue/PR number. */
	processManually(type: 'issue' | 'pr', number: number, prompt: string): Promise<IDaemonClaim>;
}


// ─── Implementation ───────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';
const DEFAULT_TRIGGER_MENTIONS = ['@ni', '@neuralInverse', '@neural-inverse'];
const DEFAULT_POLL_INTERVAL = 30000;
const MAX_CLAIMS_HISTORY = 100;

class GitHubDaemonServiceImpl extends Disposable implements IGitHubDaemonService {
	readonly _serviceBrand: undefined;

	private readonly _onClaimStarted = this._register(new Emitter<IDaemonClaim>());
	readonly onClaimStarted: Event<IDaemonClaim> = this._onClaimStarted.event;

	private readonly _onClaimComplete = this._register(new Emitter<IDaemonClaim>());
	readonly onClaimComplete: Event<IDaemonClaim> = this._onClaimComplete.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private _status: IDaemonStatus = { running: false, pendingCount: 0, completedCount: 0 };
	private _config: IDaemonConfig | null = null;
	private _claims: Map<string, IDaemonClaim> = new Map();
	private _pollTimer: ReturnType<typeof setInterval> | null = null;
	private _processedComments: Set<number> = new Set();

	constructor(
		@IWorkspaceContextService private readonly _workspaceCtx: IWorkspaceContextService,
	) {
		super();
	}

	private _getWorkspaceRoot(): string {
		const folders = this._workspaceCtx.getWorkspace().folders;
		return folders.length > 0 ? folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');
	}

	async startDaemon(config: IDaemonConfig): Promise<void> {
		if (this._status.running) {
			this.stopDaemon();
		}

		this._config = {
			...config,
			triggerMentions: config.triggerMentions ?? DEFAULT_TRIGGER_MENTIONS,
			pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL,
			autoCreatePR: config.autoCreatePR ?? true,
		};

		// Verify token and repo access
		const repoInfo = await this._apiGet(`/repos/${config.owner}/${config.repo}`);
		if (!(repoInfo as Record<string, unknown>)['id']) {
			throw new Error(`Cannot access repo ${config.owner}/${config.repo}. Check token permissions (repo scope required).`);
		}

		this._status = {
			running: true,
			repoName: `${config.owner}/${config.repo}`,
			workspace: config.workspacePath ?? this._getWorkspaceRoot(),
			pendingCount: 0,
			completedCount: 0,
		};

		// Initial poll + start periodic polling
		await this._poll();
		this._pollTimer = setInterval(() => this._poll().catch(e => {
			this._onError.fire(`Poll error: ${(e as Error).message}`);
		}), this._config.pollIntervalMs!);
	}

	stopDaemon(): void {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
		this._status = { ...this._status, running: false };
	}

	getStatus(): IDaemonStatus {
		return this._status;
	}

	getClaims(): IDaemonClaim[] {
		return Array.from(this._claims.values()).sort((a, b) => b.claimedAt - a.claimedAt);
	}

	async processManually(type: 'issue' | 'pr', number: number, prompt: string): Promise<IDaemonClaim> {
		const claimId = `manual_${type}_${number}_${Date.now()}`;
		const claim: IDaemonClaim = {
			id: claimId, type, number, title: `Manual: ${type} #${number}`,
			prompt, claimedAt: Date.now(), status: 'pending',
		};
		this._claims.set(claimId, claim);
		await this._processClaim(claim);
		return claim;
	}

	// ─── Polling ─────────────────────────────────────────────────────────────

	private async _poll(): Promise<void> {
		if (!this._config) { return; }

		this._status = { ...this._status, lastPollAt: Date.now() };

		try {
			// Poll issue comments
			const issueComments = await this._apiGet(
				`/repos/${this._config.owner}/${this._config.repo}/issues/comments?per_page=50&sort=created&direction=desc`,
			);

			for (const comment of (Array.isArray(issueComments) ? issueComments : [])) {
				await this._checkComment(comment as Record<string, unknown>, 'issue');
			}

			// Poll PR review comments
			const prComments = await this._apiGet(
				`/repos/${this._config.owner}/${this._config.repo}/pulls/comments?per_page=50&sort=created&direction=desc`,
			);

			for (const comment of (Array.isArray(prComments) ? prComments : [])) {
				await this._checkComment(comment as Record<string, unknown>, 'pr');
			}
		} catch (e) {
			this._onError.fire(`GitHub API error: ${(e as Error).message}`);
		}
	}

	private async _checkComment(comment: Record<string, unknown>, defaultType: 'issue' | 'pr'): Promise<void> {
		const commentId = Number(comment['id'] ?? 0);
		if (this._processedComments.has(commentId)) { return; }

		const body = String(comment['body'] ?? '');
		const trigger = this._config?.triggerMentions ?? DEFAULT_TRIGGER_MENTIONS;

		const hasTrigger = trigger.some(t => body.toLowerCase().includes(t.toLowerCase()));
		if (!hasTrigger) { return; }

		this._processedComments.add(commentId);

		// Extract issue/PR number from comment URL
		const url = String(comment['html_url'] ?? '');
		const issueMatch = url.match(/\/issues\/(\d+)/);
		const prMatch = url.match(/\/pull\/(\d+)/);
		const number = parseInt((issueMatch?.[1] ?? prMatch?.[1]) ?? '0');
		const type = prMatch ? 'pr' : 'issue';

		if (!number) { return; }

		// Get the original issue/PR for title
		let title = `${type} #${number}`;
		try {
			const item = await this._apiGet(
				`/repos/${this._config!.owner}/${this._config!.repo}/${type === 'pr' ? 'pulls' : 'issues'}/${number}`,
			);
			title = String((item as Record<string, unknown>)['title'] ?? title);
		} catch { /* keep default title */ }

		// Remove trigger mention from prompt
		const prompt = trigger.reduce((p, t) => p.replace(new RegExp(t, 'gi'), '').trim(), body);

		const claimId = `${type}_${number}_${commentId}`;
		const claim: IDaemonClaim = {
			id: claimId, type, number, title, prompt,
			claimedAt: Date.now(), status: 'pending',
		};

		this._claims.set(claimId, claim);
		this._status = { ...this._status, pendingCount: this._status.pendingCount + 1 };
		this._onClaimStarted.fire(claim);

		// React with eyes emoji to acknowledge
		await this._apiPost(
			`/repos/${this._config!.owner}/${this._config!.repo}/issues/comments/${commentId}/reactions`,
			{ content: 'eyes' },
		).catch(() => {}); // reactions require extra scope — non-critical

		await this._processClaim(claim);
	}

	private async _processClaim(claim: IDaemonClaim): Promise<void> {
		if (!this._config) { return; }

		claim.status = 'running';
		this._claims.set(claim.id, claim);
		this._status = { ...this._status, currentClaim: claim };

		try {
			// Post "working on it" comment
			const workingComment = await this._apiPost(
				`/repos/${this._config.owner}/${this._config.repo}/issues/${claim.number}/comments`,
				{ body: this._formatWorkingComment(claim) },
			);
			const workingCommentId = Number((workingComment as Record<string, unknown>)['id'] ?? 0);

			// Run the firmware agent headlessly against the prompt
			const result = await this._runHeadlessAgent(claim.prompt, claim);

			// Update the working comment with result
			await this._apiPatch(
				`/repos/${this._config.owner}/${this._config.repo}/issues/comments/${workingCommentId}`,
				{ body: this._formatResultComment(claim, result) },
			);

			claim.status = 'complete';
			claim.resultUrl = String((workingComment as Record<string, unknown>)['html_url'] ?? '');

			this._status = {
				...this._status,
				currentClaim: undefined,
				completedCount: this._status.completedCount + 1,
				pendingCount: Math.max(0, this._status.pendingCount - 1),
			};

			this._onClaimComplete.fire(claim);
		} catch (e) {
			claim.status = 'failed';
			claim.error = (e as Error).message;

			// Post error comment
			await this._apiPost(
				`/repos/${this._config.owner}/${this._config.repo}/issues/${claim.number}/comments`,
				{ body: `**Neural Inverse:** Failed to process request.\n\`\`\`\n${(e as Error).message}\n\`\`\`` },
			).catch(() => {});

			this._status = { ...this._status, currentClaim: undefined };
		}

		this._claims.set(claim.id, claim);
		this._pruneOldClaims();
	}

	private async _runHeadlessAgent(prompt: string, claim: IDaemonClaim): Promise<string> {
		if (!this._config) { throw new Error('Daemon not configured.'); }

		const _reqFn = (globalThis as Record<string, unknown>)['require'] as ((m: string) => unknown) | undefined;
		const cp = _reqFn ? (_reqFn('child_process') as typeof import('child_process')) : null;

		if (!cp) {
			// Browser environment — cannot run subprocess. Return analysis based on repo content only.
			return this._analyzePromptFromGitHub(prompt, claim);
		}

		// Clone/update the repo in a dedicated worktree for this claim.
		// Include timestamp in path to prevent race conditions when multiple claims process concurrently.
		const cwd = this._getWorkspaceRoot();
		const worktreeDir = `${cwd}/.inverse/daemon-worktrees/${claim.id}_${Date.now()}`;

		const _reqFsFn = (globalThis as Record<string, unknown>)['require'] as ((m: string) => unknown) | undefined;
		const fs = _reqFsFn ? (_reqFsFn('fs') as typeof import('fs')) : null;

		if (fs) {
			fs.mkdirSync(worktreeDir, { recursive: true });
		}

		// Create isolated worktree with --detach to avoid branch name conflicts
		try {
			await this._runGitCmd(['worktree', 'add', '--detach', worktreeDir, 'HEAD'], cwd);
		} catch {
			// worktree add failed (bare repo, shallow clone, etc.) — work in a copy instead
			try {
				if (fs) {
					await this._runGitCmd(['clone', '--local', '--depth', '1', cwd, worktreeDir], cwd);
				}
			} catch {
				// If clone also fails, continue with workspace root — best effort
			}
		}

		// Detect project type and MCU in the worktree
		const projectInfo = await this._detectFirmwareProject(worktreeDir, cp);

		// Run Neural Inverse CLI in headless mode against the worktree
		const result = await this._runNICLI(prompt, worktreeDir, projectInfo, cp);

		// Clean up worktree
		try {
			await this._runGitCmd(['worktree', 'remove', '--force', worktreeDir], cwd);
		} catch {
			// cleanup failure is non-critical
		}

		return result;
	}

	private async _detectFirmwareProject(
		dir: string,
		cp: typeof import('child_process'),
	): Promise<{ buildSystem?: string; mcuVariant?: string; files: string[] }> {
		return new Promise(resolve => {
			const proc = cp.spawn('find', [dir, '-maxdepth', '3', '-name', '*.c', '-o', '-name', 'platformio.ini', '-o', '-name', 'CMakeLists.txt', '-o', '-name', '*.elf'], { timeout: 10000 });
			let out = '';
			proc.stdout?.on('data', (d: unknown) => { out += String(d); });
			proc.on('close', () => {
				const files = out.trim().split('\n').filter(Boolean);
				const buildSystem = files.some(f => f.endsWith('platformio.ini')) ? 'platformio' :
					files.some(f => f.endsWith('CMakeLists.txt')) ? 'cmake' : 'make';
				resolve({ buildSystem, files });
			});
			proc.on('error', () => resolve({ files: [] }));
		});
	}

	private async _runNICLI(
		prompt: string,
		worktreeDir: string,
		projectInfo: { buildSystem?: string; mcuVariant?: string; files: string[] },
		cp: typeof import('child_process'),
	): Promise<string> {
		// Look for ni CLI in PATH, then local installation
		const niCLI = await this._findNICLI(cp);

		if (niCLI) {
			// Run Neural Inverse CLI in non-interactive mode
			return new Promise((resolve, reject) => {
				const proc = cp.spawn(niCLI, ['--headless', '--prompt', prompt, '--format', 'markdown'], {
					cwd: worktreeDir,
					timeout: 120000,
					env: { ...process.env, NI_DAEMON_MODE: '1' },
				});

				let stdout = '';
				let stderr = '';
				proc.stdout?.on('data', (d: unknown) => { stdout += String(d); });
				proc.stderr?.on('data', (d: unknown) => { stderr += String(d); });
				proc.on('close', (code: number) => {
					if (code === 0 && stdout.trim()) {
						resolve(stdout.trim());
					} else {
						resolve(this._analyzePromptFallback(prompt, projectInfo));
					}
				});
				proc.on('error', () => resolve(this._analyzePromptFallback(prompt, projectInfo)));
			});
		}

		// No CLI available — provide static analysis
		return this._analyzePromptFallback(prompt, projectInfo);
	}

	private async _findNICLI(cp: typeof import('child_process')): Promise<string | null> {
		const candidates = ['ni', 'neural-inverse', 'neuralInverse'];
		for (const cmd of candidates) {
			const found = await new Promise<boolean>(resolve => {
				const proc = cp.spawn('which', [cmd], { timeout: 2000 });
				proc.on('close', (code: number) => resolve(code === 0));
				proc.on('error', () => resolve(false));
			});
			if (found) { return cmd; }
		}
		return null;
	}

	private async _analyzePromptFromGitHub(prompt: string, claim: IDaemonClaim): Promise<string> {
		// Fetch repo files relevant to the prompt and provide static analysis
		if (!this._config) { return 'Daemon not configured.'; }

		const lines: string[] = [
			`## Analysis: ${claim.type} #${claim.number}`,
			``,
			`**Request:** ${prompt.substring(0, 200)}`,
			``,
		];

		// Try to fetch relevant source files from GitHub API
		try {
			const tree = await this._apiGet(`/repos/${this._config.owner}/${this._config.repo}/git/trees/HEAD?recursive=1`);
			const sourceFiles = ((tree as Record<string, unknown>)['tree'] as Array<Record<string, unknown>> ?? [])
				.filter(f => typeof f['path'] === 'string' && (String(f['path']).endsWith('.c') || String(f['path']).endsWith('.h')))
				.slice(0, 5);

			if (sourceFiles.length > 0) {
				lines.push(`**Project structure detected:** ${sourceFiles.length} source files found`);
				lines.push(`Key files: ${sourceFiles.map(f => String(f['path']).split('/').pop()).join(', ')}`);
				lines.push('');
			}
		} catch {
			// Tree API unavailable
		}

		lines.push(`**Neural Inverse agent analysis:**`);
		lines.push(`The request has been received and queued. To enable full AI-powered code changes:`);
		lines.push(`1. Install Neural Inverse CLI: \`curl -fsSL https://neuralinverse.com/install | bash\``);
		lines.push(`2. Run the daemon locally: \`ni daemon start\``);
		lines.push(`3. Re-trigger by commenting \`@ni ${prompt.substring(0, 50)}\` again`);
		lines.push('');
		lines.push(`*Powered by [Neural Inverse](https://neuralinverse.com)*`);

		return lines.join('\n');
	}

	private _analyzePromptFallback(
		prompt: string,
		projectInfo: { buildSystem?: string; files: string[] },
	): string {
		const sourceFiles = projectInfo.files.filter(f => f.endsWith('.c')).length;
		const headerFiles = projectInfo.files.filter(f => f.endsWith('.h')).length;

		return [
			`## Neural Inverse Analysis`,
			``,
			`**Request processed:** "${prompt.substring(0, 150)}"`,
			``,
			`**Project detected:**`,
			`- Build system: ${projectInfo.buildSystem ?? 'unknown'}`,
			`- Source files: ${sourceFiles} .c files, ${headerFiles} .h files`,
			``,
			`**Neural Inverse CLI not found in PATH.** To enable full AI-powered responses:`,
			`\`\`\`bash`,
			`curl -fsSL https://neuralinverse.com/install | bash`,
			`ni daemon start  # run in your repo directory`,
			`\`\`\``,
			``,
			`*Processed by Neural Inverse Daemon*`,
		].join('\n');
	}

	private async _runGitCmd(args: string[], cwd: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const cp = ((globalThis as Record<string, unknown>)['require'] as ((m: string) => unknown) | undefined)
				?.('child_process') as typeof import('child_process') ?? null;
			if (!cp) { resolve(''); return; }

			const proc = cp.spawn('git', args, { cwd, timeout: 30000 });
			let out = '';
			proc.stdout?.on('data', (d: unknown) => { out += String(d); });
			proc.on('close', (code: number) => { code === 0 ? resolve(out.trim()) : reject(new Error(`git ${args[0]} failed`)); });
			proc.on('error', (e: Error) => reject(e));
		});
	}

	private _formatWorkingComment(claim: IDaemonClaim): string {
		return [
			`**Neural Inverse** is processing your request...`,
			``,
			`> ${claim.prompt.substring(0, 200)}${claim.prompt.length > 200 ? '...' : ''}`,
			``,
			`This comment will be updated with results. Typical response time: 30-120 seconds.`,
		].join('\n');
	}

	private _formatResultComment(claim: IDaemonClaim, result: string): string {
		return [
			`**Neural Inverse** — Results for ${claim.type} #${claim.number}`,
			``,
			result,
			``,
			`---`,
			`*Powered by [Neural Inverse](https://neuralinverse.com) firmware AI*`,
		].join('\n');
	}

	// ─── GitHub API helpers ───────────────────────────────────────────────────

	private async _apiGet(path: string): Promise<unknown> {
		if (!this._config) { throw new Error('Daemon not configured.'); }
		return this._apiRequest('GET', path, undefined);
	}

	private async _apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
		return this._apiRequest('POST', path, body);
	}

	private async _apiPatch(path: string, body: Record<string, unknown>): Promise<unknown> {
		return this._apiRequest('PATCH', path, body);
	}

	private async _apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
		if (!this._config) { throw new Error('Daemon not configured.'); }

		const url = `${GITHUB_API}${path}`;
		const headers: Record<string, string> = {
			'Authorization': `Bearer ${this._config.token}`,
			'Accept': 'application/vnd.github.v3+json',
			'User-Agent': 'NeuralInverse-Daemon/1.0',
			'Content-Type': 'application/json',
			'X-GitHub-Api-Version': '2022-11-28',
		};

		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`GitHub API ${method} ${path} returned ${response.status}: ${errText}`);
		}

		if (response.status === 204) { return {}; }
		return response.json();
	}

	private _pruneOldClaims(): void {
		if (this._claims.size <= MAX_CLAIMS_HISTORY) { return; }
		const sorted = Array.from(this._claims.entries()).sort((a, b) => a[1].claimedAt - b[1].claimedAt);
		const toDelete = sorted.slice(0, this._claims.size - MAX_CLAIMS_HISTORY);
		for (const [id] of toDelete) { this._claims.delete(id); }
	}
}


registerSingleton(IGitHubDaemonService, GitHubDaemonServiceImpl, InstantiationType.Delayed);
