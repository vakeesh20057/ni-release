/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPinAllocation, IPinConflict, IPinSuggestion, IPinAvailability, IPinIdentifier } from './pinMuxTypes.js';
import { PinMuxConflictService } from './pinMuxConflictService.js';

export const IPinMuxService = createDecorator<IPinMuxService>('pinMuxService');

export interface IPinMuxService {
	readonly _serviceBrand: undefined;

	allocatePin(alloc: IPinAllocation): IPinConflict | null;
	deallocatePin(pin: IPinIdentifier, peripheral: string): void;
	getConflicts(): IPinConflict[];
	validateAF(pin: IPinIdentifier, peripheral: string, requestedAF: number): { valid: boolean; correctAF?: number; message: string };
	suggestPin(peripheral: string, signal?: string): IPinSuggestion[];
	getAvailablePins(port?: string): IPinAvailability[];
	scanSourceForAllocations(content: string, fileUri?: string): IPinAllocation[];
	clearAll(): void;
}

class PinMuxServiceImpl extends Disposable implements IPinMuxService {
	declare readonly _serviceBrand: undefined;

	private readonly _inner: PinMuxConflictService;

	constructor(
		@IFirmwareSessionService private readonly _firmwareSessionService: IFirmwareSessionService,
	) {
		super();
		this._inner = new PinMuxConflictService(this._firmwareSessionService);
	}

	allocatePin(alloc: IPinAllocation): IPinConflict | null {
		return this._inner.allocatePin(alloc);
	}

	deallocatePin(pin: IPinIdentifier, peripheral: string): void {
		this._inner.deallocatePin(pin, peripheral);
	}

	getConflicts(): IPinConflict[] {
		return this._inner.getConflicts();
	}

	validateAF(pin: IPinIdentifier, peripheral: string, requestedAF: number): { valid: boolean; correctAF?: number; message: string } {
		return this._inner.validateAF(pin, peripheral, requestedAF);
	}

	suggestPin(peripheral: string, signal?: string): IPinSuggestion[] {
		return this._inner.suggestPin(peripheral, signal);
	}

	getAvailablePins(port?: string): IPinAvailability[] {
		return this._inner.getAvailablePins(port);
	}

	scanSourceForAllocations(content: string, fileUri?: string): IPinAllocation[] {
		return this._inner.scanSourceForAllocations(content, fileUri);
	}

	clearAll(): void {
		this._inner.clearAll();
	}
}

registerSingleton(IPinMuxService, PinMuxServiceImpl, InstantiationType.Delayed);
