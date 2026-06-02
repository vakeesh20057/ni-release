/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NI.md Project Configuration Service
 *
 * Reads NI.md from the workspace root and auto-injects its contents into
 * the firmware AI system prompt at session start. This gives teams a persistent
 * way to encode project-specific rules, build commands, and constraints without
 * repeating them in every prompt.
 *
 * File format (Markdown with ## section headers):
 *   ## Build
 *   Build command: platformio run -e release
 *   Flash command: platformio upload
 *
 *   ## Debug
 *   Debug interface: jlink
 *   Target MCU: STM32F407VGT6
 *
 *   ## Rules
 *   - Always use MISRA C:2012 naming conventions
 *   - Peripheral drivers go in src/drivers/
 *
 *   ## IMPORTANT
 *   Never modify generated SVD files in src/svd/
 *
 * IMPORTANT rules get priority treatment in the system prompt.
 * File is watched and reloaded automatically when changed.
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface INIMdConfig {
	buildCommand?: string;
	flashCommand?: string;
	testCommand?: string;
	debugInterface?: string;
	targetMCU?: string;
	rules: string[];
	importantRules: string[];
	rawSections: Record<string, string>;
	lastModified: number;
}

export const EMPTY_NI_MD_CONFIG: INIMdConfig = {
	rules: [],
	importantRules: [],
	rawSections: {},
	lastModified: 0,
};


// ─── Service interface ────────────────────────────────────────────────────────

export const INIMdService = createDecorator<INIMdService>('niMdService');

export interface INIMdService {
	readonly _serviceBrand: undefined;

	readonly onConfigChanged: Event<INIMdConfig>;

	/** Load or reload NI.md from workspace root. */
	load(): Promise<INIMdConfig>;

	/** Get current config (may be empty if no NI.md). */
	getConfig(): INIMdConfig;

	/** Generate a default NI.md file from the active session context. */
	generateDefault(): Promise<string>;

	/** Get formatted string for injection into AI system prompt. */
	getSystemPromptSection(): string;

	/** Check if NI.md exists in workspace root. */
	exists(): Promise<boolean>;
}


// ─── Implementation ───────────────────────────────────────────────────────────

class NIMdServiceImpl extends Disposable implements INIMdService {
	readonly _serviceBrand: undefined;

	private readonly _onConfigChanged = this._register(new Emitter<INIMdConfig>());
	readonly onConfigChanged: Event<INIMdConfig> = this._onConfigChanged.event;

	private _config: INIMdConfig = { ...EMPTY_NI_MD_CONFIG };
	private _watcher: ReturnType<typeof import('fs').watch> | null = null;

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
		@IWorkspaceContextService private readonly _workspaceCtx: IWorkspaceContextService,
	) {
		super();
		// Synchronous load attempt first (returns immediately if file exists)
		this._loadSync();
		// Then async for watch setup
		this._initAsync();
	}

	private _loadSync(): void {
		try {
			const fs = this._requireFS();
			const path = this._getPath();
			if (fs.existsSync(path)) {
				const content = fs.readFileSync(path, 'utf8');
				const stat = fs.statSync(path);
				this._config = this._parse(content, stat.mtimeMs);
			}
		} catch {
			// NI.md not readable — use empty config
		}
	}

	private async _initAsync(): Promise<void> {
		try {
			await this.load();
			this._watchFile();
		} catch {
			// No NI.md yet — that is fine
		}
	}

	async load(): Promise<INIMdConfig> {
		const path = this._getPath();
		const fs = this._requireFS();

		if (!fs.existsSync(path)) {
			this._config = { ...EMPTY_NI_MD_CONFIG };
			return this._config;
		}

		const content = fs.readFileSync(path, 'utf8');
		const stat = fs.statSync(path);
		this._config = this._parse(content, stat.mtimeMs);
		this._onConfigChanged.fire(this._config);
		return this._config;
	}

	getConfig(): INIMdConfig {
		return this._config;
	}

	async generateDefault(): Promise<string> {
		const s = this._session.session;
		const mcu = s.mcuConfig;
		const project = s.projectInfo;

		const lines = [
			`# NI.md — Neural Inverse Project Configuration`,
			`# Auto-generated. Edit to customize AI behavior for this project.`,
			``,
			`## Build`,
		];

		if (project?.buildSystem === 'platformio') {
			lines.push(`Build command: platformio run`);
			lines.push(`Flash command: platformio upload`);
			lines.push(`Test command: platformio test`);
		} else if (project?.buildSystem === 'cmake') {
			lines.push(`Build command: cmake --build build/`);
			lines.push(`Flash command: openocd -f interface/stlink.cfg -f target/${mcu?.family?.toLowerCase() ?? 'stm32f4x'}.cfg -c "program build/firmware.elf verify reset exit"`);
		} else if (project?.buildSystem === 'esp-idf') {
			lines.push(`Build command: idf.py build`);
			lines.push(`Flash command: idf.py flash`);
		} else if (project?.buildSystem === 'zephyr') {
			lines.push(`Build command: west build`);
			lines.push(`Flash command: west flash`);
		} else {
			lines.push(`Build command: make`);
			lines.push(`Flash command: # add flash command`);
		}

		lines.push(``);
		lines.push(`## Debug`);

		if (mcu) {
			lines.push(`Target MCU: ${mcu.variant}`);
			lines.push(`Debug interface: ${mcu.family?.startsWith('NRF') ? 'jlink' : 'stlink'}`);
		}

		lines.push(``);
		lines.push(`## Naming`);
		lines.push(`# Add naming conventions here, e.g.:`);
		lines.push(`# - Driver files: src/drivers/<peripheral>_drv.c`);
		lines.push(`# - ISR names: <PERIPHERAL>_IRQHandler`);

		lines.push(``);
		lines.push(`## Rules`);
		lines.push(`# Project-specific rules for the AI:`);

		if (s.complianceFrameworks?.some(f => f.includes('misra'))) {
			lines.push(`- Follow MISRA C:2012 rules — no dynamic allocation, no recursion`);
		}
		if (mcu?.family?.startsWith('STM32')) {
			lines.push(`- Use HAL library functions for peripheral init, LL for performance-critical paths`);
		}
		lines.push(`- New peripheral drivers must have corresponding unit tests`);
		lines.push(`- All public functions must have Doxygen comments`);

		lines.push(``);
		lines.push(`## IMPORTANT`);
		lines.push(`# Critical rules (highest priority in AI context):`);
		lines.push(`- Never modify files in vendor/ or third_party/ directories`);
		lines.push(`- Always check fw_check_pin_conflicts before adding new peripheral pins`);

		const content = lines.join('\n');

		// Write to workspace
		const fs2 = this._requireFS();
		const path = this._getPath();
		fs2.writeFileSync(path, content, 'utf8');
		await this.load();

		return content;
	}

	getSystemPromptSection(): string {
		if (this._config.rules.length === 0 && this._config.importantRules.length === 0 && Object.keys(this._config.rawSections).length === 0) {
			return '';
		}

		const parts: string[] = [];

		if (this._config.importantRules.length > 0) {
			parts.push('== IMPORTANT PROJECT RULES (highest priority) ==');
			for (const rule of this._config.importantRules) {
				parts.push(`  [!] ${rule}`);
			}
			parts.push('');
		}

		if (this._config.buildCommand || this._config.flashCommand) {
			parts.push('== Project Build ==');
			if (this._config.buildCommand) { parts.push(`  Build:  ${this._config.buildCommand}`); }
			if (this._config.flashCommand) { parts.push(`  Flash:  ${this._config.flashCommand}`); }
			if (this._config.testCommand)  { parts.push(`  Test:   ${this._config.testCommand}`); }
			parts.push('');
		}

		if (this._config.debugInterface || this._config.targetMCU) {
			parts.push('== Debug Config ==');
			if (this._config.targetMCU)       { parts.push(`  MCU:       ${this._config.targetMCU}`); }
			if (this._config.debugInterface)   { parts.push(`  Interface: ${this._config.debugInterface}`); }
			parts.push('');
		}

		if (this._config.rules.length > 0) {
			parts.push('== Project Rules ==');
			for (const rule of this._config.rules) {
				parts.push(`  - ${rule}`);
			}
			parts.push('');
		}

		if (Object.keys(this._config.rawSections).length > 0) {
			for (const [section, content] of Object.entries(this._config.rawSections)) {
				const skip = ['Build', 'Debug', 'Rules', 'IMPORTANT', 'Naming'];
				if (!skip.includes(section) && content.trim()) {
					parts.push(`== ${section} ==`);
					parts.push(content.trim());
					parts.push('');
				}
			}
		}

		return parts.length > 0 ? `[NI.md Project Config]\n${parts.join('\n')}` : '';
	}

	async exists(): Promise<boolean> {
		const fs = this._requireFS();
		return fs.existsSync(this._getPath());
	}

	// ─── Parser ───────────────────────────────────────────────────────────────

	private _parse(content: string, mtime: number): INIMdConfig {
		const config: INIMdConfig = { rules: [], importantRules: [], rawSections: {}, lastModified: mtime };
		let currentSection = '';
		const sectionLines: Record<string, string[]> = {};

		for (const line of content.split('\n')) {
			const sectionMatch = line.match(/^##\s+(.+)$/);
			if (sectionMatch) {
				currentSection = sectionMatch[1]!.trim();
				sectionLines[currentSection] = [];
				continue;
			}

			if (!currentSection) { continue; }
			(sectionLines[currentSection] = sectionLines[currentSection] ?? []).push(line);
		}

		// Parse Build section
		const buildLines = sectionLines['Build'] ?? [];
		for (const line of buildLines) {
			const m = line.match(/^Build command:\s*(.+)$/i);
			if (m) { config.buildCommand = m[1]!.trim(); }
			const f = line.match(/^Flash command:\s*(.+)$/i);
			if (f) { config.flashCommand = f[1]!.trim(); }
			const t = line.match(/^Test command:\s*(.+)$/i);
			if (t) { config.testCommand = t[1]!.trim(); }
		}

		// Parse Debug section
		const debugLines = sectionLines['Debug'] ?? [];
		for (const line of debugLines) {
			const iface = line.match(/^Debug interface:\s*(.+)$/i);
			if (iface) { config.debugInterface = iface[1]!.trim(); }
			const mcu = line.match(/^Target MCU:\s*(.+)$/i);
			if (mcu) { config.targetMCU = mcu[1]!.trim(); }
		}

		// Parse Rules section — lines starting with -
		for (const line of (sectionLines['Rules'] ?? [])) {
			const rule = line.match(/^-\s+(.+)$/);
			if (rule) { config.rules.push(rule[1]!.trim()); }
		}

		// Parse IMPORTANT section — all non-empty, non-comment lines
		for (const line of (sectionLines['IMPORTANT'] ?? [])) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('#')) {
				config.importantRules.push(trimmed.replace(/^-\s*/, ''));
			}
		}

		// Store all raw sections for custom content
		for (const [section, lines] of Object.entries(sectionLines)) {
			config.rawSections[section] = lines.join('\n');
		}

		return config;
	}

	// ─── File watcher ─────────────────────────────────────────────────────────

	private _watchFile(): void {
		const fs = this._requireFS();
		const path = this._getPath();

		if (!fs.existsSync(path)) { return; }

		try {
			this._watcher?.close();
			this._watcher = fs.watch(path, () => {
				// Debounce: wait 500ms before reload
				setTimeout(() => { this.load().catch(() => {}); }, 500);
			});
		} catch {
			// Watcher not supported in this environment
		}
	}

	private _getPath(): string {
		// Use VS Code workspace root (correct in extension host — not process.cwd() which is the extension dir)
		const folders = this._workspaceCtx.getWorkspace().folders;
		if (folders.length > 0) {
			const root = folders[0]!.uri.fsPath;
			const path = (globalThis as Record<string, unknown>)['require']
				? (((globalThis as Record<string, unknown>)['require'] as (m: string) => unknown)('path') as typeof import('path'))
				: null;
			return path ? path.join(root, 'NI.md') : `${root}/NI.md`;
		}
		// Fallback: use process.cwd() only if no workspace is open
		const cwd = process?.cwd?.() ?? '.';
		return `${cwd}/NI.md`;
	}

	private _requireFS(): typeof import('fs') {
		const req = (globalThis as Record<string, unknown>)['require'];
		if (!req) { throw new Error('NI.md service requires Node.js environment.'); }
		return (req as NodeRequire)('fs') as typeof import('fs');
	}
}


registerSingleton(INIMdService, NIMdServiceImpl, InstantiationType.Delayed);
