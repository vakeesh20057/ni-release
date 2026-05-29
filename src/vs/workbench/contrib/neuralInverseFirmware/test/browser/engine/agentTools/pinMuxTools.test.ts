/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildPinMuxTools } from '../../../../browser/engine/agentTools/pinMuxTools.js';

suite('Pin Mux Agent Tools', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				gpioCount: 82,
				peripherals: ['USART1', 'SPI1', 'I2C1'],
			},
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
		getPeripheralNames: () => ['USART1', 'SPI1'],
	};

	const mockSessionWithRegMaps: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				gpioCount: 82,
				peripherals: ['USART1', 'SPI1', 'I2C1'],
			},
			registerMaps: [
				{
					name: 'GPIOA',
					groupName: 'GPIO',
					baseAddress: 0x40020000,
					description: 'General-purpose I/Os',
					registers: [],
					interrupts: [],
				},
			],
		},
		getPeripheralRegisterMap: (name: string) => {
			if (name === 'GPIOA') {
				return {
					name: 'GPIOA',
					groupName: 'GPIO',
					baseAddress: 0x40020000,
					description: 'General-purpose I/Os',
					registers: [],
					interrupts: [],
				};
			}
			return null;
		},
		getPeripheralNames: () => ['USART1', 'SPI1', 'GPIOA'],
	};

	const mockInactiveSession: any = {
		session: {
			isActive: false,
			mcuConfig: null,
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
		getPeripheralNames: () => [],
	};

	test('fw_check_pin_conflicts with no register maps returns register map message', async () => {
		const tools = buildPinMuxTools(mockSession);
		const checkConflicts = tools.find(t => t.name === 'fw_check_pin_conflicts')!;
		const result = await checkConflicts.execute({});

		assert.ok(typeof result === 'string');
		// No register maps loaded
		assert.ok(
			result.toLowerCase().includes('no register') || result.toLowerCase().includes('svd') || result.toLowerCase().includes('load'),
			`Expected register map message, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_check_pin_conflicts with empty allocations returns no conflicts', async () => {
		const tools = buildPinMuxTools(mockSessionWithRegMaps);
		const checkConflicts = tools.find(t => t.name === 'fw_check_pin_conflicts')!;
		const result = await checkConflicts.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('no') && (result.toLowerCase().includes('conflict') || result.toLowerCase().includes('pin')),
			`Expected no conflicts message, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_suggest_pin_assignment without peripheral returns error', async () => {
		const tools = buildPinMuxTools(mockSessionWithRegMaps);
		const suggest = tools.find(t => t.name === 'fw_suggest_pin_assignment')!;
		const result = await suggest.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('peripheral'),
			`Expected peripheral prompt, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_suggest_pin_assignment for peripheral returns suggestions or AF message', async () => {
		const tools = buildPinMuxTools(mockSessionWithRegMaps);
		const suggest = tools.find(t => t.name === 'fw_suggest_pin_assignment')!;
		const result = await suggest.execute({ peripheral: 'USART1' });

		assert.ok(typeof result === 'string');
		// Either returns pin suggestions or says no AF data found
		assert.ok(
			result.includes('USART1') || result.toLowerCase().includes('no af'),
			`Expected USART1 mention or no AF data message, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_get_available_pins returns pin status or no data message', async () => {
		const tools = buildPinMuxTools(mockSessionWithRegMaps);
		const getPins = tools.find(t => t.name === 'fw_get_available_pins')!;
		const result = await getPins.execute({});

		assert.ok(typeof result === 'string');
		// Either shows GPIO pin status or says no GPIO AF data found
		assert.ok(
			result.toLowerCase().includes('gpio') || result.toLowerCase().includes('pin') || result.toLowerCase().includes('no'),
			`Expected pin info, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_get_available_pins with port filter', async () => {
		const tools = buildPinMuxTools(mockSessionWithRegMaps);
		const getPins = tools.find(t => t.name === 'fw_get_available_pins')!;
		const result = await getPins.execute({ port: 'A' });

		assert.ok(typeof result === 'string');
		// Should mention port A or say no data for it
		assert.ok(
			result.toUpperCase().includes('A') || result.toLowerCase().includes('no'),
			`Expected port A reference, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_check_pin_conflicts returns error when session inactive', async () => {
		const tools = buildPinMuxTools(mockInactiveSession);
		const checkConflicts = tools.find(t => t.name === 'fw_check_pin_conflicts')!;
		const result = await checkConflicts.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_suggest_pin_assignment returns error when session inactive', async () => {
		const tools = buildPinMuxTools(mockInactiveSession);
		const suggest = tools.find(t => t.name === 'fw_suggest_pin_assignment')!;
		const result = await suggest.execute({ peripheral: 'USART1' });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_get_available_pins returns error when session inactive', async () => {
		const tools = buildPinMuxTools(mockInactiveSession);
		const getPins = tools.find(t => t.name === 'fw_get_available_pins')!;
		const result = await getPins.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});
});
