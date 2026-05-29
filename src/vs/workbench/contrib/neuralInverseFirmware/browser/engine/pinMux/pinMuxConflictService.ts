/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pin Mux Conflict Detector
 *
 * Maintains a live allocation table of GPIO pin assignments across the project.
 * Detects conflicts: two peripherals claiming the same pin, wrong AF number,
 * or pin not available on chip package. Operates entirely from SVD data.
 */

import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IPeripheralRegisterMap } from '../../../common/firmwareTypes.js';
import {
	IPinAllocation, IPinConflict, IPinSuggestion, IPinAvailability,
	IPinIdentifier,
	pinKey, parsePinKey,
} from './pinMuxTypes.js';

interface AFEntry { port: string; pin: number; af: number; signal: string }

export class PinMuxConflictService {
	private _allocations: Map<string, IPinAllocation[]> = new Map();
	private _afDatabase: AFEntry[] = [];

	constructor(private readonly _session: IFirmwareSessionService) {}

	refreshAFDatabase(): void {
		const s = this._session.session;
		if (!s.isActive || !s.registerMaps) {
			this._afDatabase = [];
			return;
		}
		const gpioMaps = s.registerMaps.filter(m => m.name.startsWith('GPIO') || m.groupName === 'GPIO');
		this._afDatabase = this._extractAFData(gpioMaps);
	}

	allocatePin(alloc: IPinAllocation): IPinConflict | null {
		const key = pinKey(alloc.pin);
		const existing = this._allocations.get(key) ?? [];

		const conflict = existing.find(e => e.peripheral !== alloc.peripheral || e.signal !== alloc.signal);
		if (conflict) {
			const allConflicting = [...existing, alloc];
			this._allocations.set(key, allConflicting);
			return {
				pin: alloc.pin,
				allocations: allConflicting,
				severity: 'error',
				message: `Pin P${alloc.pin.port}${alloc.pin.pin} conflict: ${allConflicting.map(a => a.signal).join(' vs ')}`,
			};
		}

		existing.push(alloc);
		this._allocations.set(key, existing);
		return null;
	}

	deallocatePin(pin: IPinIdentifier, peripheral: string): void {
		const key = pinKey(pin);
		const existing = this._allocations.get(key) ?? [];
		this._allocations.set(key, existing.filter(a => a.peripheral !== peripheral));
	}

	clearAll(): void {
		this._allocations.clear();
	}

	getConflicts(): IPinConflict[] {
		const conflicts: IPinConflict[] = [];
		for (const [key, allocs] of this._allocations) {
			if (allocs.length <= 1) { continue; }

			const peripherals = new Set(allocs.map(a => a.peripheral));
			if (peripherals.size <= 1) { continue; }

			const pin = parsePinKey(key);
			if (!pin) { continue; }

			conflicts.push({
				pin,
				allocations: allocs,
				severity: 'error',
				message: `Pin P${pin.port}${pin.pin} claimed by: ${allocs.map(a => `${a.signal} (AF${a.af})`).join(', ')}`,
			});
		}
		return conflicts;
	}

	validateAF(pin: IPinIdentifier, peripheral: string, requestedAF: number): { valid: boolean; correctAF?: number; message: string } {
		if (this._afDatabase.length === 0) { this.refreshAFDatabase(); }

		const matching = this._afDatabase.filter(
			e => e.port === pin.port && e.pin === pin.pin && e.signal.toUpperCase().startsWith(peripheral.toUpperCase())
		);

		if (matching.length === 0) {
			return { valid: false, message: `${peripheral} has no AF assignment on P${pin.port}${pin.pin} in the SVD.` };
		}

		const exact = matching.find(e => e.af === requestedAF);
		if (exact) {
			return { valid: true, message: `AF${requestedAF} correctly routes ${exact.signal} on P${pin.port}${pin.pin}.` };
		}

		const correct = matching[0];
		return {
			valid: false,
			correctAF: correct.af,
			message: `Wrong AF: P${pin.port}${pin.pin} needs AF${correct.af} for ${correct.signal}, not AF${requestedAF}.`,
		};
	}

