/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Register value compositor agent tools
 *
 * Forward: config → register values with per-bit annotations
 * Reverse: hex value → human-readable field breakdown
 * Diff: compare two values, show what changed and why
 */

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { RegisterCompositorService } from '../registerCompositor/registerCompositorService.js';

export function buildRegisterValueTools(session: IFirmwareSessionService): IVoidInternalTool[] {
	const compositor = new RegisterCompositorService(session);

	return [
		_fwDecodeRegisterValue(session, compositor),
		_fwComputeRegisterValues(session, compositor),
		_fwDiffRegisterConfig(session, compositor),
	];
}


function _fwDecodeRegisterValue(session: IFirmwareSessionService, compositor: RegisterCompositorService): IVoidInternalTool {
	return {
		name: 'fw_decode_register_value',
		description: 'Decode a raw register value into human-readable field breakdown. Given a peripheral, register name, and hex/decimal value, returns every bit field with its meaning from the SVD. Eliminates the need to manually decode mystery values from the debugger.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1", "SPI2", "TIM3".' },
			register: { description: 'Register name, e.g. "CR1", "SR", "BRR".' },
			value: { description: 'Register value as number (decimal or hex string like "0x200C").' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const peripheral = args.peripheral as string | undefined;
			const register = args.register as string | undefined;
			if (!peripheral || !register) {
				return 'Provide peripheral (e.g. "USART1") and register (e.g. "CR1").';
			}

			let value: number;
			if (typeof args.value === 'number') {
				value = args.value;
			} else if (typeof args.value === 'string') {
				value = parseInt(args.value, args.value.startsWith('0x') ? 16 : 10);
			} else {
				return 'Provide value as number or hex string (e.g. 0x200C).';
			}

			if (isNaN(value)) { return 'Invalid value. Use decimal number or hex string (0x...).'; }

			const decoded = compositor.decodeRegisterValue(peripheral, register, value);
			if (!decoded) {
				return `Register ${peripheral}.${register} not found in loaded SVD data. Ensure register maps are loaded.`;
			}

			return compositor.formatDecoded(decoded);
		},
	};
}


function _fwComputeRegisterValues(session: IFirmwareSessionService, compositor: RegisterCompositorService): IVoidInternalTool {
	return {
		name: 'fw_compute_register_values',
		description: 'Compose a register value from field assignments. Given a peripheral, register, and desired field values, computes the exact numeric value with all bits correctly positioned. The inverse of fw_decode_register_value.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1".' },
			register: { description: 'Register name, e.g. "CR1".' },
			fields: { description: 'Object of field name → value, e.g. {"UE": 1, "TE": 1, "RE": 1, "M": 0, "PCE": 0}.' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const peripheral = args.peripheral as string | undefined;
			const register = args.register as string | undefined;
			const fields = args.fields as Record<string, number> | undefined;

			if (!peripheral || !register) {
				return 'Provide peripheral and register.';
			}
			if (!fields || typeof fields !== 'object') {
				return 'Provide fields as object, e.g. {"UE": 1, "TE": 1, "RE": 1}.';
			}

			const value = compositor.composeRegisterValue(peripheral, register, fields);
			if (value === null) {
				return `Register ${peripheral}.${register} not found in loaded SVD.`;
			}

			const decoded = compositor.decodeRegisterValue(peripheral, register, value);
			if (!decoded) {
				return `Computed value: 0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
			}

			const lines = [
				`Composed ${peripheral}.${register} = 0x${value.toString(16).toUpperCase().padStart(8, '0')}`,
				'',
				compositor.formatDecoded(decoded),
				'',
				'C code:',
				`  ${peripheral}->${register} = 0x${value.toString(16).toUpperCase()}UL;`,
			];

			return lines.join('\n');
		},
	};
}


function _fwDiffRegisterConfig(session: IFirmwareSessionService, compositor: RegisterCompositorService): IVoidInternalTool {
	return {
		name: 'fw_diff_register_config',
		description: 'Compare two register values and show which fields changed. Useful for debugging: "the register was 0x200C before and 0x200E after — what bit changed?" Returns field-level diff with human-readable meanings.',
		params: {
			peripheral: { description: 'Peripheral name, e.g. "USART1".' },
			register: { description: 'Register name, e.g. "CR1".' },
			before: { description: 'Register value before (decimal or hex string).' },
			after: { description: 'Register value after (decimal or hex string).' },
		},
		execute: async (args: Record<string, any>) => {
			const s = session.session;
			if (!s.isActive) { return 'No active firmware session.'; }

			const peripheral = args.peripheral as string | undefined;
			const register = args.register as string | undefined;
			if (!peripheral || !register) {
				return 'Provide peripheral and register.';
			}

			const parseFn = (v: any): number => {
				if (typeof v === 'number') { return v; }
				if (typeof v === 'string') { return parseInt(v, v.startsWith('0x') ? 16 : 10); }
				return NaN;
			};

			const before = parseFn(args.before);
			const after = parseFn(args.after);
			if (isNaN(before) || isNaN(after)) {
				return 'Provide before and after as numbers or hex strings.';
			}

			const diff = compositor.diffRegisters(peripheral, register, before, after);
			if (!diff) {
				return `Register ${peripheral}.${register} not found in loaded SVD.`;
			}

			return compositor.formatDiff(diff);
		},
	};
}
