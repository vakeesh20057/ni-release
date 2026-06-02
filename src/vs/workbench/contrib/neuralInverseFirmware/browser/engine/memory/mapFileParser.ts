/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * GNU ld / arm-none-eabi-ld .map file parser.
 *
 * Extracts real section sizes from build output. Handles:
 *   - GNU ld Memory Configuration block  -> flash/RAM totals + origins
 *   - Linker map section table           -> per-section address + size
 *   - IAR .map format (subset)
 *   - armcc / Keil .map format (subset)
 */

import { IRegionBudget, ISectionAllocation, IMemoryBudget } from './memoryTypes.js';

// Section -> category mapping
const SECTION_CATEGORY: Record<string, string> = {
	'.isr_vector': '.isr_vector',
	'.text':       '.text',
	'.rodata':     '.rodata',
	'.ARM':        '.rodata',
	'.init':       '.text',
	'.fini':       '.text',
	'.ARM.extab':  '.rodata',
	'.ARM.exidx':  '.rodata',
	'.data':       '.data',
	'.fastdata':   '.data',
	'.ramfunc':    '.data',
	'.bss':        '.bss',
	'.noinit':     '.bss',
	'._user_heap_stack': '.heap+stack',
	'.heap':       '.heap',
	'.stack':      '.stack',
};

export interface IParsedMapFile {
	sections: ISectionAllocation[];
	flashRegions: IRegionBudget[];
	ramRegions:   IRegionBudget[];
	warnings:     string[];
}

