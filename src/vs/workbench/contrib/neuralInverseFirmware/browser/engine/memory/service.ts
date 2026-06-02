/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ILinkerScriptConfig, IMemoryBudget } from './memoryTypes.js';
import { LinkerScriptGenerator } from './linkerScriptGenerator.js';
import { parseMapFile, findMapFileCandidates } from './mapFileParser.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';

export const IMemoryLayoutService = createDecorator<IMemoryLayoutService>('memoryLayoutService');

export interface IMemoryLayoutService {
	readonly _serviceBrand: undefined;

	/** Generate a GNU .ld linker script for the active MCU session. */
	generateLinkerScript(config?: Partial<ILinkerScriptConfig>): string;

	/**
	 * Scan the workspace for .map files and parse the first match.
	 * Returns null if no .map file found or parsing yields no sections.
	 */
	parseWorkspaceMapFile(): Promise<IMemoryBudget | null>;

	/** Flash origin hex string for the active MCU (e.g. "0x08000000"). */
	getFlashOrigin(): string;

	/** RAM origin hex string for the active MCU (e.g. "0x20000000"). */
	getRamOrigin(): string;
}

class MemoryLayoutServiceImpl extends Disposable implements IMemoryLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly _inner: LinkerScriptGenerator;

	constructor(
		@IFirmwareSessionService private readonly _firmwareSessionService: IFirmwareSessionService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
	) {
		super();
		this._inner = new LinkerScriptGenerator(this._firmwareSessionService);
	}

	generateLinkerScript(config?: Partial<ILinkerScriptConfig>): string {
		return this._inner.generate(config);
	}

	getFlashOrigin(): string {
		return this._inner.getFlashOrigin?.() ?? '0x08000000';
	}

	getRamOrigin(): string {
		return this._inner.getRamOrigin?.() ?? '0x20000000';
	}

	async parseWorkspaceMapFile(): Promise<IMemoryBudget | null> {
		const folders = this._workspaceService.getWorkspace().folders;
		if (!folders.length) { return null; }

		const root = folders[0]!.uri;
		const session = this._firmwareSessionService.session;
		const fallbackFlash = session.mcuConfig?.flashSize;
		const fallbackRam   = session.mcuConfig?.ramSize;

		// Walk common build output dirs for .map files
		const candidates: string[] = [];
		const searchDirs = ['build', 'out', 'Debug', 'Release', '.pio/build', 'cmake-build-debug', 'cmake-build-release', ''];
		for (const dir of searchDirs) {
			const folder = dir ? URI.joinPath(root, dir) : root;
			try {
				const stat = await this._fileService.resolve(folder);
				if (stat.children) {
					for (const child of stat.children) {
						if (child.name.endsWith('.map')) {
							candidates.push(child.resource.fsPath);
						}
					}
				}
			} catch {
				// dir doesn't exist — skip
			}
			if (candidates.length > 0) { break; }
		}

		// Recurse one more level if nothing found at top
		if (candidates.length === 0) {
			try {
				const stat = await this._fileService.resolve(root);
				if (stat.children) {
					for (const child of stat.children) {
						if (!child.isDirectory) continue;
						try {
							const sub = await this._fileService.resolve(child.resource);
							if (sub.children) {
								for (const f of sub.children) {
									if (f.name.endsWith('.map')) candidates.push(f.resource.fsPath);
								}
							}
						} catch { /* skip */ }
					}
				}
			} catch { /* skip */ }
		}

		if (candidates.length === 0) { return null; }

		// Pick best candidate
		const best = findMapFileCandidates(candidates)[0];
		if (!best) { return null; }

		try {
			const content = await this._fileService.readFile(URI.file(best));
			const text = content.value.toString();
			const budget = parseMapFile(text, fallbackFlash, fallbackRam);
			// If no sections parsed, return null (don't show empty chart)
			if (budget.regions.every(r => r.sections.length === 0)) { return null; }
			return budget;
		} catch {
			return null;
		}
	}
}

registerSingleton(IMemoryLayoutService, MemoryLayoutServiceImpl, InstantiationType.Delayed);
