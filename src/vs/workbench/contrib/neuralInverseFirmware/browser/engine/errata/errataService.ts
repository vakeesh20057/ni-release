/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Errata Service
 *
 * Provides a unified errata lookup that combines:
 *  1. Built-in curated errata database (always available)
 *  2. Session-loaded errata from uploaded datasheets
 *
 * Also provides proactive errata checking — given a peripheral + operation,
 * returns relevant silicon bugs the developer should be aware of.
 */

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IErrata } from '../../../common/firmwareTypes.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { lookupErrataForMCU, searchErrata } from './errataDatabase.js';
import { IErrataMatch, IErrataQuery } from './errataTypes.js';


export const IErrataService = createDecorator<IErrataService>('errataService');

export interface IErrataService {
	readonly _serviceBrand: undefined;

	/**
	 * Get all known errata for the current session MCU.
	 * Merges built-in database with datasheet-extracted errata (de-duplicated by ID).
	 */
	getAllErrata(): IErrata[];

	/**
	 * Get errata for a specific peripheral on the current MCU.
	 */
	getForPeripheral(peripheral: string): IErrata[];

	/**
	 * Proactive check: given what the developer is doing, find relevant errata.
	 * Returns matches ranked by relevance.
	 */
	checkOperation(query: IErrataQuery): IErrataMatch[];

	/**
	 * Check if a specific register write is affected by any known errata.
	 * Used by the code generation pipeline to inject warnings.
	 */
	checkRegisterAccess(peripheral: string, register: string): IErrata[];
}


class ErrataServiceImpl extends Disposable implements IErrataService {
	readonly _serviceBrand: undefined;

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
	) {
		super();
	}

	getAllErrata(): IErrata[] {
		const s = this._session.session;
		const mcuFamily = s.mcuConfig?.family ?? s.projectInfo?.mcuFamily;

		const builtIn = mcuFamily ? lookupErrataForMCU(mcuFamily) : [];
		const fromSession = s.errata ?? [];

		return this._deduplicate([...builtIn, ...fromSession]);
	}

	getForPeripheral(peripheral: string): IErrata[] {
		const all = this.getAllErrata();
		const periph = peripheral.toUpperCase().replace(/[0-9]+$/, '');
		return all.filter(e =>
			e.affectedPeripheral.toUpperCase().includes(periph) ||
			periph.includes(e.affectedPeripheral.toUpperCase())
		);
	}

	checkOperation(query: IErrataQuery): IErrataMatch[] {
		const mcuFamily = query.mcuFamily ?? this._session.session.mcuConfig?.family ?? this._session.session.projectInfo?.mcuFamily;

		const candidates = searchErrata({
			peripheral: query.peripheral,
			operation: query.operation,
			mcuFamily,
		});

		// Also include session errata that match
		const sessionMatches = this._session.session.errata
			?.filter(e => {
				if (query.peripheral) {
					const p = query.peripheral.toUpperCase().replace(/[0-9]+$/, '');
					if (!e.affectedPeripheral.toUpperCase().includes(p)) return false;
				}
				return true;
			}) ?? [];

		const all = this._deduplicate([...candidates, ...sessionMatches]);

		return all.map(e => ({
			errata: e,
			relevanceScore: this._scoreRelevance(e, query),
			matchReason: this._matchReason(e, query),
		})).sort((a, b) => b.relevanceScore - a.relevanceScore);
	}

	checkRegisterAccess(peripheral: string, register: string): IErrata[] {
		const errata = this.getForPeripheral(peripheral);
		const reg = register.toUpperCase();

		return errata.filter(e =>
			e.description.toUpperCase().includes(reg) ||
			(e.workaround?.toUpperCase().includes(reg) ?? false)
		);
	}

	private _deduplicate(errata: IErrata[]): IErrata[] {
		const seen = new Set<string>();
		return errata.filter(e => {
			if (seen.has(e.id)) return false;
			seen.add(e.id);
			return true;
		});
	}

	private _scoreRelevance(e: IErrata, query: IErrataQuery): number {
		let score = 0;

		if (query.peripheral) {
			const p = query.peripheral.toUpperCase().replace(/[0-9]+$/, '');
			if (e.affectedPeripheral.toUpperCase() === p) score += 50;
			else if (e.affectedPeripheral.toUpperCase().includes(p)) score += 30;
		}

		if (query.operation) {
			const op = query.operation.toLowerCase();
			if (e.description.toLowerCase().includes(op)) score += 40;
			if (e.title.toLowerCase().includes(op)) score += 30;
		}

		if (query.register) {
			const reg = query.register.toUpperCase();
			if (e.description.toUpperCase().includes(reg)) score += 35;
			if (e.workaround?.toUpperCase().includes(reg)) score += 20;
		}

		// Severity bonus
		switch (e.severity) {
			case 'critical': score += 20; break;
			case 'major': score += 10; break;
		}

		return score;
	}

	private _matchReason(e: IErrata, query: IErrataQuery): string {
		const reasons: string[] = [];
		if (query.peripheral) reasons.push(`affects ${e.affectedPeripheral}`);
		if (query.operation && e.description.toLowerCase().includes(query.operation.toLowerCase())) {
			reasons.push('matches operation description');
		}
		if (e.severity === 'critical') reasons.push('CRITICAL severity');
		return reasons.join('; ') || 'general match';
	}
}

registerSingleton(IErrataService, ErrataServiceImpl, InstantiationType.Delayed);
