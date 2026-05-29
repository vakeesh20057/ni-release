/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ILinkerScriptConfig } from './memoryTypes.js';
import { LinkerScriptGenerator } from './linkerScriptGenerator.js';

export const IMemoryLayoutService = createDecorator<IMemoryLayoutService>('memoryLayoutService');

export interface IMemoryLayoutService {
	readonly _serviceBrand: undefined;

	generateLinkerScript(config?: Partial<ILinkerScriptConfig>): string;
}

class MemoryLayoutServiceImpl extends Disposable implements IMemoryLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly _inner: LinkerScriptGenerator;

	constructor(
		@IFirmwareSessionService private readonly _firmwareSessionService: IFirmwareSessionService,
	) {
		super();
		this._inner = new LinkerScriptGenerator(this._firmwareSessionService);
	}

	generateLinkerScript(config?: Partial<ILinkerScriptConfig>): string {
		return this._inner.generate(config);
	}
}

registerSingleton(IMemoryLayoutService, MemoryLayoutServiceImpl, InstantiationType.Delayed);
