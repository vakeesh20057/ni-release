/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Register Value Compositor
 *
 * Bidirectional register value computation:
 *   Forward: config → exact register values with per-bit annotations
 *   Reverse: hex value → human-readable field breakdown
 *   Diff: compare two register values, show which fields changed
 *
 * All computation uses SVD bit field definitions. No LLM calls.
 */

import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IRegister, IBitField } from '../../../common/firmwareTypes.js';
import {
	IDecodedRegister, IDecodedField,
	IRegisterDiff, IFieldDiff,
} from './compositorTypes.js';

export class RegisterCompositorService {

	constructor(private readonly _session: IFirmwareSessionService) {}

	decodeRegisterValue(peripheral: string, register: string, value: number): IDecodedRegister | null {
		const reg = this._findRegister(peripheral, register);
		if (!reg) { return null; }

		const fields: IDecodedField[] = [];
		let accountedBits = 0;

		for (const field of reg.fields ?? []) {
			const mask = ((1 << field.bitWidth) - 1) << field.bitOffset;
			const fieldValue = (value & mask) >>> field.bitOffset;
			accountedBits |= mask;

			const meaning = this._resolveFieldMeaning(field, fieldValue);

			fields.push({
				name: field.name,
				bitOffset: field.bitOffset,
				bitWidth: field.bitWidth,
				rawValue: fieldValue,
				meaning,
				access: field.access ?? 'rw',
			});
		}

		const unknownBits = value & ~accountedBits;

		return {
			peripheral: peripheral.toUpperCase(),
			register: register.toUpperCase(),
			rawValue: value,
			hexString: `0x${value.toString(16).toUpperCase().padStart(8, '0')}`,
			binaryString: value.toString(2).padStart(32, '0'),
			fields: fields.sort((a, b) => b.bitOffset - a.bitOffset),
			unknownBits,
		};
	}

	composeRegisterValue(peripheral: string, register: string, fieldValues: Record<string, number>): number | null {
		const reg = this._findRegister(peripheral, register);
		if (!reg) { return null; }

		let value = 0;

		for (const [fieldName, fieldValue] of Object.entries(fieldValues)) {
			const field = reg.fields?.find(f => f.name.toUpperCase() === fieldName.toUpperCase());
			if (!field) { continue; }

			const mask = ((1 << field.bitWidth) - 1);
			const clampedValue = fieldValue & mask;
			value |= (clampedValue << field.bitOffset);
		}

		return value;
	}

	diffRegisters(peripheral: string, register: string, before: number, after: number): IRegisterDiff | null {
		const reg = this._findRegister(peripheral, register);
		if (!reg) { return null; }

		const changedFields: IFieldDiff[] = [];

		for (const field of reg.fields ?? []) {
			const mask = ((1 << field.bitWidth) - 1) << field.bitOffset;
			const beforeField = (before & mask) >>> field.bitOffset;
			const afterField = (after & mask) >>> field.bitOffset;

			if (beforeField !== afterField) {
				changedFields.push({
					name: field.name,
					bitOffset: field.bitOffset,
					bitWidth: field.bitWidth,
					before: beforeField,
					beforeMeaning: this._resolveFieldMeaning(field, beforeField),
					after: afterField,
					afterMeaning: this._resolveFieldMeaning(field, afterField),
				});
			}
		}

		return {
			peripheral: peripheral.toUpperCase(),
			register: register.toUpperCase(),
			before,
			after,
			changedFields: changedFields.sort((a, b) => b.bitOffset - a.bitOffset),
		};
	}

	formatDecoded(decoded: IDecodedRegister): string {
		const lines = [
			`${decoded.peripheral}.${decoded.register} = ${decoded.hexString}`,
			`Binary: ${this._formatBinary(decoded.binaryString)}`,
			'',
			'Fields:',
		];

		for (const field of decoded.fields) {
			const bits = field.bitWidth === 1
				? `[${field.bitOffset}]`
				: `[${field.bitOffset + field.bitWidth - 1}:${field.bitOffset}]`;
			const val = field.bitWidth <= 4
				? `0b${field.rawValue.toString(2).padStart(field.bitWidth, '0')}`
				: `0x${field.rawValue.toString(16).toUpperCase()}`;
			lines.push(`  ${field.name.padEnd(16)} ${bits.padEnd(8)} = ${val.padEnd(8)} ${field.meaning}`);
		}

		if (decoded.unknownBits !== 0) {
			lines.push('');
			lines.push(`  [!] Unknown bits set: 0x${decoded.unknownBits.toString(16).toUpperCase()}`);
		}

		return lines.join('\n');
	}

	formatDiff(diff: IRegisterDiff): string {
		if (diff.changedFields.length === 0) {
			return `${diff.peripheral}.${diff.register}: no change (0x${diff.before.toString(16).toUpperCase()} → 0x${diff.after.toString(16).toUpperCase()})`;
		}

		const lines = [
			`${diff.peripheral}.${diff.register}: 0x${diff.before.toString(16).toUpperCase()} → 0x${diff.after.toString(16).toUpperCase()}`,
			`${diff.changedFields.length} field(s) changed:`,
			'',
		];

		for (const field of diff.changedFields) {
			lines.push(`  ${field.name}: ${field.beforeMeaning} → ${field.afterMeaning}`);
		}

		return lines.join('\n');
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private _findRegister(peripheral: string, register: string): IRegister | null {
		const s = this._session.session;
		if (!s.registerMaps) { return null; }

		const periphUpper = peripheral.toUpperCase();
		const regUpper = register.toUpperCase();

		const map = s.registerMaps.find(m =>
			m.name.toUpperCase() === periphUpper || m.groupName?.toUpperCase() === periphUpper
		);
		if (!map) { return null; }

		return map.registers.find(r => r.name.toUpperCase() === regUpper) ?? null;
	}

	private _resolveFieldMeaning(field: IBitField, value: number): string {
		if (field.enumeratedValues) {
			const enumMap = field.enumeratedValues as Record<string, string>;
			const enumVal = enumMap[value.toString()] ?? enumMap[`0x${value.toString(16)}`];
			if (enumVal) { return enumVal; }
		}

		if (field.bitWidth === 1) {
			return value ? 'enabled' : 'disabled';
		}

		return `${value} (0x${value.toString(16).toUpperCase()})`;
	}

	private _formatBinary(bin: string): string {
		return bin.replace(/(.{4})/g, '$1 ').trim();
	}
}
