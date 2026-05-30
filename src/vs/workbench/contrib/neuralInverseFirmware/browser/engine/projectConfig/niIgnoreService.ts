/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * .niignore File Edit Restriction Service
 *
 * Reads .niignore from workspace root (and subdirectories) to determine which
 * files the AI agent may NOT edit. Reading is always allowed — only edits blocked.
 *
 * Pattern syntax is gitignore-compatible:
 *   vendor/           — block all files under vendor/ directory
 *   *.bin             — block all .bin files at any depth
 *   **/generated/**   — block any path containing 'generated'
 *   !src/generated/config.h  — re-include (override parent block)
 *   # comment         — ignored
 *
 * Closer .niignore files (deeper in the directory tree) take precedence
 * over shallower ones — same precedence semantics as .gitignore.
 *
 * File is watched and reloads automatically when changed — no session restart.
 */

import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface INIIgnoreRule {
	pattern: string;
	negated: boolean;       // starts with !
	directory: boolean;     // ends with /
	anchored: boolean;      // starts with / (relative to file location)
	regex: RegExp;
	sourcePath: string;     // which .niignore file this came from
}

export interface INIIgnoreStatus {
	ruleCount: number;
	sourceFiles: string[];
	lastLoaded: number;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const INIIgnoreService = createDecorator<INIIgnoreService>('niIgnoreService');

export interface INIIgnoreService {
	readonly _serviceBrand: undefined;

	readonly onRulesChanged: Event<INIIgnoreStatus>;

	/** Check if a file path is blocked from editing. Read is always allowed. */
	isEditBlocked(filePath: string): boolean;

	/** Get all rules loaded from .niignore files. */
	getRules(): INIIgnoreRule[];

	/** Get service status. */
	getStatus(): INIIgnoreStatus;

	/** Force reload of all .niignore files. */
	reload(): Promise<void>;

	/** Get list of files in a directory that are edit-blocked. */
	listBlocked(dirPath: string): string[];
}


// ─── Implementation ───────────────────────────────────────────────────────────

class NIIgnoreServiceImpl extends Disposable implements INIIgnoreService {
	readonly _serviceBrand: undefined;

	private readonly _onRulesChanged = this._register(new Emitter<INIIgnoreStatus>());
	readonly onRulesChanged: Event<INIIgnoreStatus> = this._onRulesChanged.event;

	private _rules: INIIgnoreRule[] = [];
	private _sourceFiles: string[] = [];
	private _lastLoaded = 0;
	private _watchers: Array<ReturnType<typeof import('fs').watch>> = [];

	constructor(
		@IWorkspaceContextService private readonly _workspaceCtx: IWorkspaceContextService,
	) {
		super();
		this._initAsync();
	}

	private async _initAsync(): Promise<void> {
		try {
			await this.reload();
		} catch {
			// No .niignore yet
		}
	}

	isEditBlocked(filePath: string): boolean {
		if (this._rules.length === 0) { return false; }

		// Normalize path separators
		const normalized = filePath.replace(/\\/g, '/');

		let blocked = false;

		// Apply rules in order — last matching rule wins (gitignore semantics)
		for (const rule of this._rules) {
			if (rule.regex.test(normalized)) {
				blocked = !rule.negated;
			}
		}

		return blocked;
	}

	getRules(): INIIgnoreRule[] {
		return this._rules;
	}

	getStatus(): INIIgnoreStatus {
		return {
			ruleCount: this._rules.length,
			sourceFiles: this._sourceFiles,
			lastLoaded: this._lastLoaded,
		};
	}

	async reload(): Promise<void> {
		const fs = this._requireFS();
		const path = this._requirePath();

		this._rules = [];
		this._sourceFiles = [];

		// Close existing watchers
		for (const w of this._watchers) {
			try { w.close(); } catch { /* ignore */ }
		}
		this._watchers = [];

		// Use VS Code workspace root, not process.cwd() (which is the extension directory)
		const folders = this._workspaceCtx.getWorkspace().folders;
		const cwd = folders.length > 0 ? folders[0]!.uri.fsPath : (process?.cwd?.() ?? '.');
		const niIgnoreFiles = this._findNIIgnoreFiles(cwd, fs, path);

		for (const filePath of niIgnoreFiles) {
			try {
				const content = fs.readFileSync(filePath, 'utf8');
				const fileRules = this._parseFile(content, filePath);
				this._rules.push(...fileRules);
				this._sourceFiles.push(filePath);

				// Watch for changes
				const w = fs.watch(filePath, () => {
					setTimeout(() => this.reload().catch(() => {}), 300);
				});
				this._watchers.push(w);
			} catch {
				// file not readable — skip
			}
		}

		this._lastLoaded = Date.now();
		this._onRulesChanged.fire(this.getStatus());
	}

