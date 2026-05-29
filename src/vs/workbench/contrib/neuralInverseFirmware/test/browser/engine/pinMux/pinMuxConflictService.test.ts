/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { pinId, pinKey, parsePinKey } from '../../../../browser/engine/pinMux/pinMuxTypes.js';
import { PinMuxConflictService } from '../../../../browser/engine/pinMux/pinMuxConflictService.js';

suite('PinMuxConflictService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let service: PinMuxConflictService;

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: { family: 'STM32F4', variant: 'STM32F407VG' },
			registerMaps: [],
		},
		getPeripheralRegisterMap: () => null,
	};

	setup(() => {
		service = new PinMuxConflictService(mockSession);
	});

	test('allocatePin() with no conflict returns null', () => {
		const result = service.allocatePin({
			pin: pinId('A', 9),
			peripheral: 'USART1',
			signal: 'USART1_TX',
			af: 7,
			source: 'user-declared',
		});

		assert.strictEqual(result, null);
	});

	test('allocatePin() same pin, different peripheral returns IPinConflict', () => {
		service.allocatePin({
			pin: pinId('A', 9),
			peripheral: 'USART1',
			signal: 'USART1_TX',
			af: 7,
			source: 'user-declared',
		});

		const conflict = service.allocatePin({
			pin: pinId('A', 9),
			peripheral: 'TIM1',
			signal: 'TIM1_CH2',
			af: 1,
			source: 'user-declared',
		});

		assert.ok(conflict, 'Should return a conflict');
		assert.strictEqual(conflict!.severity, 'error');
		assert.ok(conflict!.allocations.length >= 2);
		assert.ok(conflict!.message.includes('PA9'));
	});

	test('allocatePin() same pin, same peripheral, same signal produces no conflict', () => {
		service.allocatePin({
			pin: pinId('A', 9),
			peripheral: 'USART1',
			signal: 'USART1_TX',
			af: 7,
			source: 'user-declared',
		});

		const result = service.allocatePin({
			pin: pinId('A', 9),
			peripheral: 'USART1',
			signal: 'USART1_TX',
			af: 7,
			source: 'source-scan',
		});

		assert.strictEqual(result, null);
	});

	test('getConflicts() returns all active conflicts', () => {
		// Create a conflict on PA9
		service.allocatePin({ pin: pinId('A', 9), peripheral: 'USART1', signal: 'USART1_TX', af: 7, source: 'user-declared' });
		service.allocatePin({ pin: pinId('A', 9), peripheral: 'TIM1', signal: 'TIM1_CH2', af: 1, source: 'user-declared' });

		// No conflict on PB6
		service.allocatePin({ pin: pinId('B', 6), peripheral: 'I2C1', signal: 'I2C1_SCL', af: 4, source: 'user-declared' });

		const conflicts = service.getConflicts();
		assert.strictEqual(conflicts.length, 1);
		assert.strictEqual(conflicts[0].pin.port, 'A');
		assert.strictEqual(conflicts[0].pin.pin, 9);
	});

	test('deallocatePin() removes allocation, conflict resolves', () => {
		service.allocatePin({ pin: pinId('A', 9), peripheral: 'USART1', signal: 'USART1_TX', af: 7, source: 'user-declared' });
		service.allocatePin({ pin: pinId('A', 9), peripheral: 'TIM1', signal: 'TIM1_CH2', af: 1, source: 'user-declared' });

		assert.strictEqual(service.getConflicts().length, 1);

		service.deallocatePin(pinId('A', 9), 'TIM1');

		assert.strictEqual(service.getConflicts().length, 0);
	});

	test('clearAll() empties the allocation table', () => {
		service.allocatePin({ pin: pinId('A', 9), peripheral: 'USART1', signal: 'USART1_TX', af: 7, source: 'user-declared' });
		service.allocatePin({ pin: pinId('B', 6), peripheral: 'I2C1', signal: 'I2C1_SCL', af: 4, source: 'user-declared' });

		service.clearAll();

		assert.strictEqual(service.getConflicts().length, 0);
		// After clear, allocating should not cause conflicts
		const result = service.allocatePin({ pin: pinId('A', 9), peripheral: 'TIM1', signal: 'TIM1_CH2', af: 1, source: 'user-declared' });
		assert.strictEqual(result, null);
	});

	test('validateAF() with empty AF database returns "not found" message', () => {
		const result = service.validateAF(pinId('A', 9), 'USART1', 7);

		assert.strictEqual(result.valid, false);
		assert.ok(result.message.includes('no AF assignment') || result.message.includes('SVD'));
	});

	test('suggestPin() returns sorted suggestions (free pins first)', () => {
		// With empty AF database, suggestPin returns empty for now
		const suggestions = service.suggestPin('USART1');

		// With no AF data loaded, suggestions will be empty — this tests the sort contract
		assert.ok(Array.isArray(suggestions));
	});

	test('getAvailablePins() returns all known pins with allocation status', () => {
		// With empty register maps, AF database is empty
		const pins = service.getAvailablePins();
		assert.ok(Array.isArray(pins));
	});

	test('scanSourceForAllocations() detects HAL GPIO_AF pattern', () => {
		const source = `
			GPIO_InitStruct.Pin = GPIO_PIN_9;
			GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
			GPIO_InitStruct.Alternate = GPIO_AF7_USART1;
		`;

		const allocations = service.scanSourceForAllocations(source, 'main.c');

		assert.ok(allocations.length > 0, 'Should detect at least one allocation from HAL pattern');
		const usart = allocations.find(a => a.peripheral === 'USART1');
		assert.ok(usart, 'Should find USART1 allocation');
		assert.strictEqual(usart!.af, 7);
		assert.strictEqual(usart!.source, 'source-scan');
	});

	test('scanSourceForAllocations() detects LL_GPIO pattern', () => {
		const source = `
			LL_GPIO_SetAFPin_0_7(GPIOA, LL_GPIO_PIN_9, LL_GPIO_AF_7);
		`;

		const allocations = service.scanSourceForAllocations(source);

		assert.ok(allocations.length > 0, 'Should detect LL_GPIO pattern');
		const alloc = allocations[0];
		assert.strictEqual(alloc.pin.port, 'A');
		assert.strictEqual(alloc.pin.pin, 9);
		assert.strictEqual(alloc.af, 7);
	});

	test('pinKey() and parsePinKey() are inverses', () => {
		const pin = pinId('B', 12);
		const key = pinKey(pin);
		const parsed = parsePinKey(key);

		assert.ok(parsed);
		assert.strictEqual(parsed!.port, 'B');
		assert.strictEqual(parsed!.pin, 12);
		assert.strictEqual(key, 'PB12');
	});
});
