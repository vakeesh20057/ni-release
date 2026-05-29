/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { LinkerScriptGenerator } from '../../../../browser/engine/memory/linkerScriptGenerator.js';

suite('LinkerScriptGenerator', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let generator: LinkerScriptGenerator;

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				flashSize: 1024 * 1024,
				ramSize: 192 * 1024,
				memoryMap: [],
			},
			rtos: 'freertos',
		},
	};

	setup(() => {
		generator = new LinkerScriptGenerator(mockSession);
	});

	test('generate() contains ENTRY(Reset_Handler)', () => {
		const script = generator.generate();
		assert.ok(script.includes('ENTRY(Reset_Handler)'));
	});

	test('generate() contains MEMORY block with FLASH and RAM regions', () => {
		const script = generator.generate();
		assert.ok(script.includes('MEMORY'));
		assert.ok(script.includes('FLASH (rx)'));
		assert.ok(script.includes('RAM (xrw)'));
	});

	test('generate() FLASH at 0x08000000', () => {
		const script = generator.generate();
		assert.ok(script.includes('ORIGIN = 0x08000000'), 'FLASH origin should be 0x08000000');
	});

	test('generate() RAM at 0x20000000', () => {
		const script = generator.generate();
		assert.ok(script.includes('ORIGIN = 0x20000000'), 'RAM origin should be 0x20000000');
	});

	test('generate() contains .isr_vector section with KEEP', () => {
		const script = generator.generate();
		assert.ok(script.includes('.isr_vector'));
		assert.ok(script.includes('KEEP(*(.isr_vector))'));
	});

	test('generate() contains .text, .rodata, .data, .bss sections', () => {
		const script = generator.generate();
		assert.ok(script.includes('.text :'));
		assert.ok(script.includes('.rodata :'));
		assert.ok(script.includes('.data :'));
		assert.ok(script.includes('.bss :'));
	});

	test('generate() .data has AT> FLASH (loaded from flash)', () => {
		const script = generator.generate();
		assert.ok(script.includes('>RAM AT> FLASH'), '.data section should be loaded from FLASH');
	});

	test('generate() contains _estack = ORIGIN(RAM) + LENGTH(RAM)', () => {
		const script = generator.generate();
		assert.ok(script.includes('_estack = ORIGIN(RAM) + LENGTH(RAM)'));
	});

	test('generate() for STM32F4 with large RAM includes CCMRAM region', () => {
		// The mock has 192KB RAM which is > 128KB threshold
		const script = generator.generate();
		assert.ok(script.includes('CCMRAM'), 'Should include CCMRAM for F4 with >128KB RAM');
	});

	test('generate() for STM32F4 CCMRAM includes NOT DMA-accessible warning', () => {
		const script = generator.generate();
		assert.ok(
			script.includes('NOT DMA-accessible') || script.includes('NOT DMA'),
			'Should warn that CCMRAM is not DMA-accessible'
		);
	});

	test('generate() with rtos freertos produces larger heap (0x4000)', () => {
		const script = generator.generate();
		assert.ok(script.includes('_Min_Heap_Size = 0x4000'), 'FreeRTOS heap should be 0x4000');
	});

	test('generate() with rtos none produces smaller heap (0x200)', () => {
		const noRtosSession: any = {
			session: {
				isActive: true,
				mcuConfig: {
					family: 'STM32F4',
					variant: 'STM32F407VG',
					flashSize: 512 * 1024,
					ramSize: 64 * 1024, // Below 128KB threshold to avoid CCMRAM
					memoryMap: [],
				},
				rtos: 'none',
			},
		};
		const gen = new LinkerScriptGenerator(noRtosSession);
		const script = gen.generate();
		assert.ok(script.includes('_Min_Heap_Size = 0x200'), 'Bare-metal heap should be 0x200');
	});

	test('generate({ stackSize: 4096 }) produces _Min_Stack_Size = 0x1000', () => {
		const script = generator.generate({ stackSize: 4096 });
		assert.ok(script.includes('_Min_Stack_Size = 0x1000'), 'Stack size should be 0x1000 (4096)');
	});

	test('generate() with inactive session returns error comment', () => {
		const inactiveSession: any = {
			session: {
				isActive: false,
				mcuConfig: null,
			},
		};
		const gen = new LinkerScriptGenerator(inactiveSession);
		const script = gen.generate();
		assert.ok(script.includes('No active firmware session'));
	});

	test('generate() for STM32F7 includes DTCM region', () => {
		const f7Session: any = {
			session: {
				isActive: true,
				mcuConfig: {
					family: 'STM32F7',
					variant: 'STM32F746ZG',
					flashSize: 1024 * 1024,
					ramSize: 320 * 1024,
					memoryMap: [],
				},
				rtos: 'none',
			},
		};
		const gen = new LinkerScriptGenerator(f7Session);
		const script = gen.generate();
		assert.ok(script.includes('DTCM'), 'STM32F7 should include DTCM region');
	});
});
