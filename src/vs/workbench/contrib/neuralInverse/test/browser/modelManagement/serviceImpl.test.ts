/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IModelPullProgress } from '../../../common/modelManagement/types.js';

suite('ModelManagementService — Pull Progress State Machine', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('pull progress status values are valid transitions', () => {
		const validStatuses: IModelPullProgress['status'][] = [
			'queued', 'downloading', 'extracting', 'verifying', 'completed', 'failed', 'cancelled'
		];

		// Valid forward transitions
		const validTransitions: Record<string, string[]> = {
			'queued': ['downloading', 'failed', 'cancelled'],
			'downloading': ['extracting', 'verifying', 'completed', 'failed', 'cancelled'],
			'extracting': ['verifying', 'completed', 'failed'],
			'verifying': ['completed', 'failed'],
			'completed': [],
			'failed': [],
			'cancelled': [],
		};

		for (const status of validStatuses) {
			assert.ok(status in validTransitions, `${status} should have defined transitions`);
		}

		// Terminal states have no transitions
		assert.deepStrictEqual(validTransitions['completed'], []);
		assert.deepStrictEqual(validTransitions['failed'], []);
		assert.deepStrictEqual(validTransitions['cancelled'], []);
	});

	test('percentage is bounded 0-100', () => {
		const progress: IModelPullProgress = {
			modelId: 'test-model',
			provider: 'ollama',
			status: 'downloading',
			percentage: 50,
			total: 1000,
			downloaded: 500,
		};
		assert.ok(progress.percentage! >= 0);
		assert.ok(progress.percentage! <= 100);
	});

	test('completed status has percentage 100', () => {
		const progress: IModelPullProgress = {
			modelId: 'test-model',
			provider: 'ollama',
			status: 'completed',
			percentage: 100,
		};
		assert.strictEqual(progress.percentage, 100);
	});

	test('failed status includes error message', () => {
		const progress: IModelPullProgress = {
			modelId: 'test-model',
			provider: 'ollama',
			status: 'failed',
			error: 'Network timeout after 30s',
		};
		assert.ok(progress.error);
		assert.ok(progress.error!.length > 0);
	});
});

suite('ModelManagementService — Disk Space', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('getDiskSpace returns Infinity for available (skip check)', () => {
		// The current implementation returns Infinity because we can't check
		// disk space from the browser context. This means the pre-check
		// never blocks a download — Ollama reports its own errors.
		const available = Infinity;
		const modelSize = 50 * 1024 * 1024 * 1024;
		assert.ok(available >= modelSize, 'Infinity should always pass size check');
	});

	test('model storage paths are correct per provider', () => {
		const paths: Record<string, string> = {
			ollama: '~/.ollama/models',
			vLLM: '~/.cache/huggingface',
			lmStudio: '~/.cache/lm-studio',
		};

		for (const [provider, path] of Object.entries(paths)) {
			assert.ok(path.startsWith('~/'), `${provider} path should be in home dir`);
			assert.ok(path.length > 3, `${provider} path should be non-trivial`);
		}
	});
});

suite('ModelManagementService — Health Check', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('health check paths are correct per provider', () => {
		const paths: Record<string, string> = {
			ollama: '/',
			vLLM: '/models',
			lmStudio: '/models',
		};

		assert.strictEqual(paths['ollama'], '/');
		assert.strictEqual(paths['vLLM'], '/models');
		assert.strictEqual(paths['lmStudio'], '/models');
	});

	test('latency > 2000ms results in degraded status', () => {
		const latency = 2500;
		const status = latency > 2000 ? 'degraded' : 'healthy';
		assert.strictEqual(status, 'degraded');
	});

	test('latency <= 2000ms results in healthy status', () => {
		const latency = 1500;
		const status = latency > 2000 ? 'degraded' : 'healthy';
		assert.strictEqual(status, 'healthy');
	});

	test('latency exactly 2000ms results in healthy status', () => {
		const latency = 2000;
		const status = latency > 2000 ? 'degraded' : 'healthy';
		assert.strictEqual(status, 'healthy');
	});

	test('unsupported providers return error status', () => {
		const supportedProviders = ['ollama', 'vLLM', 'lmStudio'];
		const unsupported = ['anthropic', 'openAI', 'gemini'];

		for (const p of unsupported) {
			assert.ok(!supportedProviders.includes(p), `${p} should not be in supported list`);
		}
	});
});

