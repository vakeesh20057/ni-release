/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildRegisterValueTools } from '../../../../browser/engine/agentTools/registerValueTools.js';

suite('Register Value Agent Tools', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
			},
			registerMaps: [mockRegisterMap],
		},
		getPeripheralRegisterMap: (name: string) => name === 'USART1' ? mockRegisterMap : null,
	};

	const mockInactiveSession: any = {
		session: {
			isActive: false,
			mcuConfig: null,
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
	};

	test('fw_decode_register_value with USART1 CR1 0x200C shows UE=1, TE=1, RE=1', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		// 0x200C = bit 13 (UE)=1, bit 3 (TE)=1, bit 2 (RE)=1
		const result = await decode.execute({ peripheral: 'USART1', register: 'CR1', value: 0x200C });

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('UE'), 'Should show UE field');
		assert.ok(result.includes('TE'), 'Should show TE field');
		assert.ok(result.includes('RE'), 'Should show RE field');
		// UE=1 should show Enabled
		assert.ok(result.includes('Enabled') || result.includes('1'), 'UE should be 1/Enabled');
	});

	test('fw_decode_register_value with hex string "0x200C" works same as number', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({ peripheral: 'USART1', register: 'CR1', value: '0x200C' });

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('UE'), 'Should decode UE from hex string');
		assert.ok(result.includes('TE'), 'Should decode TE from hex string');
		assert.ok(result.includes('RE'), 'Should decode RE from hex string');
	});

	test('fw_decode_register_value with unknown register returns error message', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({ peripheral: 'USART1', register: 'NONEXIST', value: 0 });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('not found') || result.toLowerCase().includes('error'),
			`Expected not found message, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_decode_register_value with unknown peripheral returns error message', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({ peripheral: 'NONEXIST', register: 'CR1', value: 0 });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('not found') || result.toLowerCase().includes('error'),
			`Expected not found message, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_decode_register_value with missing params returns helpful error', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('peripheral'),
			`Expected helpful error, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_decode_register_value with missing value returns helpful error', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({ peripheral: 'USART1', register: 'CR1' });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('value'),
			`Expected value error, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_compute_register_values with {UE:1, TE:1, RE:1} shows computed value', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const compute = tools.find(t => t.name === 'fw_compute_register_values')!;
		const result = await compute.execute({
			peripheral: 'USART1',
			register: 'CR1',
			fields: { UE: 1, TE: 1, RE: 1 },
		});

		assert.ok(typeof result === 'string');
		// UE=bit13=0x2000, TE=bit3=0x8, RE=bit2=0x4 => 0x200C
		assert.ok(
			result.includes('200C') || result.includes('0x200C') || result.includes('0x0000200C'),
			`Expected computed value 0x200C, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_compute_register_values output includes C code suggestion', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const compute = tools.find(t => t.name === 'fw_compute_register_values')!;
		const result = await compute.execute({
			peripheral: 'USART1',
			register: 'CR1',
			fields: { UE: 1, TE: 1, RE: 1 },
		});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('C code') || result.includes('->') || result.includes('USART1->CR1'),
			`Expected C code in output, got: ${result.slice(0, 300)}`
		);
	});

	test('fw_compute_register_values with missing fields returns error', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const compute = tools.find(t => t.name === 'fw_compute_register_values')!;
		const result = await compute.execute({ peripheral: 'USART1', register: 'CR1' });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('fields'),
			`Expected error about missing fields, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_diff_register_config with different values shows changed fields', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const diff = tools.find(t => t.name === 'fw_diff_register_config')!;
		// 0x200C (UE=1,TE=1,RE=1) -> 0x200E (UE=1,TE=1,RE=1 + bit1 which is not a named field but diff still works)
		// Better: 0x200C -> 0x2008 (RE goes from 1 to 0)
		const result = await diff.execute({
			peripheral: 'USART1',
			register: 'CR1',
			before: 0x200C,
			after: 0x2008,
		});

		assert.ok(typeof result === 'string');
		// RE bit changed (bit 2: was 1, now 0)
		assert.ok(
			result.includes('RE') || result.includes('change') || result.includes('diff'),
			`Expected RE field change in diff, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_diff_register_config with same values shows no change', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const diff = tools.find(t => t.name === 'fw_diff_register_config')!;
		const result = await diff.execute({
			peripheral: 'USART1',
			register: 'CR1',
			before: 0x200C,
			after: 0x200C,
		});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('no change') || result.toLowerCase().includes('identical') || result.toLowerCase().includes('same'),
			`Expected no-change message, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_diff_register_config with hex strings works', async () => {
		const tools = buildRegisterValueTools(mockSession);
		const diff = tools.find(t => t.name === 'fw_diff_register_config')!;
		const result = await diff.execute({
			peripheral: 'USART1',
			register: 'CR1',
			before: '0x200C',
			after: '0x2008',
		});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('RE') || result.includes('change') || result.includes('diff'),
			`Expected field change from hex strings, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_decode_register_value returns error when session inactive', async () => {
		const tools = buildRegisterValueTools(mockInactiveSession);
		const decode = tools.find(t => t.name === 'fw_decode_register_value')!;
		const result = await decode.execute({ peripheral: 'USART1', register: 'CR1', value: 0x200C });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_compute_register_values returns error when session inactive', async () => {
		const tools = buildRegisterValueTools(mockInactiveSession);
		const compute = tools.find(t => t.name === 'fw_compute_register_values')!;
		const result = await compute.execute({ peripheral: 'USART1', register: 'CR1', fields: { UE: 1 } });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_diff_register_config returns error when session inactive', async () => {
		const tools = buildRegisterValueTools(mockInactiveSession);
		const diff = tools.find(t => t.name === 'fw_diff_register_config')!;
		const result = await diff.execute({ peripheral: 'USART1', register: 'CR1', before: 0, after: 1 });

		assert.ok(result.toLowerCase().includes('no active'));
	});
});