	listBlocked(dirPath: string): string[] {
		const fs = this._requireFS();
		const blocked: string[] = [];

		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = `${dirPath}/${entry.name}`;
				if (this.isEditBlocked(fullPath)) {
					blocked.push(fullPath);
				}
			}
		} catch {
			// directory not readable
		}

		return blocked;
	}

	// ─── Parser ───────────────────────────────────────────────────────────────

	private _parseFile(content: string, sourcePath: string): INIIgnoreRule[] {
		const rules: INIIgnoreRule[] = [];

		for (const rawLine of content.split('\n')) {
			const line = rawLine.trim();

			// Skip empty lines and comments
			if (!line || line.startsWith('#')) { continue; }

			const negated = line.startsWith('!');
			let pattern = negated ? line.slice(1) : line;

			// Trailing spaces stripped unless escaped
			pattern = pattern.replace(/(?<!\\)\s+$/, '');

			const directory = pattern.endsWith('/');
			if (directory) { pattern = pattern.slice(0, -1); }

			const anchored = pattern.startsWith('/');
			if (anchored) { pattern = pattern.slice(1); }

			const regex = this._patternToRegex(pattern, anchored, directory);

			rules.push({ pattern: rawLine.trim(), negated, directory, anchored, regex, sourcePath });
		}

		return rules;
	}

	private _patternToRegex(pattern: string, anchored: boolean, directory: boolean): RegExp {
		// Convert gitignore-style glob to RegExp

		// Escape special regex chars except * and ?
		let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

		// ** matches any path including /
		regexStr = regexStr.replace(/\*\*/g, '__DOUBLESTAR__');

		// * matches anything except /
		regexStr = regexStr.replace(/\*/g, '[^/]*');

		// ? matches any single char except /
		regexStr = regexStr.replace(/\?/g, '[^/]');

		// Restore ** as .*
		regexStr = regexStr.replace(/__DOUBLESTAR__/g, '.*');

		if (anchored) {
			// Pattern is relative to the workspace root
			regexStr = `^${regexStr}`;
		} else {
			// Pattern can match at any depth
			regexStr = `(^|/)${regexStr}`;
		}

		if (directory) {
			regexStr += `(/|$)`;
		} else {
			regexStr += `(/|$)`;
		}

		return new RegExp(regexStr, 'i');
	}

	// ─── File discovery ───────────────────────────────────────────────────────

	private _findNIIgnoreFiles(
		root: string,
		fs: typeof import('fs'),
		path: typeof import('path'),
	): string[] {
		const files: string[] = [];

		// Root .niignore
		const rootFile = path.join(root, '.niignore');
		if (fs.existsSync(rootFile)) { files.push(rootFile); }

		// Recursively find .niignore in subdirectories (max depth 5)
		this._walkDir(root, fs, path, files, 0, 5);

		return files;
	}

	private _walkDir(
		dir: string,
		fs: typeof import('fs'),
		path: typeof import('path'),
		result: string[],
		depth: number,
		maxDepth: number,
	): void {
		if (depth > maxDepth) { return; }

		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) { continue; }
				// Skip common non-project directories
				if (['node_modules', '.git', 'build', 'dist', '.cache'].includes(entry.name)) { continue; }

				const subDir = path.join(dir, entry.name);
				const niFile = path.join(subDir, '.niignore');
				if (fs.existsSync(niFile)) { result.push(niFile); }
				this._walkDir(subDir, fs, path, result, depth + 1, maxDepth);
			}
		} catch {
			// not readable
		}
	}

	private _requireFS(): typeof import('fs') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('NIIgnore requires Node.js environment.'); }
		return (req as NodeRequire)('fs') as typeof import('fs');
	}

	private _requirePath(): typeof import('path') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('NIIgnore requires Node.js environment.'); }
		return (req as NodeRequire)('path') as typeof import('path');
	}
}


registerSingleton(INIIgnoreService, NIIgnoreServiceImpl, InstantiationType.Delayed);
