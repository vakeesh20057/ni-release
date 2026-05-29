/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildMemoryTools } from '../../../../browser/engine/agentTools/memoryTools.js';

suite('Memory Agent Tools', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				clockMHz: 168,
				flashSize: 1048576,       // 1MB flash
				ramSize: 196608,          // 192KB RAM (>128K triggers CCMRAM)
				fpu: true,
				hasMPU: true,
				memoryMap: [],
			},
			registerMaps: [],
			rtos: 'freertos',
		},
		getPeripheralRegisterMap: () => null,
	};

	const mockSessionSmallRAM: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F401RE',
				clockMHz: 84,
				flashSize: 524288,        // 512KB flash
				ramSize: 98304,           // 96KB RAM
				fpu: true,
				hasMPU: false,
				memoryMap: [],
			},
			registerMaps: [],
			rtos: 'freertos',
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

	test('fw_generate_linker_script output contains MEMORY block', async () => {
		const tools = buildMemoryTools(mockSession);
		const genLinker = tools.find(t => t.name === 'fw_generate_linker_script')!;
		const result = await genLinker.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('MEMORY'), 'Linker script must contain MEMORY block');
	});

	test('fw_generate_linker_script output contains FLASH and RAM', async () => {
		const tools = buildMemoryTools(mockSession);
		const genLinker = tools.find(t => t.name === 'fw_generate_linker_script')!;
		const result = await genLinker.execute({});

		assert.ok(result.includes('FLASH'), 'Linker script must mention FLASH');
		assert.ok(result.includes('RAM'), 'Linker script must mention RAM');
	});

	test('fw_generate_linker_script with custom stack size reflected in output', async () => {
		const tools = buildMemoryTools(mockSession);
		const genLinker = tools.find(t => t.name === 'fw_generate_linker_script')!;
		const result = await genLinker.execute({ stackSize: 4096 });

		assert.ok(typeof result === 'string');
		// Should contain the custom stack size (4096 = 0x1000)
		assert.ok(
			result.includes('4096') || result.includes('0x1000') || result.includes('_Min_Stack_Size'),
			`Expected custom stack size in output, got: ${result.slice(0, 300)}`
		);
	});

	test('fw_memory_layout shows FLASH and RAM regions with sizes', async () => {
		const tools = buildMemoryTools(mockSession);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});

		assert.ok(typeof result === 'string');
		assert.ok(result.includes('FLASH'));
		assert.ok(result.includes('RAM'));
		assert.ok(result.includes('0x08000000'), 'Should show FLASH origin');
		assert.ok(result.includes('0x20000000'), 'Should show RAM origin');
		// 1MB = 1024K
		assert.ok(result.includes('1024'), 'Should show 1024K flash size');
		// 192KB
		assert.ok(result.includes('192'), 'Should show 192K RAM size');
	});

	test('fw_memory_layout for F4 with >128K RAM shows CCMRAM warning', async () => {
		const tools = buildMemoryTools(mockSession);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});

		assert.ok(result.includes('CCMRAM') || result.includes('CCM'), 'F4 with >128K RAM should mention CCMRAM');
		assert.ok(
			result.toLowerCase().includes('warning') || result.toLowerCase().includes('not') && result.toLowerCase().includes('dma'),
			'Should warn about DMA inaccessibility of CCMRAM'
		);
	});

	test('fw_memory_layout for F4 with <=128K RAM does not show CCMRAM', async () => {
		const tools = buildMemoryTools(mockSessionSmallRAM);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});

		assert.ok(!result.includes('CCMRAM'), 'F4 with <=128K RAM should NOT show CCMRAM section');
	});

	test('fw_check_stack_overflow_risk with small RAM and many tasks returns OVERFLOW LIKELY', async () => {
		const tools = buildMemoryTools(mockSessionSmallRAM);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		// 96KB RAM, 20 tasks x 4096 bytes = 81920 bytes task stacks alone
		const result = await stackCheck.execute({ mainStackSize: 4096, taskCount: 20, taskStackSize: 4096 });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('OVERFLOW LIKELY') || result.includes('TIGHT'),
			`Expected overflow risk, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_check_stack_overflow_risk with plenty of RAM returns SAFE', async () => {
		const tools = buildMemoryTools(mockSession);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		// 192KB RAM, bare-metal with small stack
		const result = await stackCheck.execute({ mainStackSize: 2048, taskCount: 0 });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('SAFE') || result.includes('MODERATE'),
			`Expected safe risk level, got: ${result.slice(0, 200)}`
		);
	});

	test('fw_check_stack_overflow_risk with freertos includes FreeRTOS tips', async () => {
		const tools = buildMemoryTools(mockSession);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		const result = await stackCheck.execute({ mainStackSize: 2048, taskCount: 5, taskStackSize: 512 });

		assert.ok(typeof result === 'string');
		assert.ok(
			result.includes('FreeRTOS') || result.includes('freertos'),
			`Expected FreeRTOS tips, got: ${result.slice(0, 300)}`
		);
		assert.ok(
			result.includes('configCHECK_FOR_STACK_OVERFLOW') || result.includes('uxTaskGetStackHighWaterMark'),
			`Expected FreeRTOS-specific advice`
		);
	});

	test('fw_check_stack_overflow_risk shows RAM budget breakdown', async () => {
		const tools = buildMemoryTools(mockSession);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		const result = await stackCheck.execute({ mainStackSize: 2048, taskCount: 3, taskStackSize: 512 });

		assert.ok(result.includes('Main stack'));
		assert.ok(result.includes('Task stack') || result.includes('task'));
		assert.ok(result.includes('Heap') || result.includes('heap'));
		assert.ok(result.includes('Remaining') || result.includes('remaining'));
	});

	test('fw_generate_linker_script returns error when session inactive', async () => {
		const tools = buildMemoryTools(mockInactiveSession);
		const genLinker = tools.find(t => t.name === 'fw_generate_linker_script')!;
		const result = await genLinker.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_memory_layout returns error when session inactive', async () => {
		const tools = buildMemoryTools(mockInactiveSession);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});

	test('fw_check_stack_overflow_risk returns error when session inactive', async () => {
		const tools = buildMemoryTools(mockInactiveSession);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		const result = await stackCheck.execute({});

		assert.ok(result.toLowerCase().includes('no active'));
	});
});
