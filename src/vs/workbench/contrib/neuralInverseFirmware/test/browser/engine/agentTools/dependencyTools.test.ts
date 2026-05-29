/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildDependencyTools } from '../../../../browser/engine/agentTools/dependencyTools.js';

suite('Dependency Agent Tools', () => {
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
			rtos: null,
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

	test('fw_check_peripheral_deps for USART1 lists dependencies', async () => {
		const tools = buildDependencyTools(mockSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({ peripheral: 'USART1' });

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('USART1'));
		// Should mention RCC clock enable or dependencies
		assert.ok(
			result.includes('RCC') || result.includes('clock') || result.includes('depend'),
			`Expected dependency chain for USART1, got: ${result.slice(0, 150)}`
		);
	});

	test('fw_check_peripheral_deps includes GPIO AF config for USART1', async () => {
		const tools = buildDependencyTools(mockSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({ peripheral: 'USART1' });

		assert.ok(
			result.includes('GPIO') || result.includes('AF') || result.includes('MODER'),
			`Expected GPIO AF references, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_check_peripheral_deps with missing peripheral param returns error message', async () => {
		const tools = buildDependencyTools(mockSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('peripheral'),
			`Expected error about missing peripheral, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_check_peripheral_deps for SPI1 includes dependencies', async () => {
		const tools = buildDependencyTools(mockSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({ peripheral: 'SPI1' });

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('SPI1'));
		assert.ok(
			result.includes('RCC') || result.includes('clock') || result.includes('depend'),
			`Expected dependency chain for SPI1, got: ${result.slice(0, 150)}`
		);
	});

	test('fw_generate_init_sequence for USART1 returns C code with RCC enable', async () => {
		const tools = buildDependencyTools(mockSession);
		const genInit = tools.find(t => t.name === 'fw_generate_init_sequence')!;
		const result = await genInit.execute({ peripheral: 'USART1' });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('RCC') || result.includes('USART1EN') || result.includes('APB2ENR'),
			`Expected RCC clock enable in init sequence, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_generate_init_sequence for SPI1 includes SPE enable', async () => {
		const tools = buildDependencyTools(mockSession);
		const genInit = tools.find(t => t.name === 'fw_generate_init_sequence')!;
		const result = await genInit.execute({ peripheral: 'SPI1' });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('SPE') || result.includes('SPI1') || result.includes('CR1'),
			`Expected SPI enable in init sequence, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_generate_init_sequence with missing peripheral returns error', async () => {
		const tools = buildDependencyTools(mockSession);
		const genInit = tools.find(t => t.name === 'fw_generate_init_sequence')!;
		const result = await genInit.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(
			result.toLowerCase().includes('provide') || result.toLowerCase().includes('peripheral'),
			`Expected error about missing peripheral, got: ${result.slice(0, 100)}`
		);
	});

	test('fw_generate_init_sequence with DMA option includes DMA setup', async () => {
		const tools = buildDependencyTools(mockSession);
		const genInit = tools.find(t => t.name === 'fw_generate_init_sequence')!;
		const result = await genInit.execute({ peripheral: 'USART1', useDMA: true });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('DMA') || result.includes('dma'),
			`Expected DMA references in init sequence, got: ${result.slice(0, 300)}`
		);
	});

	test('fw_check_peripheral_deps returns error when session inactive', async () => {
		const tools = buildDependencyTools(mockInactiveSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({ peripheral: 'USART1' });

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_generate_init_sequence returns error when session inactive', async () => {
		const tools = buildDependencyTools(mockInactiveSession);
		const genInit = tools.find(t => t.name === 'fw_generate_init_sequence')!;
		const result = await genInit.execute({ peripheral: 'USART1' });

		assert.ok(result.toLowerCase().includes('no active'));
	});
});
