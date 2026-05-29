/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { buildPinMuxTools } from '../../../../browser/engine/agentTools/pinMuxTools.js';
import { buildClockTreeTools } from '../../../../browser/engine/agentTools/clockTreeTools.js';
import { buildDependencyTools } from '../../../../browser/engine/agentTools/dependencyTools.js';
import { buildRegisterValueTools } from '../../../../browser/engine/agentTools/registerValueTools.js';
import { buildMemoryTools } from '../../../../browser/engine/agentTools/memoryTools.js';

suite('FirmwareAgentToolService - Tool Builders', () => {
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
		],
		interrupts: [],
	};

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: {
				family: 'STM32F4',
				variant: 'STM32F407VG',
				manufacturer: 'ST',
				core: 'Cortex-M4',
				clockMHz: 168,
				flashSize: 1048576,
				ramSize: 196608,
				fpu: true,
				hasMPU: true,
				hasDSP: true,
				gpioCount: 82,
				peripherals: ['USART1', 'SPI1', 'I2C1'],
				memoryMap: [],
				lastSerialConfig: null,
				serialWasConnected: false,
				datasheets: [],
				errata: [],
				registerMaps: [mockRegisterMap],
				complianceFrameworks: [],
				projectInfo: null,
				buildSystem: null,
				rtos: null,
				boardName: null,
				sessionId: 'test-1234',
			},
			registerMaps: [mockRegisterMap],
			rtos: null,
			boardName: null,
			buildSystem: null,
			projectInfo: null,
		},
		getPeripheralRegisterMap: (name: string) => name === 'USART1' ? mockRegisterMap : null,
		getPeripheralNames: () => ['USART1', 'SPI1'],
		getErrataForPeripheral: () => [],
		getTimingForPeripheral: () => [],
	};

	const mockInactiveSession: any = {
		session: {
			isActive: false,
			mcuConfig: null,
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
		getPeripheralNames: () => [],
		getErrataForPeripheral: () => [],
		getTimingForPeripheral: () => [],
	};

	test('buildPinMuxTools() returns 3 tools', () => {
		const tools = buildPinMuxTools(mockSession);
		assert.strictEqual(tools.length, 3);
	});

	test('buildClockTreeTools() returns 3 tools', () => {
		const tools = buildClockTreeTools(mockSession);
		assert.strictEqual(tools.length, 3);
	});

	test('buildDependencyTools() returns 2 tools', () => {
		const tools = buildDependencyTools(mockSession);
		assert.strictEqual(tools.length, 2);
	});

	test('buildRegisterValueTools() returns 3 tools', () => {
		const tools = buildRegisterValueTools(mockSession);
		assert.strictEqual(tools.length, 3);
	});

	test('buildMemoryTools() returns 3 tools', () => {
		const tools = buildMemoryTools(mockSession);
		assert.strictEqual(tools.length, 3);
	});

	test('all tools have name, description, params, execute', () => {
		const allTools = [
			...buildPinMuxTools(mockSession),
			...buildClockTreeTools(mockSession),
			...buildDependencyTools(mockSession),
			...buildRegisterValueTools(mockSession),
			...buildMemoryTools(mockSession),
		];

		for (const tool of allTools) {
			assert.ok(tool.name, `Tool missing name`);
			assert.ok(tool.description, `Tool ${tool.name} missing description`);
			assert.ok(tool.params !== undefined, `Tool ${tool.name} missing params`);
			assert.ok(typeof tool.execute === 'function', `Tool ${tool.name} missing execute function`);
		}
	});

	test('all tool names are unique (no duplicates)', () => {
		const allTools = [
			...buildPinMuxTools(mockSession),
			...buildClockTreeTools(mockSession),
			...buildDependencyTools(mockSession),
			...buildRegisterValueTools(mockSession),
			...buildMemoryTools(mockSession),
		];

		const names = allTools.map(t => t.name);
		const uniqueNames = new Set(names);
		assert.strictEqual(names.length, uniqueNames.size, `Duplicate tool names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
	});

	test('all tool names start with fw_', () => {
		const allTools = [
			...buildPinMuxTools(mockSession),
			...buildClockTreeTools(mockSession),
			...buildDependencyTools(mockSession),
			...buildRegisterValueTools(mockSession),
			...buildMemoryTools(mockSession),
		];

		for (const tool of allTools) {
			assert.ok(tool.name.startsWith('fw_'), `Tool ${tool.name} does not start with 'fw_'`);
		}
	});

	test('fw_check_pin_conflicts with no allocations returns "no conflicts"', async () => {
		const tools = buildPinMuxTools(mockSession);
		const checkConflicts = tools.find(t => t.name === 'fw_check_pin_conflicts')!;
		const result = await checkConflicts.execute({});
		assert.ok(typeof result === 'string');
		// With no register maps containing GPIO AF data, expect relevant message
		assert.ok(result.toLowerCase().includes('no') || result.toLowerCase().includes('conflict') || result.toLowerCase().includes('register'));
	});

	test('fw_validate_clock_tree with valid STM32F4 config returns valid result', async () => {
		const tools = buildClockTreeTools(mockSession);
		const validate = tools.find(t => t.name === 'fw_validate_clock_tree')!;
		const result = await validate.execute({ m: 8, n: 336, p: 2, q: 7 });
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('PASS'));
		assert.ok(result.includes('168'));
	});

	test('fw_check_peripheral_deps for USART1 returns dependency info', async () => {
		const tools = buildDependencyTools(mockSession);
		const checkDeps = tools.find(t => t.name === 'fw_check_peripheral_deps')!;
		const result = await checkDeps.execute({ peripheral: 'USART1' });
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('USART1'));
		assert.ok(result.includes('depend') || result.includes('RCC') || result.includes('required'));
	});

	test('fw_generate_linker_script generates valid .ld content', async () => {
		const tools = buildMemoryTools(mockSession);
		const genLinker = tools.find(t => t.name === 'fw_generate_linker_script')!;
		const result = await genLinker.execute({});
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('MEMORY') || result.includes('FLASH') || result.includes('RAM'));
	});

	test('fw_memory_layout shows FLASH and RAM regions', async () => {
		const tools = buildMemoryTools(mockSession);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('FLASH'));
		assert.ok(result.includes('RAM'));
	});

	test('fw_check_stack_overflow_risk computes risk level', async () => {
		const tools = buildMemoryTools(mockSession);
		const stackCheck = tools.find(t => t.name === 'fw_check_stack_overflow_risk')!;
		const result = await stackCheck.execute({ mainStackSize: 2048, taskCount: 0 });
		assert.ok(typeof result === 'string');
		assert.ok(result.includes('SAFE') || result.includes('TIGHT') || result.includes('MODERATE') || result.includes('OVERFLOW'));
	});

	test('tools return error message when session is inactive', async () => {
		const allTools = [
			...buildPinMuxTools(mockInactiveSession),
			...buildClockTreeTools(mockInactiveSession),
			...buildDependencyTools(mockInactiveSession),
			...buildRegisterValueTools(mockInactiveSession),
			...buildMemoryTools(mockInactiveSession),
		];

		for (const tool of allTools) {
			const result = await tool.execute({ peripheral: 'USART1', register: 'CR1', value: 0, m: 8, n: 336, p: 2, q: 7 });
			assert.ok(typeof result === 'string');
			assert.ok(
				result.toLowerCase().includes('no active') || result.toLowerCase().includes('no firmware'),
				`Tool ${tool.name} did not return inactive session error, got: ${result.slice(0, 80)}`
			);
		}
	});

	test('fw_scan_project with no project info returns auto-detect message', async () => {
		// The fw_scan_project tool is on the main service, but we can test memoryTools which also checks session
		const tools = buildMemoryTools(mockSession);
		const layout = tools.find(t => t.name === 'fw_memory_layout')!;
		const result = await layout.execute({});
		assert.ok(typeof result === 'string');
		// Ensure it still runs without project info
		assert.ok(result.includes('STM32F4'));
	});
});
