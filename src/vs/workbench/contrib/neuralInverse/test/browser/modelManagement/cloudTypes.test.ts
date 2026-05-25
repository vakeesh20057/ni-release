/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	getRecommendedInstances,
	AWS_GPU_INSTANCES,
	AZURE_GPU_INSTANCES,
} from '../../../common/modelManagement/cloudTypes.js';

suite('CloudTypes — getRecommendedInstances', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns all AWS instances for a tiny model (1GB)', () => {
		const result = getRecommendedInstances('aws', 1 * 1024 * 1024 * 1024);
		assert.strictEqual(result.length, AWS_GPU_INSTANCES.length);
	});

	test('filters out small instances for 70B model (~70GB)', () => {
		const modelSize = 70 * 1024 * 1024 * 1024;
		const result = getRecommendedInstances('aws', modelSize);
		for (const instance of result) {
			assert.ok(instance.gpuMemoryGB >= 70 * 1.2, `Instance ${instance.instanceType} has ${instance.gpuMemoryGB}GB but needs ${70 * 1.2}GB`);
		}
	});

	test('returns empty array when no instance fits a massive model', () => {
		const modelSize = 2000 * 1024 * 1024 * 1024; // 2TB model
		const result = getRecommendedInstances('aws', modelSize);
		assert.strictEqual(result.length, 0);
	});

	test('Azure instances are returned for azure provider', () => {
		const modelSize = 5 * 1024 * 1024 * 1024;
		const result = getRecommendedInstances('azure', modelSize);
		assert.ok(result.length > 0);
		for (const instance of result) {
			assert.strictEqual(instance.provider, 'azure');
		}
	});

	test('AWS instances all have provider = aws', () => {
		for (const instance of AWS_GPU_INSTANCES) {
			assert.strictEqual(instance.provider, 'aws');
		}
	});

	test('Azure instances all have provider = azure', () => {
		for (const instance of AZURE_GPU_INSTANCES) {
			assert.strictEqual(instance.provider, 'azure');
		}
	});

	test('instances are sorted by cost ascending', () => {
		for (let i = 1; i < AWS_GPU_INSTANCES.length; i++) {
			assert.ok(
				AWS_GPU_INSTANCES[i].estimatedCostPerHour >= AWS_GPU_INSTANCES[i - 1].estimatedCostPerHour,
				`AWS instances not sorted by cost: ${AWS_GPU_INSTANCES[i - 1].instanceType} > ${AWS_GPU_INSTANCES[i].instanceType}`
			);
		}
		for (let i = 1; i < AZURE_GPU_INSTANCES.length; i++) {
			assert.ok(
				AZURE_GPU_INSTANCES[i].estimatedCostPerHour >= AZURE_GPU_INSTANCES[i - 1].estimatedCostPerHour,
				`Azure instances not sorted by cost`
			);
		}
	});

	test('all instances have positive GPU memory and cost', () => {
		for (const instance of [...AWS_GPU_INSTANCES, ...AZURE_GPU_INSTANCES]) {
			assert.ok(instance.gpuMemoryGB > 0, `${instance.instanceType} has no GPU memory`);
			assert.ok(instance.estimatedCostPerHour > 0, `${instance.instanceType} has no cost`);
			assert.ok(instance.region.length > 0, `${instance.instanceType} has no region`);
			assert.ok(instance.gpuType.length > 0, `${instance.instanceType} has no GPU type`);
		}
	});

	test('applies 1.2x overhead factor correctly', () => {
		// A model that is exactly 20GB should require 24GB GPU memory (20 * 1.2)
		const modelSize = 20 * 1024 * 1024 * 1024;
		const result = getRecommendedInstances('aws', modelSize);
		for (const instance of result) {
			assert.ok(instance.gpuMemoryGB >= 24, `Instance ${instance.instanceType} (${instance.gpuMemoryGB}GB) doesn't meet 24GB requirement`);
		}
	});

	test('zero-size model returns all instances', () => {
		const result = getRecommendedInstances('aws', 0);
		assert.strictEqual(result.length, AWS_GPU_INSTANCES.length);
	});
});
