/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pin Mux agent tools
 *
 * Detects GPIO pin conflicts, suggests available pins for a peripheral,
 * and validates AF assignments — all from SVD data. No LLM calls.
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { PinMuxConflictService } from '../pinMux/pinMuxConflictService.js';
import { parsePinKey } from '../pinMux/pinMuxTypes.js';

export function buildPinMuxTools(session: IFirmwareSessionService): IVoidInternalTool[] {
	const pinMux = new PinMuxConflictService(session);

	return [
		_fwCheckPinConflicts(session, pinMux),
		_fwSuggestPinAssignment(session, pinMux),
		_fwGetAvailablePins(session, pinMux),
	];
}


function _fwCheckPinConflicts(session: IFirmwareSessionService, pinMux: PinMuxConflictService): IVoidInternalTool {
	return {
		name: 'fw_check_pin_conflicts',
		description: 'Check for GPIO pin mux conflicts in the current firmware project. Detects: two peripherals claiming the same pin, wrong AF number for a peripheral, and validates that pin assignments match the SVD alternate function table. Returns all detected conflicts with the correct AF values.',
		params: {
			pin: { description: 'Optional: check a specific pin, e.g. "PA9". Omit to check all known allocations.' },
			peripheral: { description: 'Optional: check all pins assigned to a peripheral, e.g. "USART1".' },
			af: { description: 'Optional: validate that this AF number is correct for the given pin+peripheral combination.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }
			if (!s.registerMaps || s.registerMaps.length === 0) {
				return 'No register maps loaded. Load an SVD file to use pin conflict detection.';
			}

			pinMux.refreshAFDatabase();

			const pin = args.pin as string | undefined;
			const peripheral = args.peripheral as string | undefined;
			const af = typeof args.af === 'number' ? args.af : undefined;

			// Single pin + peripheral + AF validation
			if (pin && peripheral && af !== undefined) {
				const parsed = parsePinKey(pin.toUpperCase().startsWith('P') ? pin.toUpperCase() : `P${pin.toUpperCase()}`);
				if (!parsed) { return `Invalid pin format "${pin}". Use PA9, PB6, etc.`; }

				const result = pinMux.validateAF(parsed, peripheral, af);
				return result.message;
			}

			// Check all conflicts
			const conflicts = pinMux.getConflicts();

			if (conflicts.length === 0) {
				return [
					'No pin conflicts detected.',
					'',
					`Pin allocations tracked: ${pinMux.getAvailablePins().filter(p => p.allocated).length}`,
					'',
					'Tip: Use fw_suggest_pin_assignment to find free pins for a peripheral.',
				].join('\n');
			}

			const lines = [`Found ${conflicts.length} pin conflict(s):`, ''];
			for (const conflict of conflicts) {
				lines.push(`  P${conflict.pin.port}${conflict.pin.pin}: ${conflict.message}`);
				for (const alloc of conflict.allocations) {
					lines.push(`    - ${alloc.signal} (AF${alloc.af}) [${alloc.source}${alloc.fileUri ? ` @ ${alloc.fileUri}` : ''}]`);
				}
				lines.push('');
			}

			return lines.join('\n');
		},
	};
}


function _fwSuggestPinAssignment(session: IFirmwareSessionService, pinMux: PinMuxConflictService): IVoidInternalTool {
	return {
		name: 'fw_suggest_pin_assignment',
		description: 'Suggest the best available pin for a peripheral signal. Returns all pins that can carry the given peripheral sorted by availability (free pins first). Uses the SVD alternate function table to determine valid assignments and cross-references against the current allocation table to avoid conflicts.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1", "SPI2", "I2C1".' },
			signal: { description: 'Optional: specific signal, e.g. "USART1_TX", "SPI2_MISO". If omitted, returns all signals for the peripheral.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }
			if (!s.registerMaps || s.registerMaps.length === 0) {
				return 'No register maps loaded. Load an SVD file to use pin suggestions.';
			}

			const peripheral = args.peripheral as string | undefined;
			if (!peripheral) { return 'Provide peripheral name, e.g. "USART1", "SPI2".'; }

			pinMux.refreshAFDatabase();
			const suggestions = pinMux.suggestPin(peripheral, args.signal as string | undefined);

			if (suggestions.length === 0) {
				return `No AF data found for ${peripheral} in the loaded SVD. Ensure GPIO register maps with AF enumerations are loaded.`;
			}

			const available = suggestions.filter(s => s.reason === 'available');
			const occupied = suggestions.filter(s => s.reason !== 'available');

			const lines = [`Pin options for ${peripheral}${args.signal ? ` (${args.signal})` : ''}:`, ''];

			if (available.length > 0) {
				lines.push('  AVAILABLE (no conflicts):');
				for (const s of available) {
					lines.push(`    P${s.pin.port}${s.pin.pin}  AF${s.af}  ${s.signal}`);
				}
				lines.push('');
			}

			if (occupied.length > 0) {
				lines.push('  OCCUPIED (would conflict):');
				for (const s of occupied) {
					lines.push(`    P${s.pin.port}${s.pin.pin}  AF${s.af}  ${s.signal}  [${s.reason}]`);
				}
			}

			if (available.length > 0) {
				const best = available[0];
				lines.push('');
				lines.push(`Recommendation: Use P${best.pin.port}${best.pin.pin} with AF${best.af} for ${best.signal}.`);
			}

			return lines.join('\n');
		},
	};
}


function _fwGetAvailablePins(session: IFirmwareSessionService, pinMux: PinMuxConflictService): IVoidInternalTool {
	return {
		name: 'fw_get_available_pins',
		description: 'Show the allocation status of all GPIO pins for a port or the entire MCU. Returns each pin with its current assignment (if any) and all available alternate functions from the SVD. Use this to understand what pins are free before assigning a new peripheral.',
		params: {
			port: { description: 'Optional: GPIO port letter, e.g. "A", "B". Omit to see all ports.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }
			if (!s.registerMaps || s.registerMaps.length === 0) {
				return 'No register maps loaded.';
			}

			pinMux.refreshAFDatabase();
			const port = args.port as string | undefined;
			const pins = pinMux.getAvailablePins(port);

			if (pins.length === 0) {
				return port
					? `No GPIO AF data for port ${port.toUpperCase()} in the loaded SVD.`
					: 'No GPIO AF data found in loaded SVD.';
			}

			const lines = [`GPIO pin status${port ? ` (port ${port.toUpperCase()})` : ''}:`, ''];
			let freeCount = 0;
			let usedCount = 0;

			for (const p of pins) {
				const key = `P${p.pin.port}${p.pin.pin}`;
				if (p.allocated) {
					usedCount++;
					lines.push(`  ${key.padEnd(5)} [USED] ${p.currentAllocation!.signal} (AF${p.currentAllocation!.af})`);
				} else {
					freeCount++;
					const afList = p.availableAFs.slice(0, 4).map(a => `AF${a.af}:${a.signal}`).join(', ');
					const more = p.availableAFs.length > 4 ? `, +${p.availableAFs.length - 4} more` : '';
					lines.push(`  ${key.padEnd(5)} [FREE] ${afList}${more}`);
				}
			}

			lines.push('');
			lines.push(`Summary: ${freeCount} free, ${usedCount} used, ${pins.length} total`);

			return lines.join('\n');
		},
	};
}
