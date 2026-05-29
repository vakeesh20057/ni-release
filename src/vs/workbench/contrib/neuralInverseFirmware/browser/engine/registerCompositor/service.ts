/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IDecodedRegister, IRegisterDiff } from './compositorTypes.js';
import { RegisterCompositorService } from './registerCompositorService.js';

export const IRegisterCompositorService = createDecorator<IRegisterCompositorService>('registerCompositorService');

export interface IRegisterCompositorService {
	readonly _serviceBrand: undefined;

	decodeRegisterValue(peripheral: string, register: string, value: number): IDecodedRegister | null;
	composeRegisterValue(peripheral: string, register: string, fieldValues: Record<string, number>): number | null;
	diffRegisters(peripheral: string, register: string, before: number, after: number): IRegisterDiff | null;
	formatDecoded(decoded: IDecodedRegister): string;
	formatDiff(diff: IRegisterDiff): string;
}

class RegisterCompositorServiceImpl extends Disposable implements IRegisterCompositorService {
	declare readonly _serviceBrand: undefined;

	private readonly _inner: RegisterCompositorService;

	constructor(
		@IFirmwareSessionService private readonly _firmwareSessionService: IFirmwareSessionService,
	) {
		super();
		this._inner = new RegisterCompositorService(this._firmwareSessionService);
	}

	decodeRegisterValue(peripheral: string, register: string, value: number): IDecodedRegister | null {
		return this._inner.decodeRegisterValue(peripheral, register, value);
	}

	composeRegisterValue(peripheral: string, register: string, fieldValues: Record<string, number>): number | null {
		return this._inner.composeRegisterValue(peripheral, register, fieldValues);
	}

	diffRegisters(peripheral: string, register: string, before: number, after: number): IRegisterDiff | null {
		return this._inner.diffRegisters(peripheral, register, before, after);
	}

	formatDecoded(decoded: IDecodedRegister): string {
		return this._inner.formatDecoded(decoded);
	}

	formatDiff(diff: IRegisterDiff): string {
		return this._inner.formatDiff(diff);
	}
}

registerSingleton(IRegisterCompositorService, RegisterCompositorServiceImpl, InstantiationType.Delayed);
