/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IClockConstraints, IClockValidationResult, IPLLConfig, IClockSolution } from './clockTreeTypes.js';
import { ClockTreeValidatorService } from './clockTreeValidatorService.js';
import { ClockTreeSolver, IClockTarget } from './clockTreeSolver.js';
import { IClockConfig, detectFileType, parseClockConfigFile, mergeClockConfigs, CLOCK_CONFIG_SCAN_FILES } from './clockConfigReader.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';

export const IClockTreeService = createDecorator<IClockTreeService>('clockTreeService');

export interface IClockTreeService {
	readonly _serviceBrand: undefined;

	validate(
		pll: IPLLConfig,
		hseMHz: number,
		ahbPrescaler: number,
		apb1Prescaler: number,
		apb2Prescaler: number,
		family: string,
	): IClockValidationResult;

	getConstraints(family: string): IClockConstraints;

	solve(hseMHz: number, target: IClockTarget, family: string, maxResults?: number): IClockSolution[];

	/**
	 * Scan the workspace for clock configuration files (.ioc, system_stm32*.c,
	 * prj.conf, sdkconfig, etc.) and extract real PLL values.
	 * Returns null if no recognisable clock config found.
	 */
	readProjectClockConfig(): Promise<IClockConfig | null>;
}

class ClockTreeServiceImpl extends Disposable implements IClockTreeService {
	declare readonly _serviceBrand: undefined;

	private readonly _validator: ClockTreeValidatorService;
	private readonly _solver: ClockTreeSolver;

	constructor(
		@IFirmwareSessionService _firmwareSessionService: IFirmwareSessionService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
	) {
		super();
		this._validator = new ClockTreeValidatorService();
		this._solver = new ClockTreeSolver();
	}

	validate(
		pll: IPLLConfig,
		hseMHz: number,
		ahbPrescaler: number,
		apb1Prescaler: number,
		apb2Prescaler: number,
		family: string,
	): IClockValidationResult {
		return this._validator.validate(pll, hseMHz, ahbPrescaler, apb1Prescaler, apb2Prescaler, family);
	}

	getConstraints(family: string): IClockConstraints {
		return this._validator.getConstraints(family);
	}

	solve(hseMHz: number, target: IClockTarget, family: string, maxResults?: number): IClockSolution[] {
		return this._solver.solve(hseMHz, target, family, maxResults);
	}

	async readProjectClockConfig(): Promise<IClockConfig | null> {
		const folders = this._workspaceService.getWorkspace().folders;
		if (!folders.length) { return null; }
		const root = folders[0]!.uri;

		const found: IClockConfig[] = [];

		// Walk root + common subdirs
		const searchDirs = ['', 'Core/Inc', 'Core/Src', 'Inc', 'Src', 'include', 'src',
			'app', 'config', 'boards', 'zephyr', 'main', 'firmware'];

		for (const dir of searchDirs) {
			const folder = dir ? URI.joinPath(root, dir) : root;
			let children: { name: string; resource: URI }[] = [];
			try {
				const stat = await this._fileService.resolve(folder);
				children = stat.children ?? [];
			} catch { continue; }

			for (const child of children) {
				if (child.name.startsWith('.')) { continue; }
				// Match against scan list
				for (const entry of CLOCK_CONFIG_SCAN_FILES) {
					if (!this._matchGlob(child.name, entry.glob)) { continue; }
					try {
						const content = await this._fileService.readFile(child.resource);
						const text = content.value.toString();
						const type = detectFileType(child.name) ?? entry.type;
						const cfg = parseClockConfigFile(text, type);
						if (cfg) {
							found.push({ ...cfg, sourceFile: child.resource.fsPath });
						}
					} catch { /* unreadable — skip */ }
					break;
				}
			}
		}

		if (!found.length) { return null; }
		return mergeClockConfigs(found);
	}

	private _matchGlob(name: string, glob: string): boolean {
		// Simple glob: leading * wildcard only
		if (glob.startsWith('*')) {
			return name.endsWith(glob.slice(1));
		}
		return name.toLowerCase() === glob.toLowerCase();
	}
}

registerSingleton(IClockTreeService, ClockTreeServiceImpl, InstantiationType.Delayed);
