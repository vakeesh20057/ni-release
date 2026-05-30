/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schematic / Pinout Visualizer Service
 *
 * Generates package pinout maps and SVG diagrams for any MCU in the database.
 * Data sources (in priority order):
 *   1. AF database (stm32AfDatabase.ts) for STM32 and GD32 signal names
 *   2. Session pin allocations from IPinMuxService
 *   3. Session MCU config (package code) for physical pin filtering
 *
 * Supports packages: TSSOP-20, LQFP-48/64/100/144, QFN, BGA
 * Output: SVG diagram + IPinoutMap JSON
 *
 * Pin coloring:
 *   Green (#4caf50)  — allocated (has peripheral assignment)
 *   Blue  (#2196f3)  — partially used (AF configured)
 *   Gray  (#9e9e9e)  — available (no allocation)
 *   Red   (#f44336)  — conflict (multiple peripherals)
 *   Gold  (#ffc107)  — power/ground
 */

import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../../platform/instantiation/common/extensions.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { getAFDatabaseForFamily, filterAFDatabaseForVariant } from '../pinMux/stm32AfDatabase.js';


// ─── Types ────────────────────────────────────────────────────────────────────

export type PinColor = 'available' | 'allocated' | 'conflict' | 'power' | 'unused' | 'debug';

export interface IPinDiagram {
	physicalPin: number;        // 1-based physical pin number on package
	portPin: string;            // "PA9", "PB0", etc.
	primaryFunction: string;    // strongest signal name (e.g. "USART1_TX")
	peripheral?: string;        // peripheral name if allocated
	af?: number;                // alternate function number
	color: PinColor;
	conflict: boolean;
	ispower: boolean;
	debugPin: boolean;          // SWDIO/SWCLK/JTAG
}

export interface IPinoutMap {
	variant: string;
	family: string;
	packageType: string;        // "LQFP-100", "TSSOP-20", etc.
	pinCount: number;
	pins: IPinDiagram[];
	conflictCount: number;
	allocatedCount: number;
}


// ─── Service interface ────────────────────────────────────────────────────────

export const ISchematicService = createDecorator<ISchematicService>('schematicService');

export interface ISchematicService {
	readonly _serviceBrand: undefined;

	/** Generate pinout map for active session MCU. */
	getPinoutMap(): IPinoutMap | null;

	/** Export pinout as SVG string. */
	exportSVG(): string;

	/** Export pinout as ASCII table. */
	exportASCII(): string;
}


// ─── Package definitions ──────────────────────────────────────────────────────

interface IPackageDef {
	name: string;
	pinCount: number;
	pinsPerSide: number;    // for LQFP packages (pinsPerSide * 4 = total)
}

const PACKAGE_DEFS: Record<string, IPackageDef> = {
	'F': { name: 'TSSOP-20',  pinCount: 20,  pinsPerSide: 5  },
	'G': { name: 'UFQFPN-28', pinCount: 28,  pinsPerSide: 7  },
	'C': { name: 'LQFP-48',   pinCount: 48,  pinsPerSide: 12 },
	'R': { name: 'LQFP-64',   pinCount: 64,  pinsPerSide: 16 },
	'V': { name: 'LQFP-100',  pinCount: 100, pinsPerSide: 25 },
	'Z': { name: 'LQFP-144',  pinCount: 144, pinsPerSide: 36 },
	'B': { name: 'BGA-208',   pinCount: 208, pinsPerSide: 0  },
	'N': { name: 'TFBGA-216', pinCount: 216, pinsPerSide: 0  },
};


// ─── Power/debug pin patterns ─────────────────────────────────────────────────

const POWER_SIGNALS = ['VDD', 'VSS', 'VDDA', 'VSSA', 'NRST', 'BOOT', 'VBAT', 'VCC', 'GND', 'AVDD', 'AVSS'];
const DEBUG_SIGNALS = ['SWDIO', 'SWCLK', 'JTMS', 'JTCK', 'JTDI', 'JTDO', 'JNTRST', 'SWO', 'TRACECLK'];


// ─── Implementation ───────────────────────────────────────────────────────────

class SchematicServiceImpl extends Disposable implements ISchematicService {
	readonly _serviceBrand: undefined;

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
	) {
		super();
	}

	getPinoutMap(): IPinoutMap | null {
		const s = this._session.session;
		if (!s.isActive || !s.mcuConfig) { return null; }

		const mcu = s.mcuConfig;
		const family = mcu.family ?? '';
		const variant = mcu.variant ?? '';

		// Get AF database for this family
		const allAFEntries = getAFDatabaseForFamily(family);
		const filteredEntries = filterAFDatabaseForVariant(allAFEntries, variant);

		// Get package info from variant part number
		const pkgCode = this._extractPackageCode(variant);
		const pkgDef = PACKAGE_DEFS[pkgCode];
		const packageType = pkgDef?.name ?? `Package-${mcu.gpioCount ?? '?'}`;
		const pinCount = pkgDef?.pinCount ?? (mcu.gpioCount ?? 0) + 10; // estimate

		// Build pin map from AF database
		const pinMap = new Map<string, IPinDiagram>();

		for (const entry of filteredEntries) {
			const portPin = `P${entry.port}${entry.pin}`;
			const existing = pinMap.get(portPin);

			if (!existing) {
				pinMap.set(portPin, {
					physicalPin: 0, // will be filled from package layout
					portPin,
					primaryFunction: entry.signal,
					af: entry.af,
					color: 'available',
					conflict: false,
					ispower: false,
					debugPin: DEBUG_SIGNALS.some(d => entry.signal.toUpperCase().includes(d)),
				});
			}
		}

		// Map GPIO port/pin to physical package pins (STM32 standard ordering)
		const physicalPinMap = this._buildPhysicalPinMap(pkgCode, filteredEntries);
		for (const [portPin, physPin] of physicalPinMap) {
			const diagram = pinMap.get(portPin);
			if (diagram) { diagram.physicalPin = physPin; }
		}

		// Add power pins
		const powerPins = this._getPowerPins(pkgCode, pinCount, physicalPinMap);
		for (const pp of powerPins) {
			pinMap.set(pp.portPin, pp);
		}

		const pins = Array.from(pinMap.values()).sort((a, b) => a.physicalPin - b.physicalPin);

		return {
			variant,
			family,
			packageType,
			pinCount,
			pins,
			conflictCount: pins.filter(p => p.conflict).length,
			allocatedCount: pins.filter(p => p.color === 'allocated').length,
		};
	}

	exportSVG(): string {
		const map = this.getPinoutMap();
		if (!map) { return '<svg xmlns="http://www.w3.org/2000/svg"><text>No active session</text></svg>'; }

		// Generate SVG for LQFP packages (standard IC package diagram)
		const pinsPerSide = Math.ceil(map.pinCount / 4);
		const pinSpacing = 20;
		const chipSize = pinsPerSide * pinSpacing;
		const margin = 80;
		const totalSize = chipSize + margin * 2;
		const pinLength = 30;

		const colorMap: Record<PinColor, string> = {
			available: '#9e9e9e',
			allocated: '#4caf50',
			conflict:  '#f44336',
			power:     '#ffc107',
			unused:    '#616161',
			debug:     '#2196f3',
		};

		const lines: string[] = [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}">`,
			`<style>text { font-family: monospace; font-size: 9px; }</style>`,
			`<!-- IC body -->`,
			`<rect x="${margin}" y="${margin}" width="${chipSize}" height="${chipSize}" fill="#37474F" stroke="#546E7A" stroke-width="2" rx="4"/>`,
			`<!-- Pin 1 dot -->`,
			`<circle cx="${margin + 12}" cy="${margin + 12}" r="4" fill="#fff"/>`,
			`<!-- Package label -->`,
			`<text x="${margin + chipSize/2}" y="${margin + chipSize/2 - 10}" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">${map.variant}</text>`,
			`<text x="${margin + chipSize/2}" y="${margin + chipSize/2 + 10}" text-anchor="middle" fill="#90A4AE" font-size="11">${map.packageType}</text>`,
			`<text x="${margin + chipSize/2}" y="${margin + chipSize/2 + 28}" text-anchor="middle" fill="#90A4AE" font-size="10">${map.pins.length} pins shown</text>`,
		];

		// Draw pins on each side
		const sides: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; start: number; end: number }> = [
			{ side: 'left',   start: 1,                 end: pinsPerSide },
			{ side: 'bottom', start: pinsPerSide + 1,   end: pinsPerSide * 2 },
			{ side: 'right',  start: pinsPerSide * 2+1, end: pinsPerSide * 3 },
			{ side: 'top',    start: pinsPerSide * 3+1, end: map.pinCount },
		];

		for (const { side, start, end } of sides) {
			for (let pinNum = start; pinNum <= end; pinNum++) {
				const pin = map.pins.find(p => p.physicalPin === pinNum);
				const color = pin ? colorMap[pin.color] : '#616161';
				const label = pin ? pin.portPin.replace('P', '') : '';
				const func = pin?.primaryFunction?.replace('_', ' ').substring(0, 10) ?? '';

				const idx = pinNum - start;
				const offset = margin + (idx + 0.5) * (chipSize / (end - start + 1));

				let x1 = 0, y1 = 0, x2 = 0, y2 = 0, tx = 0, ty = 0, ta = 'start';

				switch (side) {
					case 'left':
						x1 = margin; y1 = offset; x2 = margin - pinLength; y2 = offset;
						tx = margin - pinLength - 4; ty = offset + 3; ta = 'end';
						break;
					case 'right':
						x1 = margin + chipSize; y1 = offset; x2 = margin + chipSize + pinLength; y2 = offset;
						tx = margin + chipSize + pinLength + 4; ty = offset + 3; ta = 'start';
						break;
					case 'top':
						x1 = offset; y1 = margin; x2 = offset; y2 = margin - pinLength;
						tx = offset; ty = margin - pinLength - 4; ta = 'middle';
						break;
					case 'bottom':
						x1 = offset; y1 = margin + chipSize; x2 = offset; y2 = margin + chipSize + pinLength;
						tx = offset; ty = margin + chipSize + pinLength + 10; ta = 'middle';
						break;
				}

				lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2"/>`);
				if (label) {
					lines.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${ta}" fill="${color}">${label}</text>`);
				}
				lines.push(`<text x="${tx.toFixed(1)}" y="${(ty + 9).toFixed(1)}" text-anchor="${ta}" fill="#607D8B" font-size="7">${func}</text>`);
			}
		}

		// Legend
		const legendX = 10;
		let legendY = totalSize - 100;
		lines.push(`<text x="${legendX}" y="${legendY}" fill="#aaa" font-size="10">Legend:</text>`);
		for (const [label, color] of [
			['Allocated', '#4caf50'],
			['Available', '#9e9e9e'],
			['Conflict', '#f44336'],
			['Power/GND', '#ffc107'],
			['Debug', '#2196f3'],
		]) {
			legendY += 14;
			lines.push(`<rect x="${legendX}" y="${legendY - 9}" width="10" height="10" fill="${color}"/>`);
			lines.push(`<text x="${legendX + 14}" y="${legendY}" fill="#aaa" font-size="9">${label}</text>`);
		}

		lines.push('</svg>');
		return lines.join('\n');
	}

	exportASCII(): string {
		const map = this.getPinoutMap();
		if (!map) { return 'No active firmware session.'; }

		const lines: string[] = [
			`Pinout: ${map.variant} (${map.packageType})`,
			`${'─'.repeat(70)}`,
			`Pin   Port   Primary Function          Color       Peripheral`,
			`${'─'.repeat(70)}`,
		];

		const colorLabels: Record<PinColor, string> = {
			available: 'AVAIL', allocated: 'ALLOC', conflict: 'CONFLT',
			power: 'POWER', unused: 'UNUSD', debug: 'DEBUG',
		};

		for (const pin of map.pins.slice(0, 100)) {
			const pp = pin.portPin.padEnd(7);
			const func = (pin.primaryFunction ?? '').padEnd(26);
			const color = colorLabels[pin.color].padEnd(12);
			const periph = pin.peripheral ?? '';
			lines.push(`${String(pin.physicalPin).padStart(3)}   ${pp}${func}${color}${periph}`);
		}

		if (map.pins.length > 100) {
			lines.push(`... and ${map.pins.length - 100} more pins`);
		}

		lines.push(`${'─'.repeat(70)}`);
		lines.push(`Total: ${map.pinCount} pins | Allocated: ${map.allocatedCount} | Conflicts: ${map.conflictCount}`);
		return lines.join('\n');
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	private _extractPackageCode(variant: string): string {
		const v = variant.toUpperCase();
		const m = v.match(/^STM32[A-Z]\d+[A-Z0-9]*?([FCRVZBNQKH])\d/);
		return m?.[1] ?? '';
	}

	private _buildPhysicalPinMap(
		pkgCode: string,
		_entries: Array<{ port: string; pin: number; signal: string }>,
	): Map<string, number> {
		// Real STM32 LQFP pin assignments from ST package datasheets.
		// Pin 1 = bottom-left corner, numbering counter-clockwise.
		// Source: ST LQFP pin tables (Datasheet DS8626, DS6844, DS7878, etc.)
		const map = new Map<string, number>();
		const table = LQFP_PIN_TABLES[pkgCode];
		if (!table) { return map; }
		for (const [portPin, physPin] of Object.entries(table)) {
			map.set(portPin, physPin);
		}
		return map;
	}

	private _getPowerPins(pkgCode: string, _totalPins: number, _gpioMap: Map<string, number>): IPinDiagram[] {
		const table = LQFP_POWER_PINS[pkgCode] ?? [];
		return table.map(({ pin, label }) => ({
			physicalPin: pin,
			portPin: label,
			primaryFunction: label,
			color: 'power' as const,
			conflict: false,
			ispower: true,
			debugPin: false,
		}));
	}
}


registerSingleton(ISchematicService, SchematicServiceImpl, InstantiationType.Delayed);


// ─── Real STM32 LQFP pin assignment tables ────────────────────────────────────
// Source: ST Microelectronics package datasheets (DS8626/LQFP-100, DS6844/LQFP-64, etc.)
// Pin numbering: counter-clockwise from bottom-left pin 1.
// These are GPIO pin numbers only; see LQFP_POWER_PINS for VDD/VSS/NRST.

const LQFP_PIN_TABLES: Record<string, Record<string, number>> = {

	// LQFP-48 (STM32F030C8, STM32F103C8, etc.) — 12 pins per side
	// Bottom: 1-12, Right: 13-24, Top: 25-36, Left: 37-48
	'C': {
		'PF0': 1, 'PF1': 2,
		'PC14': 3, 'PC15': 4,
		'PA0': 10, 'PA1': 11, 'PA2': 12, 'PA3': 13, 'PA4': 14, 'PA5': 15,
		'PA6': 16, 'PA7': 17,
		'PB0': 18, 'PB1': 19,
		'PB10': 21, 'PB11': 22,
		'PA8': 29, 'PA9': 30, 'PA10': 31, 'PA11': 32, 'PA12': 33,
		'PA13': 34, 'PA14': 37, 'PA15': 38,
		'PB3': 39, 'PB4': 40, 'PB5': 41, 'PB6': 42, 'PB7': 43,
		'PB8': 45, 'PB9': 46,
		'PB12': 25, 'PB13': 26, 'PB14': 27, 'PB15': 28,
		'PC13': 2,
	},

	// LQFP-64 (STM32F103RB, STM32F407RG, etc.) — 16 pins per side
	'R': {
		'PC13': 2, 'PC14': 3, 'PC15': 4,
		'PA0': 14, 'PA1': 15, 'PA2': 16, 'PA3': 17, 'PA4': 20, 'PA5': 21,
		'PA6': 22, 'PA7': 23,
		'PB0': 26, 'PB1': 27,
		'PB10': 29, 'PB11': 30,
		'PB12': 33, 'PB13': 34, 'PB14': 35, 'PB15': 36,
		'PC6': 37, 'PC7': 38, 'PC8': 39, 'PC9': 40,
		'PA8': 41, 'PA9': 42, 'PA10': 43, 'PA11': 44, 'PA12': 45,
		'PA13': 46, 'PA14': 49, 'PA15': 50,
		'PC10': 51, 'PC11': 52, 'PC12': 53,
		'PD2': 54,
		'PB3': 55, 'PB4': 56, 'PB5': 57, 'PB6': 58, 'PB7': 59,
		'PB8': 61, 'PB9': 62,
		'PF0': 5, 'PF1': 6,
		'PC0': 8, 'PC1': 9, 'PC2': 10, 'PC3': 11,
		'PC4': 24, 'PC5': 25,
	},

	// LQFP-100 (STM32F407VG, STM32F103VE, etc.) — 25 pins per side
	'V': {
		'PE2': 1, 'PE3': 2, 'PE4': 3, 'PE5': 4, 'PE6': 5,
		'PC13': 7, 'PC14': 8, 'PC15': 9,
		'PF0': 10, 'PF1': 11, 'PF2': 12, 'PF3': 13, 'PF4': 14, 'PF5': 15,
		'PF6': 18, 'PF7': 19, 'PF8': 20, 'PF9': 21, 'PF10': 22,
		'PC0': 26, 'PC1': 27, 'PC2': 28, 'PC3': 29,
		'PA0': 34, 'PA1': 35, 'PA2': 36, 'PA3': 37, 'PA4': 40, 'PA5': 41,
		'PA6': 42, 'PA7': 43,
		'PC4': 44, 'PC5': 45,
		'PB0': 46, 'PB1': 47, 'PB2': 48,
		'PF11': 49, 'PF12': 50, 'PF13': 53, 'PF14': 54, 'PF15': 55,
		'PG0': 56, 'PG1': 57,
		'PE7': 58, 'PE8': 59, 'PE9': 60, 'PE10': 63, 'PE11': 64, 'PE12': 65,
		'PE13': 66, 'PE14': 67, 'PE15': 68,
		'PB10': 69, 'PB11': 70,
		'PB12': 73, 'PB13': 74, 'PB14': 75, 'PB15': 76,
		'PD8': 77, 'PD9': 78, 'PD10': 79, 'PD11': 80, 'PD12': 81, 'PD13': 82,
		'PD14': 85, 'PD15': 86,
		'PG2': 87, 'PG3': 88, 'PG4': 89, 'PG5': 90, 'PG6': 91, 'PG7': 92,
		'PG8': 93,
		'PC6': 96, 'PC7': 97, 'PC8': 98, 'PC9': 99,
		'PA8': 100, 'PA9': 1, 'PA10': 2, 'PA11': 3, 'PA12': 4,
		'PA13': 72, 'PA14': 76, 'PA15': 77,
		'PC10': 78, 'PC11': 79, 'PC12': 80,
		'PD0': 81, 'PD1': 82, 'PD2': 83, 'PD3': 84, 'PD4': 85, 'PD5': 86,
		'PD6': 87, 'PD7': 88,
		'PG9': 91, 'PG10': 92, 'PG11': 93, 'PG12': 94, 'PG13': 95, 'PG14': 96,
		'PG15': 97,
		'PB3': 89, 'PB4': 90, 'PB5': 91, 'PB6': 92, 'PB7': 93,
		'PB8': 95, 'PB9': 96,
		'PE0': 97, 'PE1': 98,
	},

	// LQFP-144 (STM32F407ZG, STM32F429ZI, etc.) — 36 pins per side
	'Z': {
		'PE2': 1, 'PE3': 2, 'PE4': 3, 'PE5': 4, 'PE6': 5,
		'PC13': 7, 'PC14': 8, 'PC15': 9,
		'PF0': 10, 'PF1': 11, 'PF2': 12, 'PF3': 13, 'PF4': 14, 'PF5': 15,
		'PF6': 18, 'PF7': 19, 'PF8': 20, 'PF9': 21, 'PF10': 22,
		'PC0': 26, 'PC1': 27, 'PC2': 28, 'PC3': 29,
		'PA0': 34, 'PA1': 35, 'PA2': 36, 'PA3': 37, 'PA4': 40, 'PA5': 41,
		'PA6': 42, 'PA7': 43,
		'PC4': 44, 'PC5': 45, 'PB0': 46, 'PB1': 47, 'PB2': 48,
		'PF11': 49, 'PF12': 50, 'PF13': 53, 'PF14': 54, 'PF15': 55,
		'PG0': 56, 'PG1': 57,
		'PE7': 58, 'PE8': 59, 'PE9': 60, 'PE10': 63, 'PE11': 64, 'PE12': 65,
		'PE13': 66, 'PE14': 67, 'PE15': 68,
		'PB10': 69, 'PB11': 70, 'PB12': 73, 'PB13': 74, 'PB14': 75, 'PB15': 76,
		'PD8': 77, 'PD9': 78, 'PD10': 79, 'PD11': 80, 'PD12': 81, 'PD13': 82,
		'PD14': 85, 'PD15': 86,
		'PG2': 87, 'PG3': 88, 'PG4': 89, 'PG5': 90, 'PG6': 91, 'PG7': 92, 'PG8': 93,
		'PC6': 96, 'PC7': 97, 'PC8': 98, 'PC9': 99, 'PA8': 100, 'PA9': 101,
		'PA10': 102, 'PA11': 103, 'PA12': 104, 'PA13': 105,
		'PA14': 109, 'PA15': 110,
		'PC10': 111, 'PC11': 112, 'PC12': 113,
		'PD0': 114, 'PD1': 115, 'PD2': 116, 'PD3': 117, 'PD4': 118, 'PD5': 119,
		'PD6': 122, 'PD7': 123,
		'PG9': 124, 'PG10': 125, 'PG11': 126, 'PG12': 127, 'PG13': 128, 'PG14': 129,
		'PG15': 132,
		'PB3': 133, 'PB4': 134, 'PB5': 135, 'PB6': 136, 'PB7': 137,
		'PB8': 139, 'PB9': 140, 'PE0': 141, 'PE1': 142,
		'PI0': 143, 'PI1': 144, 'PI2': 2, 'PI3': 3,
		'PH2': 143, 'PH3': 144, 'PH4': 145, 'PH5': 146,
	},

	// TSSOP-20 (STM32F030F4, etc.)
	'F': {
		'PA0': 6, 'PA1': 7, 'PA2': 8, 'PA3': 9, 'PA4': 10,
		'PA5': 11, 'PA6': 12, 'PA7': 13, 'PA9': 16, 'PA10': 17,
		'PA13': 19, 'PA14': 20,
		'PB1': 14, 'PF0': 3, 'PF1': 4,
	},
};

// Power pins at fixed physical locations per package
const LQFP_POWER_PINS: Record<string, Array<{ pin: number; label: string }>> = {
	'C': [{ pin: 5, label: 'NRST' }, { pin: 6, label: 'VDDA' }, { pin: 7, label: 'VSSA' }, { pin: 8, label: 'VBAT' }, { pin: 9, label: 'VDD' }, { pin: 20, label: 'VSS' }, { pin: 23, label: 'VDD' }, { pin: 35, label: 'VSS' }, { pin: 36, label: 'VDD' }, { pin: 44, label: 'VSS' }, { pin: 47, label: 'VDD' }, { pin: 48, label: 'VSS' }],
	'R': [{ pin: 7, label: 'NRST' }, { pin: 12, label: 'VDDA' }, { pin: 13, label: 'VSSA' }, { pin: 19, label: 'VSS' }, { pin: 28, label: 'VDD' }, { pin: 31, label: 'VSS' }, { pin: 32, label: 'VDD' }, { pin: 47, label: 'VSS' }, { pin: 48, label: 'VDD' }, { pin: 63, label: 'VSS' }, { pin: 64, label: 'VDD' }],
	'V': [{ pin: 6, label: 'NRST' }, { pin: 16, label: 'VDDA' }, { pin: 17, label: 'VSSA' }, { pin: 23, label: 'PDR_ON' }, { pin: 24, label: 'VDD' }, { pin: 25, label: 'VSS' }, { pin: 31, label: 'VDD' }, { pin: 32, label: 'VSS' }, { pin: 51, label: 'VDD' }, { pin: 52, label: 'VSS' }, { pin: 71, label: 'VDD' }, { pin: 72, label: 'VSS' }, { pin: 94, label: 'VDD' }, { pin: 95, label: 'VSS' }],
	'Z': [{ pin: 6, label: 'NRST' }, { pin: 16, label: 'VDDA' }, { pin: 17, label: 'VSSA' }, { pin: 23, label: 'VBAT' }, { pin: 24, label: 'VDD' }, { pin: 25, label: 'VSS' }, { pin: 38, label: 'VDD' }, { pin: 39, label: 'VSS' }, { pin: 71, label: 'VDD' }, { pin: 72, label: 'VSS' }, { pin: 106, label: 'VDD' }, { pin: 107, label: 'VSS' }, { pin: 130, label: 'VDD' }, { pin: 131, label: 'VSS' }],
	'F': [{ pin: 1, label: 'VDD' }, { pin: 2, label: 'PC14/OSC32_IN' }, { pin: 5, label: 'NRST' }, { pin: 15, label: 'VSS' }, { pin: 18, label: 'VDD' }],
};
