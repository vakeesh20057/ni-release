/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPeripheralCatalogEntry } from './peripheralCatalogTypes.js';
import { BUILTIN_CATALOG } from './builtinCatalog.js';


// ─── Service interface ────────────────────────────────────────────────────────

export const IPeripheralCatalogService = createDecorator<IPeripheralCatalogService>('peripheralCatalogService');

export interface IPeripheralCatalogService {
	readonly _serviceBrand: undefined;

	/** Search catalog by part number, description, or category. */
	search(query: string): IPeripheralCatalogEntry[];

	/** Get entry by exact part number (case-insensitive). */
	getEntry(partNumber: string): IPeripheralCatalogEntry | null;

	/** Attach peripheral to current session for AI context. */
	attachToSession(partNumber: string): void;

	/** Detach peripheral from session. */
	detachFromSession(partNumber: string): void;

	/** Get all peripherals currently attached to session. */
	getSessionPeripherals(): IPeripheralCatalogEntry[];

	/** Get system prompt context for attached peripherals. */
	getSystemPromptSection(): string;

	/** Get total number of entries in catalog. */
	getCatalogSize(): number;
}


// ─── Implementation ───────────────────────────────────────────────────────────

class PeripheralCatalogServiceImpl extends Disposable implements IPeripheralCatalogService {
	readonly _serviceBrand: undefined;

	private _sessionPeripherals: Set<string> = new Set();
	private readonly _catalog: IPeripheralCatalogEntry[] = BUILTIN_CATALOG;

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService
	) {
		super();
	}

	search(query: string): IPeripheralCatalogEntry[] {
		if (!query.trim()) { return this._catalog.slice(0, 20); }

		const q = query.toLowerCase().trim();

		// Exact part number match first
		const exact = this._catalog.filter(e =>
			e.partNumber.toLowerCase() === q ||
			e.aliases?.some(a => a.toLowerCase() === q),
		);
		if (exact.length > 0) { return exact; }

		// Scored fuzzy search
		const scored = this._catalog.map(entry => {
			let score = 0;
			const pn = entry.partNumber.toLowerCase();
			const desc = entry.description.toLowerCase();
			const cat = entry.category.toLowerCase();
			const mfr = entry.manufacturer.toLowerCase();

			if (pn.startsWith(q)) { score += 100; }
			else if (pn.includes(q)) { score += 60; }
			if (entry.aliases?.some(a => a.toLowerCase().includes(q))) { score += 80; }
			if (desc.includes(q)) { score += 40; }
			if (cat.includes(q)) { score += 30; }
			if (mfr.includes(q)) { score += 20; }
			if (entry.agentHints.some(h => h.toLowerCase().includes(q))) { score += 10; }

			return { entry, score };
		}).filter(s => s.score > 0);

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, 15).map(s => s.entry);
	}

	getEntry(partNumber: string): IPeripheralCatalogEntry | null {
		const pn = partNumber.toLowerCase();
		return this._catalog.find(e =>
			e.partNumber.toLowerCase() === pn ||
			e.aliases?.some(a => a.toLowerCase() === pn),
		) ?? null;
	}

	attachToSession(partNumber: string): void {
		const entry = this.getEntry(partNumber);
		if (!entry) {
			throw new Error(`Peripheral "${partNumber}" not found in catalog. Use fw_peripheral_search to find it.`);
		}
		this._sessionPeripherals.add(entry.partNumber);
	}

	detachFromSession(partNumber: string): void {
		const entry = this.getEntry(partNumber);
		if (entry) { this._sessionPeripherals.delete(entry.partNumber); }
		else { this._sessionPeripherals.delete(partNumber); }
	}

	getSessionPeripherals(): IPeripheralCatalogEntry[] {
		return Array.from(this._sessionPeripherals)
			.map(pn => this.getEntry(pn))
			.filter((e): e is IPeripheralCatalogEntry => e !== null);
	}

	getSystemPromptSection(): string {
		const peripherals = this.getSessionPeripherals();
		if (peripherals.length === 0) { return ''; }

		const lines = ['== Attached Peripherals =='];
		for (const p of peripherals) {
			lines.push(`${p.partNumber} (${p.manufacturer}) — ${p.description}`);
			lines.push(`  Interface: ${p.interfaces.join('/')} | VDD: ${p.vddMin ?? '?'}-${p.vddMax ?? '?'}V`);
			if (p.i2cAddress && p.i2cAddress.length > 0) {
				lines.push(`  I2C: ${p.i2cAddress.map(a => `0x${a.toString(16).toUpperCase()}`).join(' or ')}`);
			}
			if (p.spiMode !== undefined) {
				lines.push(`  SPI: Mode ${p.spiMode}, max ${p.spiMaxMHz ?? '?'} MHz`);
			}
			if (p.agentHints.length > 0) {
				lines.push(`  Key facts:`);
				for (const hint of p.agentHints.slice(0, 4)) {
					lines.push(`    - ${hint}`);
				}
			}
			lines.push('');
		}
		return lines.join('\n');
	}

	getCatalogSize(): number {
		void this._session; // session used for MCU-aware filtering in future
		return this._catalog.length;
	}
}


registerSingleton(IPeripheralCatalogService, PeripheralCatalogServiceImpl, InstantiationType.Delayed);