	suggestPin(peripheral: string, signal?: string): IPinSuggestion[] {
		if (this._afDatabase.length === 0) { this.refreshAFDatabase(); }

		const periphUpper = peripheral.toUpperCase();
		const signalUpper = signal?.toUpperCase();

		const candidates = this._afDatabase.filter(e => {
			if (signalUpper) { return e.signal.toUpperCase() === signalUpper; }
			return e.signal.toUpperCase().startsWith(periphUpper);
		});

		const suggestions: IPinSuggestion[] = [];
		for (const candidate of candidates) {
			const key = `P${candidate.port}${candidate.pin}`;
			const existing = this._allocations.get(key) ?? [];
			const isFree = existing.length === 0;

			suggestions.push({
				pin: { port: candidate.port, pin: candidate.pin },
				af: candidate.af,
				signal: candidate.signal,
				reason: isFree ? 'available' : `occupied by ${existing[0].signal}`,
			});
		}

		return suggestions.sort((a, b) => {
			if (a.reason === 'available' && b.reason !== 'available') { return -1; }
			if (a.reason !== 'available' && b.reason === 'available') { return 1; }
			return a.pin.port.localeCompare(b.pin.port) || a.pin.pin - b.pin.pin;
		});
	}

	getAvailablePins(port?: string): IPinAvailability[] {
		if (this._afDatabase.length === 0) { this.refreshAFDatabase(); }

		const result: IPinAvailability[] = [];
		const seen = new Set<string>();

		for (const entry of this._afDatabase) {
			if (port && entry.port !== port.toUpperCase()) { continue; }

			const key = `P${entry.port}${entry.pin}`;
			if (seen.has(key)) { continue; }
			seen.add(key);

			const pin: IPinIdentifier = { port: entry.port, pin: entry.pin };
			const allocs = this._allocations.get(key) ?? [];
			const pinAFs = this._afDatabase
				.filter(e => e.port === entry.port && e.pin === entry.pin)
				.map(e => ({ af: e.af, signal: e.signal }));

			result.push({
				pin,
				allocated: allocs.length > 0,
				currentAllocation: allocs[0],
				availableAFs: pinAFs,
			});
		}

		return result.sort((a, b) => a.pin.port.localeCompare(b.pin.port) || a.pin.pin - b.pin.pin);
	}