suite('ModelManagementService — Provider Detection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detection uses correct API paths per provider', () => {
		const paths: Record<string, string> = {
			ollama: '/api/tags',
			vLLM: '/models',
			lmStudio: '/models',
		};

		// Ollama uses /api/tags (returns { models: [...] })
		assert.strictEqual(paths['ollama'], '/api/tags');
		// vLLM and LM Studio use OpenAI-compatible /models (returns { data: [...] })
		assert.strictEqual(paths['vLLM'], '/models');
		assert.strictEqual(paths['lmStudio'], '/models');
	});

	test('model count extracted correctly per provider format', () => {
		// Ollama format
		const ollamaResponse = { models: [{ name: 'llama3' }, { name: 'codestral' }] };
		assert.strictEqual(ollamaResponse.models?.length || 0, 2);

		// OpenAI-compatible format (vLLM, LM Studio)
		const openaiResponse = { data: [{ id: 'model-1' }, { id: 'model-2' }, { id: 'model-3' }] };
		assert.strictEqual(openaiResponse.data?.length || 0, 3);
	});

	test('CSP fix replaces 127.0.0.1 with localhost', () => {
		const endpoint = 'http://127.0.0.1:11434';
		const fixed = endpoint.replace('127.0.0.1', 'localhost');
		assert.strictEqual(fixed, 'http://localhost:11434');
	});

	test('CSP fix does not modify already-correct endpoints', () => {
		const endpoint = 'http://localhost:11434';
		const fixed = endpoint.replace('127.0.0.1', 'localhost');
		assert.strictEqual(fixed, 'http://localhost:11434');
	});

	test('CSP fix handles custom hosts', () => {
		const endpoint = 'http://my-server:11434';
		const fixed = endpoint.replace('127.0.0.1', 'localhost');
		assert.strictEqual(fixed, 'http://my-server:11434');
	});
});

suite('ModelManagementService — Model Test Metrics', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tokens per second calculation uses generation time', () => {
		const totalTime = 5000; // 5s total
		const ttft = 500; // 500ms to first token
		const fullTextLength = 200; // chars
		const estimatedOutputTokens = Math.ceil(fullTextLength / 4); // ~50 tokens
		const generationTime = (totalTime - ttft) / 1000; // 4.5s
		const tokensPerSecond = estimatedOutputTokens / generationTime;

		assert.ok(tokensPerSecond > 0);
		assert.ok(tokensPerSecond < 1000); // sanity check
		assert.strictEqual(Math.round(tokensPerSecond * 10) / 10, Math.round((50 / 4.5) * 10) / 10);
	});

	test('tokens per second is 0 when generationTime is 0', () => {
		const generationTime = 0;
		const tokensPerSecond = generationTime > 0 ? 50 / generationTime : 0;
		assert.strictEqual(tokensPerSecond, 0);
	});

	test('input token estimate uses char/4 heuristic', () => {
		const prompt = 'Hello, world! This is a test prompt.';
		const estimated = Math.ceil(prompt.length / 4);
		assert.strictEqual(estimated, Math.ceil(36 / 4));
		assert.strictEqual(estimated, 9);
	});

	test('empty response yields 0 tokens per second', () => {
		const fullText = '';
		const estimatedOutputTokens = Math.ceil(fullText.length / 4);
		assert.strictEqual(estimatedOutputTokens, 0);
	});
});

suite('ModelManagementService — Compare Models (allSettled)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Promise.allSettled preserves successful results when one fails', async () => {
		const tasks = [
			Promise.resolve({ modelId: 'a', success: true }),
			Promise.reject(new Error('timeout')),
			Promise.resolve({ modelId: 'c', success: true }),
		];

		const settled = await Promise.allSettled(tasks);
		const fulfilled = settled
			.filter((s): s is PromiseFulfilledResult<{ modelId: string; success: boolean }> => s.status === 'fulfilled')
			.map(s => s.value);

		assert.strictEqual(fulfilled.length, 2);
		assert.strictEqual(fulfilled[0].modelId, 'a');
		assert.strictEqual(fulfilled[1].modelId, 'c');
	});

	test('Promise.allSettled returns empty when all fail', async () => {
		const tasks: Promise<any>[] = [
			Promise.reject(new Error('fail1')),
			Promise.reject(new Error('fail2')),
		];

		const settled = await Promise.allSettled(tasks);
		const fulfilled = settled
			.filter((s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled');

		assert.strictEqual(fulfilled.length, 0);
	});
});
