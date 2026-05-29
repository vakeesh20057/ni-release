/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { RegisterCompositorService } from '../../../../browser/engine/registerCompositor/registerCompositorService.js';

suite('RegisterCompositorService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let service: RegisterCompositorService;

	const mockRegisterMap = {
		name: 'USART1',
		groupName: 'USART',
		baseAddress: 0x40011000,
		description: 'Universal synchronous asynchronous receiver transmitter',
		registers: [
			{
				name: 'CR1',
				addressOffset: 0x00,
				size: 32,
				access: 'rw',
				resetValue: 0x00000000,
				description: 'Control register 1',
				fields: [
					{ name: 'UE', bitOffset: 13, bitWidth: 1, access: 'rw', description: 'USART enable', enumeratedValues: { '0': 'Disabled', '1': 'Enabled' } },
					{ name: 'M', bitOffset: 12, bitWidth: 1, access: 'rw', description: 'Word length', enumeratedValues: { '0': '8 data bits', '1': '9 data bits' } },
					{ name: 'PCE', bitOffset: 10, bitWidth: 1, access: 'rw', description: 'Parity control enable' },
					{ name: 'TE', bitOffset: 3, bitWidth: 1, access: 'rw', description: 'Transmitter enable' },
					{ name: 'RE', bitOffset: 2, bitWidth: 1, access: 'rw', description: 'Receiver enable' },
				],
			},
			{
				name: 'SR',
				addressOffset: 0x00,
				size: 32,
				access: 'r',
				resetValue: 0x000000C0,
				description: 'Status register',
				fields: [
					{ name: 'TXE', bitOffset: 7, bitWidth: 1, access: 'r', description: 'Transmit data register empty' },
					{ name: 'RXNE', bitOffset: 5, bitWidth: 1, access: 'r', description: 'Read data register not empty' },
					{ name: 'TC', bitOffset: 6, bitWidth: 1, access: 'r', description: 'Transmission complete' },
				],
			},
		],
		interrupts: [],
	};

	const mockSession: any = {
		session: {
			isActive: true,
			registerMaps: [mockRegisterMap],
		},
	};

	setup(() => {
		service = new RegisterCompositorService(mockSession);
	});

	test('decodeRegisterValue(USART1, CR1, 0x200C) shows UE=1, TE=1, RE=1', () => {
		// 0x200C = 0010 0000 0000 1100
		// Bit 13 (UE) = 1, Bit 3 (TE) = 1, Bit 2 (RE) = 1
		const decoded = service.decodeRegisterValue('USART1', 'CR1', 0x200C);

		assert.ok(decoded);
		assert.strictEqual(decoded!.peripheral, 'USART1');
		assert.strictEqual(decoded!.register, 'CR1');

		const ue = decoded!.fields.find(f => f.name === 'UE');
		assert.ok(ue);
		assert.strictEqual(ue!.rawValue, 1);
		assert.strictEqual(ue!.meaning, 'Enabled');

		const te = decoded!.fields.find(f => f.name === 'TE');
		assert.ok(te);
		assert.strictEqual(te!.rawValue, 1);

		const re = decoded!.fields.find(f => f.name === 'RE');
		assert.ok(re);
		assert.strictEqual(re!.rawValue, 1);
	});

	test('decodeRegisterValue(USART1, CR1, 0) shows all fields disabled', () => {
		const decoded = service.decodeRegisterValue('USART1', 'CR1', 0);

		assert.ok(decoded);
		for (const field of decoded!.fields) {
			assert.strictEqual(field.rawValue, 0);
		}

		const ue = decoded!.fields.find(f => f.name === 'UE');
		assert.strictEqual(ue!.meaning, 'Disabled');
	});

	test('decodeRegisterValue(UNKNOWN, CR1, 0) returns null', () => {
		const decoded = service.decodeRegisterValue('UNKNOWN', 'CR1', 0);
		assert.strictEqual(decoded, null);
	});

	test('composeRegisterValue(USART1, CR1, { UE: 1, TE: 1, RE: 1 }) returns 0x200C', () => {
		const value = service.composeRegisterValue('USART1', 'CR1', { UE: 1, TE: 1, RE: 1 });

		// UE at bit 13 = 0x2000, TE at bit 3 = 0x8, RE at bit 2 = 0x4 → 0x200C
		assert.strictEqual(value, 0x200C);
	});

	test('composeRegisterValue(USART1, CR1, {}) returns 0', () => {
		const value = service.composeRegisterValue('USART1', 'CR1', {});
		assert.strictEqual(value, 0);
	});

	test('composeRegisterValue(UNKNOWN, CR1, {}) returns null', () => {
		const value = service.composeRegisterValue('UNKNOWN', 'CR1', {});
		assert.strictEqual(value, null);
	});

	test('diffRegisters(USART1, CR1, 0x2000, 0x200C) shows TE and RE changed', () => {
		// Before: UE=1 only. After: UE=1, TE=1, RE=1
		const diff = service.diffRegisters('USART1', 'CR1', 0x2000, 0x200C);

		assert.ok(diff);
		assert.strictEqual(diff!.changedFields.length, 2);

		const fieldNames = diff!.changedFields.map(f => f.name).sort();
		assert.deepStrictEqual(fieldNames, ['RE', 'TE']);

		const te = diff!.changedFields.find(f => f.name === 'TE');
		assert.ok(te);
		assert.strictEqual(te!.before, 0);
		assert.strictEqual(te!.after, 1);
	});

	test('diffRegisters(USART1, CR1, 0x200C, 0x200C) shows empty changedFields', () => {
		const diff = service.diffRegisters('USART1', 'CR1', 0x200C, 0x200C);

		assert.ok(diff);
		assert.strictEqual(diff!.changedFields.length, 0);
	});

	test('formatDecoded() includes hex string and field names', () => {
		const decoded = service.decodeRegisterValue('USART1', 'CR1', 0x200C);
		assert.ok(decoded);

		const formatted = service.formatDecoded(decoded!);

		assert.ok(formatted.includes('0x0000200C'), 'Should include hex value');
		assert.ok(formatted.includes('UE'), 'Should include UE field name');
		assert.ok(formatted.includes('TE'), 'Should include TE field name');
		assert.ok(formatted.includes('RE'), 'Should include RE field name');
		assert.ok(formatted.includes('USART1.CR1'), 'Should include register path');
	});

	test('formatDiff() with no changes shows "no change" message', () => {
		const diff = service.diffRegisters('USART1', 'CR1', 0x200C, 0x200C);
		assert.ok(diff);

		const formatted = service.formatDiff(diff!);
		assert.ok(formatted.includes('no change'), 'Should indicate no change');
	});
});
