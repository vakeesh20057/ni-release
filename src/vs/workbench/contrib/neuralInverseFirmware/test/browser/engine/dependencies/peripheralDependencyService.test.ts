/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { PeripheralDependencyService } from '../../../../browser/engine/dependencies/peripheralDependencyService.js';

suite('PeripheralDependencyService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let service: PeripheralDependencyService;

	const mockSession: any = {
		session: {
			isActive: true,
			mcuConfig: { family: 'STM32F4', variant: 'STM32F407VG', clockMHz: 168 },
			registerMaps: [],
		},
	};

	setup(() => {
		service = new PeripheralDependencyService(mockSession);
	});

	test('getDependencyChain(USART1) includes RCC clock enable node', () => {
		const chain = service.getDependencyChain('USART1');

		const rccNode = chain.nodes.find(n => n.kind === 'rcc-clock-enable' && n.bitField === 'USART1EN');
		assert.ok(rccNode, 'Should include RCC clock enable for USART1');
		assert.ok(rccNode!.codeSnippet.includes('USART1EN'));
	});

	test('getDependencyChain(USART1) includes GPIO AF config nodes', () => {
		const chain = service.getDependencyChain('USART1');

		const gpioAfNodes = chain.nodes.filter(n => n.kind === 'gpio-af-config');
		assert.ok(gpioAfNodes.length > 0, 'Should include GPIO AF configuration nodes');

		const moderNode = gpioAfNodes.find(n => n.register?.includes('MODER'));
		assert.ok(moderNode, 'Should include MODER configuration');
	});

	test('getDependencyChain(USART1) includes peripheral enable (UE bit) as last node', () => {
		const chain = service.getDependencyChain('USART1');

		const enableNode = chain.nodes.find(n => n.kind === 'peripheral-enable');
		assert.ok(enableNode, 'Should include peripheral enable node');
		assert.strictEqual(enableNode!.bitField, 'UE');
		assert.strictEqual(enableNode!.order, 99, 'Enable node should have highest order (last)');

		// Verify it is actually the last in the sorted chain
		const lastNode = chain.nodes[chain.nodes.length - 1];
		assert.strictEqual(lastNode.kind, 'peripheral-enable');
	});

	test('getDependencyChain(USART1, { useDMA: true }) includes DMA nodes', () => {
		const chain = service.getDependencyChain('USART1', { useDMA: true });

		const dmaNodes = chain.nodes.filter(n => n.kind === 'rcc-clock-enable' && n.bitField === 'DMAx_EN' || n.kind === 'dma-stream-config');
		assert.ok(dmaNodes.length > 0, 'Should include DMA dependency nodes');
	});

	test('getDependencyChain(USART1, { useInterrupt: true }) includes NVIC enable', () => {
		const chain = service.getDependencyChain('USART1', { useInterrupt: true });

		const nvicNode = chain.nodes.find(n => n.kind === 'nvic-enable');
		assert.ok(nvicNode, 'Should include NVIC enable node');
		assert.ok(nvicNode!.codeSnippet.includes('NVIC_EnableIRQ'));
	});

	test('getDependencyChain(DMA1) does NOT include GPIO nodes', () => {
		const chain = service.getDependencyChain('DMA1');

		const gpioNodes = chain.nodes.filter(n => n.kind === 'gpio-af-config' || n.kind === 'gpio-analog-config');
		assert.strictEqual(gpioNodes.length, 0, 'DMA should not have GPIO dependencies');
	});

	test('getDependencyChain(USB_OTG_FS) includes PLL config requirement', () => {
		const chain = service.getDependencyChain('USB_OTG_FS');

		const pllNode = chain.nodes.find(n => n.kind === 'pll-config');
		assert.ok(pllNode, 'USB should require PLL 48MHz configuration');
		assert.ok(pllNode!.description.includes('48 MHz'));
	});

	test('getDependencyChain(RTC) includes PWR backup domain protection disable', () => {
		const chain = service.getDependencyChain('RTC');

		const pwrNode = chain.nodes.find(n => n.kind === 'power-domain' && n.bitField === 'DBP');
		assert.ok(pwrNode, 'RTC should require backup domain write protection disable');
		assert.ok(pwrNode!.codeSnippet.includes('PWR_CR_DBP'));
	});

	test('getDependencyChain(ADC1) includes analog GPIO mode (not AF mode)', () => {
		const chain = service.getDependencyChain('ADC1');

		const analogNode = chain.nodes.find(n => n.kind === 'gpio-analog-config');
		assert.ok(analogNode, 'ADC should require analog GPIO mode');
		assert.ok(analogNode!.codeSnippet.includes('Analog mode'));
	});

	test('nodes are sorted by order (RCC first, enable last)', () => {
		const chain = service.getDependencyChain('USART1');

		for (let i = 1; i < chain.nodes.length; i++) {
			assert.ok(
				chain.nodes[i].order >= chain.nodes[i - 1].order,
				`Node ${i} order (${chain.nodes[i].order}) should be >= node ${i - 1} order (${chain.nodes[i - 1].order})`
			);
		}

		// First non-optional node should be RCC-related (order 10-11)
		const firstRequired = chain.nodes.find(n => !n.optional);
		assert.ok(firstRequired);
		assert.ok(firstRequired!.order <= 11, 'First required node should be early (RCC enable)');
	});

	test('checkDependencies(USART1, sourceWithRCCEnable) finds RCC satisfied', () => {
		const source = `
			RCC->APB2ENR |= RCC_APB2ENR_USART1EN;
			GPIOA->MODER |= (0x2UL << (9*2));
			GPIOA->AFR[1] |= (7 << ((9-8)*4));
			USART1->CR1 |= USART_CR1_UE;
		`;

		const report = service.checkDependencies('USART1', source);
		const rccResult = report.results.find(r => r.node.bitField === 'USART1EN');
		assert.ok(rccResult);
		assert.strictEqual(rccResult!.status, 'satisfied');
	});

	test('checkDependencies(USART1, empty source) reports missing', () => {
		const report = service.checkDependencies('USART1', '');

		assert.strictEqual(report.allSatisfied, false);
		assert.ok(report.missingCount > 0, 'Should report missing dependencies');
	});

	test('generateInitSequence(USART1) contains C code for all required deps', () => {
		const code = service.generateInitSequence('USART1');

		assert.ok(code.includes('RCC'), 'Should include RCC clock enable code');
		assert.ok(code.includes('MODER') || code.includes('GPIO'), 'Should include GPIO configuration');
		assert.ok(code.includes('USART1') || code.includes('CR1'), 'Should include peripheral enable');
		assert.ok(code.includes('/*'), 'Should include comments');
	});
});
