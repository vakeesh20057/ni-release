/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IErrataService } from '../errata/errataService.js';


export function buildErrataTools(errataService: IErrataService): IVoidInternalTool[] {
	return [
		_fwErrataSearch(errataService),
		_fwErrataCheck(errataService),
	];
}


function _fwErrataSearch(svc: IErrataService): IVoidInternalTool {
	return {
		name: 'fw_errata_search',
		description: 'Search the built-in silicon errata database for the current MCU. Returns known hardware bugs with workarounds. Searches across 7+ MCU families (STM32F4, STM32L4, STM32H7, STM32G4, STM32F1, nRF52, ESP32, RP2040).',
		params: {
			peripheral: { description: 'Filter by peripheral name (e.g. "I2C", "SPI", "DMA", "USB", "RADIO")' },
		},
		execute: async (args: Record<string, any>) => {
			const peripheral = args.peripheral as string | undefined;

			const errata = peripheral
				? svc.getForPeripheral(peripheral)
				: svc.getAllErrata();

			if (errata.length === 0) {
				return peripheral
					? `No errata found for peripheral "${peripheral}" on this MCU.`
					: 'No errata found. Ensure a firmware session is active with an MCU configured, or upload a datasheet.';
			}

			const lines = [`Silicon Errata (${errata.length}):`, ''];
			for (const e of errata) {
				lines.push(`[${e.severity.toUpperCase()}] ${e.id} — ${e.title}`);
				lines.push(`  Peripheral: ${e.affectedPeripheral}`);
				lines.push(`  ${e.description}`);
				if (e.workaround) lines.push(`  ★ Workaround: ${e.workaround}`);
				lines.push(`  Revisions: ${e.affectedRevisions.join(', ')}${e.fixedInRevision ? ` (fixed in ${e.fixedInRevision})` : ''}`);
				lines.push('');
			}
			return lines.join('\n');
		},
	};
}


function _fwErrataCheck(svc: IErrataService): IVoidInternalTool {
	return {
		name: 'fw_errata_check_operation',
		description: 'Check if a planned operation is affected by any known silicon errata. Use this proactively before configuring a peripheral to catch hardware bugs early.',
		params: {
			peripheral: { description: 'Peripheral being configured (e.g. "I2C1", "USART2", "DMA2")' },
			operation: { description: 'What you are doing (e.g. "DMA transfer with USART in half-duplex mode", "I2C communication at 400kHz")' },
			register: { description: 'Optional: specific register being written (e.g. "BRR", "CR1", "FLTR")' },
		},
		execute: async (args: Record<string, any>) => {
			const peripheral = args.peripheral as string;
			const operation = args.operation as string;
			const register = args.register as string | undefined;

			if (!peripheral && !operation) return 'Provide at least a peripheral or operation description.';

			const matches = svc.checkOperation({ peripheral, operation, register });

			if (matches.length === 0) {
				return `No known errata affecting "${peripheral ?? ''}" for operation "${operation ?? ''}". Proceed with normal configuration.`;
			}

			const lines = [`⚠ Found ${matches.length} relevant errata:`, ''];
			for (const m of matches.slice(0, 5)) {
				const e = m.errata;
				lines.push(`[${e.severity.toUpperCase()}] ${e.id} — ${e.title}`);
				lines.push(`  Match reason: ${m.matchReason}`);
				lines.push(`  ${e.description}`);
				if (e.workaround) lines.push(`  ★ Workaround: ${e.workaround}`);
				lines.push('');
			}

			if (matches.some(m => m.errata.severity === 'critical')) {
				lines.push('⛔ CRITICAL errata detected — apply workaround before proceeding.');
			}

			return lines.join('\n');
		},
	};
}
