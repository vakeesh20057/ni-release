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
}

class ClockTreeServiceImpl extends Disposable implements IClockTreeService {
	declare readonly _serviceBrand: undefined;

	private readonly _validator: ClockTreeValidatorService;
	private readonly _solver: ClockTreeSolver;

	constructor(
		@IFirmwareSessionService _firmwareSessionService: IFirmwareSessionService,
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
}

registerSingleton(IClockTreeService, ClockTreeServiceImpl, InstantiationType.Delayed);
