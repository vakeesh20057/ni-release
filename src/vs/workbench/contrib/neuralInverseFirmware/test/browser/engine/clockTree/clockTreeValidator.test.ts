/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ClockTreeValidatorService } from '../../../../browser/engine/clockTree/clockTreeValidatorService.js';

suite('ClockTreeValidatorService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let validator: ClockTreeValidatorService;

	setup(() => {
		validator = new ClockTreeValidatorService();
	});

	test('valid F4 config: M=8,N=336,P=2,Q=7 with 8MHz HSE is valid with sysclk=168', () => {
		const result = validator.validate({ m: 8, n: 336, p: 2, q: 7 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.computedValues.sysclkMHz, 168);
	});

	test('invalid M (M=1 on F4 where min is 2) produces PLLM error', () => {
		const result = validator.validate({ m: 1, n: 336, p: 2, q: 7 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.valid, false);
		const pllmError = result.errors.find(e => e.field === 'PLLM');
		assert.ok(pllmError, 'Should have a PLLM error');
	});

	test('VCO out of range produces VCO error', () => {
		// M=8, HSE=8 → pllInput=1. N=50 → VCO=50 (below F4 min 100)
		const result = validator.validate({ m: 8, n: 50, p: 2, q: 2 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.valid, false);
		const vcoError = result.errors.find(e => e.field === 'VCO');
		assert.ok(vcoError, 'Should have a VCO range error');
	});

	test('SYSCLK exceeds max produces SYSCLK error', () => {
		// M=4, HSE=8 → pllInput=2. N=432 → VCO=864 → out of VCO range, but test SYSCLK logic with valid VCO
		// M=8, HSE=8 → pllInput=1. N=432 → VCO=432. P=2 → SYSCLK=216 (exceeds F4 max 168)
		const result = validator.validate({ m: 8, n: 432, p: 2, q: 9 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.valid, false);
		const sysclkError = result.errors.find(e => e.field === 'SYSCLK');
		assert.ok(sysclkError, 'Should have a SYSCLK exceeds max error');
	});

	test('flash wait states: F4 at 168MHz HCLK requires 5 wait states', () => {
		const result = validator.validate({ m: 8, n: 336, p: 2, q: 7 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.computedValues.flashWaitStates, 5);
	});

	test('flash wait states: F4 at 30MHz HCLK requires 0 wait states', () => {
		// M=8, HSE=8 → pllInput=1. N=240 → VCO=240. P=8 → SYSCLK=30. HCLK=30/1=30.
		const result = validator.validate({ m: 8, n: 240, p: 8, q: 5 }, 8, 1, 1, 1, 'STM32F4');

		assert.strictEqual(result.computedValues.hclkMHz, 30);
		assert.strictEqual(result.computedValues.flashWaitStates, 0);
	});

	test('APB1 over limit produces APB1 error', () => {
		// Valid config but with APB1 prescaler = 1, so APB1 = HCLK = 168MHz > 42MHz max
		const result = validator.validate({ m: 8, n: 336, p: 2, q: 7 }, 8, 1, 1, 1, 'STM32F4');

		assert.strictEqual(result.valid, false);
		const apb1Error = result.errors.find(e => e.field === 'APB1');
		assert.ok(apb1Error, 'Should have an APB1 over limit error');
		assert.ok(apb1Error!.actual > 42);
	});

	test('USB 48MHz not met produces peripheral error', () => {
		// M=8, HSE=8 → pllInput=1. N=336 → VCO=336. Q=2 → PLL48=168MHz (not 48!)
		const result = validator.validate({ m: 8, n: 336, p: 2, q: 2 }, 8, 1, 4, 2, 'STM32F4');

		assert.strictEqual(result.valid, false);
		const usbError = result.errors.find(e => e.field === 'USB_OTG_FS');
		assert.ok(usbError, 'Should have a USB_OTG_FS peripheral clock error');
	});

	test('getConstraints(STM32F4) returns F4 constraints with sysclkMax=168', () => {
		const constraints = validator.getConstraints('STM32F4');

		assert.strictEqual(constraints.family, 'STM32F4');
		assert.strictEqual(constraints.sysclkMax, 168);
		assert.deepStrictEqual(constraints.mRange, [2, 63]);
		assert.deepStrictEqual(constraints.pValues, [2, 4, 6, 8]);
	});

	test('getConstraints(STM32H7) returns H7 constraints with sysclkMax=480', () => {
		const constraints = validator.getConstraints('STM32H7');

		assert.strictEqual(constraints.family, 'STM32H7');
		assert.strictEqual(constraints.sysclkMax, 480);
		assert.deepStrictEqual(constraints.pllInputRange, [1, 16]);
	});
});
