/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ALL_HTTP_TOOLS } from '../../../browser/tools/httpTools.js';
import { IToolExecutionContext } from '../../../common/workflowTypes.js';
import { URI } from '../../../../../../base/common/uri.js';

// Minimal stub context — http tools don't use fileService
function makeCtx(): IToolExecutionContext {
	return {
		workspaceUri: URI.file('/workspace'),
		fileService: {} as any,
		log: () => {},
	};
}

const httpTool = ALL_HTTP_TOOLS.find(t => t.name === 'httpRequest')!;

suite('HttpRequestTool — SSRF protection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const blockedUrls = [
		'http://localhost/api',
		'http://127.0.0.1/secret',
		'http://127.0.0.99/anything',
		'http://10.0.0.1/internal',
		'http://10.255.255.255/internal',
		'http://192.168.0.1/admin',
		'http://192.168.255.255/admin',
		'http://172.16.0.1/internal',
		'http://172.31.255.255/internal',
		'http://0.0.0.0/exploit',
		'http://[::1]/local',
	];

	for (const url of blockedUrls) {
		test(`blocks private URL: ${url}`, async () => {
			const result = await httpTool.execute({ method: 'GET', url }, makeCtx());
			assert.strictEqual(result.success, false);
			assert.ok(result.error ?? result.output, 'should have error message');
		});
	}
});

suite('HttpRequestTool — protocol validation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects non-http protocol (file://)', async () => {
		const result = await httpTool.execute({ method: 'GET', url: 'file:///etc/passwd' }, makeCtx());
		assert.strictEqual(result.success, false);
	});

	test('rejects ftp:// protocol', async () => {
		const result = await httpTool.execute({ method: 'GET', url: 'ftp://example.com/file' }, makeCtx());
		assert.strictEqual(result.success, false);
	});
});

suite('HttpRequestTool — input validation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects invalid JSON in headers param', async () => {
		const result = await httpTool.execute({
			method: 'GET',
			url: 'https://httpbin.org/get',
			headers: '{not valid json',
		}, makeCtx());
		assert.strictEqual(result.success, false);
	});

	test('rejects body larger than 256KB', async () => {
		const bigBody = 'x'.repeat(256 * 1024 + 1);
		const result = await httpTool.execute({
			method: 'POST',
			url: 'https://httpbin.org/post',
			body: bigBody,
		}, makeCtx());
		assert.strictEqual(result.success, false);
		assert.ok((result.error ?? result.output).toLowerCase().includes('large') ||
			(result.error ?? result.output).toLowerCase().includes('size') ||
			(result.error ?? result.output).toLowerCase().includes('exceed'));
	});
});

suite('HttpRequestTool — tool metadata', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tool is registered with name httpRequest', () => {
		assert.ok(httpTool, 'httpRequest tool should exist in ALL_HTTP_TOOLS');
		assert.strictEqual(httpTool.name, 'httpRequest');
	});

	test('tool has required parameters: method and url', () => {
		assert.ok('method' in httpTool.parameters);
		assert.ok('url' in httpTool.parameters);
		assert.strictEqual(httpTool.parameters['method']?.required, true);
		assert.strictEqual(httpTool.parameters['url']?.required, true);
	});

	test('method parameter has valid enum values', () => {
		const methodParam = httpTool.parameters['method'] as any;
		const allowedMethods = methodParam?.enum ?? [];
		assert.ok(allowedMethods.includes('GET'));
		assert.ok(allowedMethods.includes('POST'));
		assert.ok(allowedMethods.includes('PUT'));
		assert.ok(allowedMethods.includes('DELETE'));
	});
});