/** Parse a GNU ld .map file text, optionally using MCU flash/RAM from session. */
export function parseMapFile(text: string, fallbackFlash?: number, fallbackRam?: number): IMemoryBudget {
	const sections: ISectionAllocation[] = [];
	const warnings: string[] = [];

	// ---
	// Format:
	// Memory Configuration
	// Name             Origin             Length             Attributes
	// FLASH            0x0000000008000000 0x0000000000010000 xr
	// RAM              0x0000000020000000 0x0000000000001000 xrw
	interface MemRegion { name: string; origin: number; length: number; attrs: string; }
	const memRegions: MemRegion[] = [];
	const memConfigRe = /^(\w+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(\S*)/mg;
	let inMemConfig = false;
	for (const line of text.split('\n')) {
		if (line.includes('Memory Configuration')) { inMemConfig = true; continue; }
		if (inMemConfig && line.includes('Linker script and memory map')) { inMemConfig = false; continue; }
		if (inMemConfig) {
			const m = memConfigRe.exec(line);
			if (m && m[1] !== 'Name' && m[1] !== '*default*') {
				memRegions.push({ name: m[1]!, origin: parseInt(m[2]!, 16), length: parseInt(m[3]!, 16), attrs: m[4] || '' });
			}
			memConfigRe.lastIndex = 0;
		}
	}

	// ---
	// Format:
	// .text           0x0000000008000188     0x3e98
	//  .text          0x0000000008000188      0xdc ./build/main.o
	// We want the top-level entries (2 spaces indent or no indent, not sub-entries with object files)
	const sectionRe = /^(\.[\w.]+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)/;
	// Also handle: .section  address  size  file — skip lines with filename (4th token ending in .o/.a)
	const seenSections = new Set<string>();
	for (const line of text.split('\n')) {
		// Top-level section lines start at column 0 or 1 space
		if (!line.match(/^\.|\s{1}(\.\S)/)) continue;
		const m = sectionRe.exec(line.trim());
		if (!m) continue;
		const name = m[1]!;
		const addr = parseInt(m[2]!, 16);
		const size = parseInt(m[3]!, 16);
		if (size === 0) continue;
		if (seenSections.has(name)) continue;
		seenSections.add(name);
		sections.push({ name, size, address: addr });
	}

	// IAR format: " .text  0x..  0x.. " in ILINK map
	// armcc/Keil format: "    .text             0x00000000  Code  12345"
	if (sections.length === 0) {
		// Try Keil/armcc: section name, address, type, size
		const keilRe = /^\s+(\.[\w.]+)\s+(0x[0-9a-fA-F]+)\s+\w+\s+(\d+)/mg;
		let km: RegExpExecArray | null;
		while ((km = keilRe.exec(text)) !== null) {
			const size = parseInt(km[3]!, 10);
			if (size > 0) {
				sections.push({ name: km[1]!, size, address: parseInt(km[2]!, 16) });
			}
		}
	}

	if (sections.length === 0) {
		warnings.push('Could not parse section table. Verify this is a GNU ld, Keil, or IAR .map file.');
	}

	// ---
	// Identify FLASH and RAM regions from parsed memory config
	const isFlash = (r: MemRegion) => r.attrs.includes('x') && !r.attrs.includes('w') || r.name.toUpperCase().includes('FLASH') || r.name.toUpperCase().includes('ROM');
	const isRam   = (r: MemRegion) => r.attrs.includes('w') && r.name.toUpperCase() !== 'FLASH' || r.name.toUpperCase().includes('RAM') || r.name.toUpperCase().includes('SRAM');

	let flashRegions: MemRegion[] = memRegions.filter(isFlash);
	let ramRegions:   MemRegion[] = memRegions.filter(isRam);

	// Fallback: synthesise from MCU config if .map had no Memory Configuration
	if (flashRegions.length === 0 && fallbackFlash) {
		flashRegions = [{ name: 'FLASH', origin: 0x08000000, length: fallbackFlash, attrs: 'xr' }];
	}
	if (ramRegions.length === 0 && fallbackRam) {
		ramRegions = [{ name: 'RAM', origin: 0x20000000, length: fallbackRam, attrs: 'xrw' }];
	}

	const buildBudget = (regions: MemRegion[]): IRegionBudget[] => {
		return regions.map(reg => {
			const mine = sections.filter(sec =>
				sec.address >= reg.origin && sec.address < reg.origin + reg.length
			);
			const used = mine.reduce((a, s) => a + s.size, 0);
			return {
				name: reg.name,
				origin: reg.origin,
				size: reg.length,
				used,
				free: Math.max(0, reg.length - used),
				usagePercent: reg.length > 0 ? Math.round(used / reg.length * 100) : 0,
				sections: mine,
			} satisfies IRegionBudget;
		});
	};

	const flashBudgets = buildBudget(flashRegions);
	const ramBudgets   = buildBudget(ramRegions);

	const totalFlashUsed = flashBudgets.reduce((a, r) => a + r.used, 0);
	const totalFlashAvail = flashBudgets.reduce((a, r) => a + r.size, 0) || fallbackFlash || 0;
	const totalRamUsed   = ramBudgets.reduce((a, r) => a + r.used, 0);
	const totalRamAvail  = ramBudgets.reduce((a, r) => a + r.size, 0) || fallbackRam || 0;

	// Stack overflow risk
	const stackSec = sections.find(s => s.name.includes('stack') || s.name.includes('Stack'));
	const stackConfigured = stackSec ? stackSec.size : 0;
	const ramUsagePct = totalRamAvail > 0 ? totalRamUsed / totalRamAvail : 0;
	const stackRisk = !stackConfigured ? 'unknown'
		: ramUsagePct > 0.95 ? 'overflow-likely'
		: ramUsagePct > 0.80 ? 'tight'
		: 'safe';

	if (ramUsagePct > 0.90) {
		warnings.push(`RAM usage ${Math.round(ramUsagePct * 100)}% — stack overflow risk is high.`);
	}
	if (totalFlashAvail > 0 && totalFlashUsed / totalFlashAvail > 0.90) {
		warnings.push(`Flash usage ${Math.round(totalFlashUsed / totalFlashAvail * 100)}% — approaching capacity.`);
	}

	return {
		regions: [...flashBudgets, ...ramBudgets],
		totalFlashUsed,
		totalFlashAvailable: totalFlashAvail,
		totalRAMUsed: totalRamUsed,
		totalRAMAvailable: totalRamAvail,
		stackOverflowRisk: stackRisk,
		warnings,
	} satisfies IMemoryBudget;
}

/** Group a flat section list into display categories for the bar chart. */
export function groupSectionsForChart(secs: ISectionAllocation[]): Array<{label: string; size: number;}> {
	const groups: Record<string, number> = {};
	for (const s of secs) {
		// Find category
		let cat = SECTION_CATEGORY[s.name];
		if (!cat) {
			if (s.name.startsWith('.text') || s.name.startsWith('.init') || s.name.startsWith('.fini')) cat = '.text';
			else if (s.name.startsWith('.rodata') || s.name.startsWith('.ARM')) cat = '.rodata';
			else if (s.name.startsWith('.data') || s.name.startsWith('.ram')) cat = '.data';
			else if (s.name.startsWith('.bss') || s.name.startsWith('.noinit')) cat = '.bss';
			else if (s.name.includes('heap')) cat = '.heap';
			else if (s.name.includes('stack')) cat = '.stack';
			else cat = 'other';
		}
		groups[cat] = (groups[cat] || 0) + s.size;
	}
	return Object.entries(groups)
		.filter(([,v]) => v > 0)
		.map(([label, size]) => ({ label, size }));
}

/** Find .map files in a workspace folder list (returns paths, caller reads). */
export function findMapFileCandidates(fileList: string[]): string[] {
	return fileList
		.filter(f => f.endsWith('.map'))
		.sort((a, b) => {
			// Prefer build/ output dirs, prefer larger files
			const scoreA = (a.includes('/build/') || a.includes('/out/') || a.includes('/Debug/') || a.includes('/Release/')) ? 1 : 0;
			const scoreB = (b.includes('/build/') || b.includes('/out/') || b.includes('/Debug/') || b.includes('/Release/')) ? 1 : 0;
			return scoreB - scoreA;
		});
}
