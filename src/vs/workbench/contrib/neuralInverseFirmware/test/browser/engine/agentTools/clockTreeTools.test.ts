/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildClockTreeTools } from '../../../../browser/engine/agentTools/clockTreeTools.js';

suite('Clock Tree Agent Tools', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				clockMHz: 168,
				flashSize: 1048576,
				ramSize: 196608,
			},
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
	};

	const mockInactiveSession: any = {
		session: {
			isActive: false,
			mcuConfig: null,
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
	};

	test('fw_validate_clock_tree with valid M=8,N=336,P=2,Q=7 returns PASS', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		const result = await validate.execute({ m: 8, n: 336, p: 2, q: 7 });

		assert.ok(result.includes('PASS'));
		assert.ok(result.includes('168'));
		assert.ok(!result.includes('FAIL'));
	});

	test('fw_validate_clock_tree with invalid config returns FAIL with errors', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		// M=1 is invalid for STM32F4 (min PLLM is 2)
		const result = await validate.execute({ m: 1, n: 336, p: 2, q: 7 });

		assert.ok(result.includes('FAIL'));
		assert.ok(result.includes('ERROR') || result.includes('[X]'));
	});

	test('fw_validate_clock_tree with missing params returns helpful error', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		const result = await validate.execute({});

		assert.ok(result.toLowerCase().includes('required') || result.toLowerCase().includes('m, n, p, q'));
	});

	test('fw_validate_clock_tree with VCO out of range returns FAIL', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		// M=8, HSE=8 -> pllInput=1, N=50 -> VCO=50 (below F4 min 100)
		const result = await validate.execute({ m: 8, n: 50, p: 2, q: 2 });

		assert.ok(result.includes('FAIL'));
	});

	test('fw_suggest_clock_config for 168MHz with USB returns solution with PLL values', async () => {
		const tools = buildClockTreeTools(mockSession);
		const suggest = tools.find(t => t.name === 'fw_suggest_clock_config')!;
		const result = await suggest.execute({ targetSysclkMHz: 168, hseMHz: 8, needUSB: true });

		assert.ok(result.includes('168'));
		assert.ok(result.includes('PLLM') || result.includes('pll'));
		assert.ok(result.includes('Solution') || result.includes('configuration'));
	});

	test('fw_suggest_clock_config for impossible freq returns no solutions', async () => {
		const tools = buildClockTreeTools(mockSession);
		const suggest = tools.find(t => t.name === 'fw_suggest_clock_config')!;
		// 999 MHz is above STM32F4 max of 168
		const result = await suggest.execute({ targetSysclkMHz: 999, hseMHz: 8, needUSB: true });

		assert.ok(result.toLowerCase().includes('no valid') || result.toLowerCase().includes('no '));
	});

	test('fw_suggest_clock_config without targetSysclkMHz returns error', async () => {
		const tools = buildClockTreeTools(mockSession);
		const suggest = tools.find(t => t.name === 'fw_suggest_clock_config')!;
		const result = await suggest.execute({});

		assert.ok(result.toLowerCase().includes('provide') || result.toLowerCase().includes('targetsysclkmhz'));
	});

	test('fw_get_clock_constraints returns constraint info for the MCU family', async () => {
		const tools = buildClockTreeTools(mockSession);
		const constraints = tools.find(t => t.name === 'fw_get_clock_constraints')!;
		const result = await constraints.execute({});

		assert.ok(result.includes('STM32F4'));
		assert.ok(result.includes('SYSCLK') || result.includes('sysclk'));
		assert.ok(result.includes('VCO') || result.includes('vco'));
		assert.ok(result.includes('PLLM') || result.includes('pll'));
		assert.ok(result.includes('wait state') || result.includes('Wait State') || result.includes('Flash'));
	});

	test('fw_validate_clock_tree returns error when session inactive', async () => {
		const tools = buildClockTreeTools(mockInactiveSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		const result = await validate.execute({ m: 8, n: 336, p: 2, q: 7 });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_suggest_clock_config returns error when session inactive', async () => {
		const tools = buildClockTreeTools(mockInactiveSession);
		const suggest = tools.find(t => t.name === 'fw_suggest_clock_config')!;
		const result = await suggest.execute({ targetSysclkMHz: 168 });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_get_clock_constraints returns error when session inactive', async () => {
		const tools = buildClockTreeTools(mockInactiveSession);
		const constraints = tools.find(t => t.name === 'fw_get_clock_constraints')!;
		const result = await constraints.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_validate_clock_tree computes correct PLL48CLK for USB', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		// M=8, N=336, P=2, Q=7: VCO=336, PLL48CLK=336/7=48
		const result = await validate.execute({ m: 8, n: 336, p: 2, q: 7 });

		assert.ok(result.includes('48'));
		assert.ok(result.includes('PLL48CLK'));
	});

	test('fw_validate_clock_tree shows flash wait states', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		const result = await validate.execute({ m: 8, n: 336, p: 2, q: 7 });

		assert.ok(result.includes('Flash WS') || result.includes('wait state') || result.includes('FLASH_ACR'));
	});
});
