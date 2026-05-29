/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IDependencyChain, IDependencyReport, IInitSequenceOptions } from './dependencyTypes.js';
import { PeripheralDependencyService } from './peripheralDependencyService.js';

export const IPeripheralDependencyService = createDecorator<IPeripheralDependencyService>('peripheralDependencyService');

export interface IPeripheralDependencyService {
	readonly _serviceBrand: undefined;

	getDependencyChain(peripheral: string, options?: Partial<IInitSequenceOptions>): IDependencyChain;
	checkDependencies(peripheral: string, sourceContent: string, options?: Partial<IInitSequenceOptions>): IDependencyReport;
	generateInitSequence(peripheral: string, options?: Partial<IInitSequenceOptions>): string;
}

class PeripheralDependencyServiceImpl extends Disposable implements IPeripheralDependencyService {
	declare readonly _serviceBrand: undefined;

	private readonly _inner: PeripheralDependencyService;

	constructor(
		@IFirmwareSessionService private readonly _firmwareSessionService: IFirmwareSessionService,
	) {
		super();
		this._inner = new PeripheralDependencyService(this._firmwareSessionService);
	}

	getDependencyChain(peripheral: string, options?: Partial<IInitSequenceOptions>): IDependencyChain {
		return this._inner.getDependencyChain(peripheral, options);
	}

	checkDependencies(peripheral: string, sourceContent: string, options?: Partial<IInitSequenceOptions>): IDependencyReport {
		return this._inner.checkDependencies(peripheral, sourceContent, options);
	}

	generateInitSequence(peripheral: string, options?: Partial<IInitSequenceOptions>): string {
		return this._inner.generateInitSequence(peripheral, options);
	}
}

registerSingleton(IPeripheralDependencyService, PeripheralDependencyServiceImpl, InstantiationType.Delayed);