	scanSourceForAllocations(content: string, fileUri?: string): IPinAllocation[] {
		const allocations: IPinAllocation[] = [];

		// ── Strategy 1: HAL GPIO_InitStruct blocks ───────────────────────────
		// Parse contiguous blocks: collect .Pin, .Alternate, and HAL_GPIO_Init()
		// within a 20-line window of each other, matching all three to build a
		// complete allocation with real port, pin, and AF.
		//
		// Typical HAL pattern:
		//   GPIO_InitStruct.Pin       = GPIO_PIN_9;
		//   GPIO_InitStruct.Mode      = GPIO_MODE_AF_PP;
		//   GPIO_InitStruct.Alternate = GPIO_AF7_USART1;
		//   HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

		const lines = content.split('\n');

		// Forward pass: when we see a .Pin or .Alternate assignment, open a
		// context window and look for all three fields within ±10 lines.
		const halPinPattern      = /\.Pin\s*=\s*GPIO_PIN_(\d+)/;
		const halAlternatePattern = /\.Alternate\s*=\s*GPIO_AF(\d+)_(\w+)/;
		const halInitCallPattern  = /HAL_GPIO_Init\s*\(\s*GPIO([A-K])\s*,/;

		// Collect all events with line index
		const pinEvents:       Array<{ line: number; pin: number }> = [];
		const alternateEvents: Array<{ line: number; af: number; signal: string }> = [];
		const initCallEvents:  Array<{ line: number; port: string }> = [];

		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			let m: RegExpMatchArray | null;
			if ((m = l.match(halPinPattern))) {
				pinEvents.push({ line: i, pin: parseInt(m[1]) });
			}
			if ((m = l.match(halAlternatePattern))) {
				alternateEvents.push({ line: i, af: parseInt(m[1]), signal: m[2] });
			}
			if ((m = l.match(halInitCallPattern))) {
				initCallEvents.push({ line: i, port: m[1] });
			}
		}

		// For each .Alternate event, find the nearest .Pin and HAL_GPIO_Init within ±15 lines
		for (const alt of alternateEvents) {
			const nearPin = pinEvents
				.filter(e => Math.abs(e.line - alt.line) <= 15)
				.sort((a, b) => Math.abs(a.line - alt.line) - Math.abs(b.line - alt.line))[0];

			const nearInit = initCallEvents
				.filter(e => Math.abs(e.line - alt.line) <= 15)
				.sort((a, b) => Math.abs(a.line - alt.line) - Math.abs(b.line - alt.line))[0];

			if (!nearPin || !nearInit) {
				// Can't resolve port/pin for this block — skip rather than emitting garbage
				continue;
			}

			const peripheral = alt.signal.replace(/_.*$/, '');
			const suffix = alt.signal.replace(`${peripheral}_`, '');
			allocations.push({
				pin: { port: nearInit.port, pin: nearPin.pin },
				peripheral,
				signal: suffix ? `${peripheral}_${suffix}` : peripheral,
				af: alt.af,
				source: 'source-scan',
				fileUri,
			});
		}

		// ── Strategy 2: LL_GPIO_SetAFPin_0_7(GPIOA, LL_GPIO_PIN_9, LL_GPIO_AF_7) ──
		const llAfPattern = /LL_GPIO_SetAFPin_\d+_\d+\s*\(\s*GPIO([A-K])\s*,\s*LL_GPIO_PIN_(\d+)\s*,\s*LL_GPIO_AF_(\d+)\s*\)/g;
		let match: RegExpExecArray | null;
		while ((match = llAfPattern.exec(content)) !== null) {
			const port = match[1];
			const pin = parseInt(match[2]);
			const af = parseInt(match[3]);
			const afEntry = this._afDatabase.find(e => e.port === port && e.pin === pin && e.af === af);
			allocations.push({
				pin: { port, pin },
				peripheral: afEntry?.signal.replace(/_.*$/, '') ?? `AF${af}`,
				signal: afEntry?.signal ?? `P${port}${pin}_AF${af}`,
				af,
				source: 'source-scan',
				fileUri,
			});
		}

		// ── Strategy 3: Direct register write GPIOx->AFR[LH] ────────────────
		// LL bare-register: GPIOA->AFR[0] |= (7UL << (1 * 4));  /* USART1_TX on PA1 AF7 */
		// This pattern is too varied to parse reliably without semantic analysis;
		// already covered by LL strategy above for named macros.

		return allocations;
	}

	private _extractAFData(gpioMaps: IPeripheralRegisterMap[]): AFEntry[] {
		const entries: AFEntry[] = [];

		for (const gmap of gpioMaps) {
			const portMatch = gmap.name.match(/GPIO([A-K])/);
			if (!portMatch) { continue; }
			const port = portMatch[1];

			for (const reg of gmap.registers) {
				if (!reg.name.match(/^AFR[LH]$/i)) { continue; }
				const isHigh = reg.name.toUpperCase() === 'AFRH';
				const pinOffset = isHigh ? 8 : 0;

				if (!reg.fields) { continue; }

				for (const field of reg.fields) {
					const fieldPinMatch = field.name.match(/(\d+)$/);
					if (!fieldPinMatch) { continue; }
					const pinNum = parseInt(fieldPinMatch[1]) + pinOffset;

					if (field.enumeratedValues) {
						for (const [afStr, signal] of Object.entries(field.enumeratedValues)) {
							entries.push({ port, pin: pinNum, af: parseInt(afStr, 10), signal: signal as string });
						}
					}
				}
			}
		}

		return entries;
	}
}
