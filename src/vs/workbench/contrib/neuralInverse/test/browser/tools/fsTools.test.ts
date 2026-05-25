/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ALL_FS_TOOLS } from '../../../browser/tools/fsTools.js';
import { IToolExecutionContext, IToolResult } from '../../../common/workflowTypes.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';

// --- Stub file service ----------------------------------------------------------

interface IStubFS {
	[path: string]: string;
}

function makeCtx(fsStub: IStubFS = {}): IToolExecutionContext {
	return {
		workspaceUri: URI.file('/workspace'),
		fileService: {
			async readFile(uri: URI) {
				const rel = uri.fsPath.replace('/workspace/', '');
				const abs = uri.fsPath;
				const content = fsStub[rel] ?? fsStub[abs];
				if (content === undefined) {
					const err: any = new Error(`File not found: ${uri.fsPath}`);
					err.fileOperationResult = 1; // FILE_NOT_FOUND
					throw err;
				}
				return { value: VSBuffer.fromString(content) };
			},
			async writeFile(uri: URI, _buf: VSBuffer) { /* noop */ },
			async resolve(uri: URI) {
				const rel = uri.fsPath.replace('/workspace/', '');
				if (fsStub[rel] !== undefined) {
					return { name: rel, isDirectory: false, children: [] };
				}
				const children = Object.keys(fsStub)
					.filter(k => k.startsWith(rel + '/') || rel === '.')
					.map(k => ({ name: k.split('/').pop()!, resource: URI.file(`/workspace/${k}`), isDirectory: false }));
				if (children.length === 0 && rel !== '.') {
					throw new Error(`Not found: ${rel}`);
				}
				return { name: rel, isDirectory: true, children };
			},
			async del(_uri: URI) { /* noop */ },
		} as any,
		log: () => {},
	};
}

const readFile = ALL_FS_TOOLS.find(t => t.name === 'readFile')!;
const writeFile = ALL_FS_TOOLS.find(t => t.name === 'writeFile')!;
const searchCode = ALL_FS_TOOLS.find(t => t.name === 'searchCode')!;
const deleteFile = ALL_FS_TOOLS.find(t => t.name === 'deleteFile')!;

// --- ReadFileTool ---------------------------------------------------------------

suite('ReadFileTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads existing file content', async () => {
		const ctx = makeCtx({ 'src/index.ts': 'export const x = 1;' });
		const result = await readFile.execute({ path: 'src/index.ts' }, ctx);
		assert.strictEqual(result.success, true);
		assert.ok(result.output.includes('export const x = 1;'));
	});

	test('returns error for non-existent file', async () => {
		const ctx = makeCtx({});
		const result = await readFile.execute({ path: 'nonexistent.ts' }, ctx);
		assert.strictEqual(result.success, false);
	});

	test('requires path parameter', async () => {
		assert.strictEqual(readFile.parameters['path']?.required, true);
	});
});

// --- WriteFileTool ---------------------------------------------------------------

suite('WriteFileTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('succeeds for normal path', async () => {
		const ctx = makeCtx({});
		const result = await writeFile.execute({ path: 'src/output.ts', content: 'const y = 2;' }, ctx);
		assert.strictEqual(result.success, true);
	});

	test('blocks write to .inverse/ directory', async () => {
		const ctx = makeCtx({});
		const result = await writeFile.execute({ path: '.inverse/agents/hacked.json', content: '{}' }, ctx);
		assert.strictEqual(result.success, false);
		assert.ok((result.error ?? result.output).toLowerCase().includes('protect') ||
			(result.error ?? result.output).toLowerCase().includes('block') ||
			(result.error ?? result.output).toLowerCase().includes('inverse'));
	});

	test('blocks write to .inverse root', async () => {
		const ctx = makeCtx({});
		const result = await writeFile.execute({ path: '.inverse', content: '{}' }, ctx);
		assert.strictEqual(result.success, false);
	});

	test('requires path and content parameters', () => {
		assert.strictEqual(writeFile.parameters['path']?.required, true);
		assert.strictEqual(writeFile.parameters['content']?.required, true);
	});
});

// --- DeleteFileTool ---------------------------------------------------------------

suite('DeleteFileTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('succeeds for normal path', async () => {
		const ctx = makeCtx({ 'src/old.ts': 'old content' });
		const result = await deleteFile.execute({ path: 'src/old.ts' }, ctx);
		assert.strictEqual(result.success, true);
	});

	test('blocks deletion from .inverse/', async () => {
		const ctx = makeCtx({});
		const result = await deleteFile.execute({ path: '.inverse/agents/code-reviewer.json' }, ctx);
		assert.strictEqual(result.success, false);
	});

	test('requires path parameter', () => {
		assert.strictEqual(deleteFile.parameters['path']?.required, true);
	});
});

// --- SearchCodeTool ---------------------------------------------------------------

suite('SearchCodeTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('finds pattern in files', async () => {
		const ctx = makeCtx({
			'src/index.ts': 'export function hello() { return "world"; }',
			'src/utils.ts': 'export function greet(name: string) { return `hi ${name}`; }',
		});
		const result = await searchCode.execute({ pattern: 'export function', directory: '.' }, ctx);
		assert.strictEqual(result.success, true);
		assert.ok(result.output.includes('src/index.ts') || result.output.includes('hello'));
	});

	test('returns empty result for non-matching pattern', async () => {
		const ctx = makeCtx({ 'src/index.ts': 'const x = 1;' });
		const result = await searchCode.execute({ pattern: 'PATTERN_THAT_NEVER_MATCHES_XYZZY' }, ctx);
		assert.strictEqual(result.success, true);
		// Should report 0 results, not fail
	});

	test('respects maxResults limit', async () => {
		// Build a file with 100 matches
		const lines = Array.from({ length: 100 }, (_, i) => `const match${i} = true;`).join('\n');
		const ctx = makeCtx({ 'src/big.ts': lines });
		const result = await searchCode.execute({ pattern: 'const match', directory: '.', maxResults: 5 }, ctx);
		assert.strictEqual(result.success, true);
		// Count result lines (format: file:line: content)
		const matchLines = result.output.split('\n').filter(l => l.includes(':'));
		assert.ok(matchLines.length <= 5, `expected ≤5 results, got ${matchLines.length}`);
	});

	test('requires pattern parameter', () => {
		assert.strictEqual(searchCode.parameters['pattern']?.required, true);
	});

	test('directory parameter is optional', () => {
		const p = searchCode.parameters['directory'];
		assert.ok(!p || p.required !== true);
	});
});

// --- .inverse protection coverage ------------------------------------------------

suite('FS tools — .inverse protection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const inverseVariants = [
		'.inverse',
		'.inverse/',
		'.inverse/agents',
		'.inverse/agents/code-reviewer.json',
		'.inverse/workflows/my-flow.json',
	];

	for (const path of inverseVariants) {
		test(`writeFile blocks "${path}"`, async () => {
			const result: IToolResult = await writeFile.execute({ path, content: '{}' }, makeCtx());
			assert.strictEqual(result.success, false, `writeFile should block "${path}"`);
		});

		test(`deleteFile blocks "${path}"`, async () => {
			const result: IToolResult = await deleteFile.execute({ path }, makeCtx());
			assert.strictEqual(result.success, false, `deleteFile should block "${path}"`);
		});
	}
});
