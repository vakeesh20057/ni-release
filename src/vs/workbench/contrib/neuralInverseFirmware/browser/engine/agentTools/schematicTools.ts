/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { ISchematicService } from '../schematic/schematicService.js';


export function buildSchematicTools(
	session: IFirmwareSessionService,
	schematic: ISchematicService,
): IVoidInternalTool[] {
	return [
		_fwPinoutShow(session, schematic),
		_fwPinoutCheck(session, schematic),
		_fwPinoutExport(schematic),
	];
}


function _fwPinoutShow(session: IFirmwareSessionService, schematic: ISchematicService): IVoidInternalTool {
	return {
		name: 'fw_pinout_show',
		description: 'Generate a pinout diagram for the active MCU. Shows all GPIO pins with their alternate function assignments, allocated pins highlighted. Returns ASCII table with pin number, port, and signal names.',
		params: {
			filter: { description: 'Filter pins: "all" (default), "allocated" (only assigned pins), "available" (only free pins), "conflicts" (only conflicting pins), or a port letter like "A" or "B".' },
		},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive || !s.mcuConfig) {
				return 'No active firmware session. Start a session with an MCU to view pinout.';
			}

			const filter = String(args.filter ?? 'all');
			const map = schematic.getPinoutMap();

			if (!map) {
				return [
					`No pinout data available for ${s.mcuConfig.variant ?? s.mcuConfig.family}.`,
					`This MCU may not be in the AF database yet.`,
					`Available families: STM32F0/F1/F4/F7/H7/G4/G0/L4/WB/U5 and GD32 clones.`,
				].join('\n');
			}

			let pins = map.pins;
			if (filter === 'allocated') { pins = pins.filter(p => p.color === 'allocated'); }
			else if (filter === 'available') { pins = pins.filter(p => p.color === 'available'); }
			else if (filter === 'conflicts') { pins = pins.filter(p => p.conflict); }
			else if (filter.match(/^[A-K]$/i)) { pins = pins.filter(p => p.portPin.startsWith(`P${filter.toUpperCase()}`)); }

			const lines = [
				`Pinout: ${map.variant} (${map.packageType}, ${map.pinCount} pins)`,
				`Allocated: ${map.allocatedCount} | Conflicts: ${map.conflictCount} | Showing: ${pins.length} pins`,
				`${'─'.repeat(65)}`,
				`Pin#  Port    Primary Function          Status`,
				`${'─'.repeat(65)}`,
			];

			const statusLabels: Record<string, string> = {
				available: 'FREE',
				allocated: 'ALLOC',
				conflict:  'CONFLICT',
				power:     'POWER',
				unused:    'NC',
				debug:     'DEBUG',
			};

			for (const pin of pins.slice(0, 80)) {
				const pnum = String(pin.physicalPin).padStart(4);
				const pp = pin.portPin.padEnd(8);
				const func = (pin.primaryFunction ?? '').padEnd(26);
				const status = statusLabels[pin.color] ?? '';
				const conf = pin.conflict ? ' [!]' : '';
				lines.push(`${pnum}  ${pp}${func}${status}${conf}`);
			}

			if (pins.length > 80) {
				lines.push(`... and ${pins.length - 80} more`);
			}

			lines.push(`${'─'.repeat(65)}`);

			if (map.conflictCount > 0) {
				lines.push(`[!] ${map.conflictCount} pin conflict(s) detected. Run fw_pinout_check for details.`);
			}

			lines.push(`Export SVG: fw_pinout_export({ format: "svg", path: ".inverse/pinout.svg" })`);

			return lines.join('\n');
		},
	};
}


function _fwPinoutCheck(session: IFirmwareSessionService, schematic: ISchematicService): IVoidInternalTool {
	return {
		name: 'fw_pinout_check',
		description: 'Check the active MCU pinout for conflicts. Reports pins assigned to multiple peripherals, debug pins used for other functions, and power pins incorrectly assigned.',
		params: {},
		execute: async (args: Record<string, unknown>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const map = schematic.getPinoutMap();
			if (!map) { return 'No pinout data available.'; }

			const conflicts = map.pins.filter(p => p.conflict);
			const debugConflicts = map.pins.filter(p => p.debugPin && p.color === 'allocated');

			if (conflicts.length === 0 && debugConflicts.length === 0) {
				return [
					`Pinout check: PASS`,
					`No pin conflicts detected on ${map.variant}.`,
					`${map.allocatedCount}/${map.pinCount} pins allocated.`,
				].join('\n');
			}

			const lines = [
				`Pinout check: ${conflicts.length + debugConflicts.length} issue(s)`,
				``,
			];

			if (conflicts.length > 0) {
				lines.push(`Pin Conflicts (${conflicts.length}):`);
				for (const pin of conflicts) {
					lines.push(`  Pin ${pin.physicalPin} ${pin.portPin}: ${pin.primaryFunction} — CONFLICT`);
					lines.push(`    Two peripherals assigned to the same pin.`);
					lines.push(`    Fix: Use fw_suggest_pin_assignment to find alternative pins.`);
				}
				lines.push('');
			}

			if (debugConflicts.length > 0) {
				lines.push(`Debug Pin Usage (${debugConflicts.length}):`);
				for (const pin of debugConflicts) {
					lines.push(`  ${pin.portPin}: ${pin.primaryFunction} — assigned as ${pin.peripheral ?? 'peripheral'}`);
					lines.push(`    WARNING: This pin is also a debug pin (SWD/JTAG).`);
					lines.push(`    If firmware disables this pin, debug probe will lose connection.`);
				}
			}

			return lines.join('\n');
		},
	};
}


function _fwPinoutExport(schematic: ISchematicService): IVoidInternalTool {
	return {
		name: 'fw_pinout_export',
		description: 'Export the MCU pinout as SVG or ASCII. SVG produces a proper IC package diagram with colored pins. ASCII produces a table for terminal viewing.',
		params: {
			format: { description: 'Export format: "svg" (default) or "ascii".' },
			path: { description: 'Output file path for SVG. Default: .inverse/pinout.svg' },
		},
		execute: async (args: Record<string, unknown>) => {
			const format = String(args.format ?? 'svg');
			const path = String(args.path ?? '.inverse/pinout.svg');

			if (format === 'svg') {
				const svg = schematic.exportSVG();

				const fs = (globalThis as Record<string, unknown>)['require']
					? ((globalThis as Record<string, unknown>)['require']('fs') as typeof import('fs'))
					: null;

				if (fs) {
					const dir = path.substring(0, path.lastIndexOf('/'));
					if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
					fs.writeFileSync(path, svg, 'utf8');
					return [
						`SVG pinout exported: ${path}`,
						`Size: ${svg.length.toLocaleString()} bytes`,
						`Open in browser or VS Code SVG preview extension.`,
					].join('\n');
				}

				// Return inline SVG if filesystem not available
				return `SVG content (${svg.length} bytes):\n\n${svg.substring(0, 500)}...\n\n[Filesystem not available — save manually]`;
			}

			return schematic.exportASCII();
		},
	};
}
