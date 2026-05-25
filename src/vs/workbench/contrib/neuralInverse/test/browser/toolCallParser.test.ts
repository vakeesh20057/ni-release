/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseToolCalls, hasToolCalls, stripToolCallBlocks } from '../../browser/executor/toolCallParser.js';

suite('toolCallParser — parseToolCalls', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses single tool call object', () => {
		const text = '```json\n{"tool":"readFile","args":{"path":"src/index.ts"}}\n```';
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].tool, 'readFile');
		assert.deepStrictEqual(calls[0].args, { path: 'src/index.ts' });
	});

	test('parses array of tool calls', () => {
		const text = '```json\n[{"tool":"readFile","args":{"path":"a.ts"}},{"tool":"writeFile","args":{"path":"b.ts","content":"x"}}]\n```';
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0].tool, 'readFile');
		assert.strictEqual(calls[1].tool, 'writeFile');
	});

	test('returns empty array for empty input', () => {
		assert.deepStrictEqual(parseToolCalls(''), []);
	});

	test('returns empty array when no code blocks present', () => {
		assert.deepStrictEqual(parseToolCalls('Just some prose without any JSON blocks.'), []);
	});

	test('skips invalid JSON silently', () => {
		const text = '```json\n{not valid json\n```';
		const calls = parseToolCalls(text);
		assert.deepStrictEqual(calls, []);
	});

	test('skips JSON that has no "tool" field', () => {
		const text = '```json\n{"someKey":"someValue"}\n```';
		const calls = parseToolCalls(text);
		assert.deepStrictEqual(calls, []);
	});

	test('parses tool call without args field', () => {
		const text = '```json\n{"tool":"gitStatus"}\n```';
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].tool, 'gitStatus');
		assert.deepStrictEqual(calls[0].args, {});
	});

	test('extracts from multiple code blocks in one text', () => {
		const text = [
			'First call:',
			'```json\n{"tool":"readFile","args":{"path":"a.ts"}}\n```',
			'Second call:',
			'```json\n{"tool":"writeFile","args":{"path":"b.ts","content":"hello"}}\n```',
		].join('\n');
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 2);
	});

	test('handles args with nested objects', () => {
		const text = '```json\n{"tool":"httpRequest","args":{"method":"POST","url":"https://api.example.com","body":"{\\"key\\":\\"val\\"}"}}\n```';
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].args['method'], 'POST');
	});

	test('handles code block without json language tag', () => {
		const text = '```\n{"tool":"listDirectory","args":{"path":"."}}\n```';
		const calls = parseToolCalls(text);
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0].tool, 'listDirectory');
	});
});

suite('toolCallParser — hasToolCalls', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns true when valid tool call present', () => {
		const text = '```json\n{"tool":"readFile","args":{"path":"x.ts"}}\n```';
		assert.strictEqual(hasToolCalls(text), true);
	});

	test('returns false for empty string', () => {
		assert.strictEqual(hasToolCalls(''), false);
	});

	test('returns false for prose only', () => {
		assert.strictEqual(hasToolCalls('Let me think about this...'), false);
	});

	test('returns false when JSON is invalid', () => {
		assert.strictEqual(hasToolCalls('```json\n{broken\n```'), false);
	});

	test('returns false when JSON has no tool field', () => {
		assert.strictEqual(hasToolCalls('```json\n{"key":"value"}\n```'), false);
	});
});

suite('toolCallParser — stripToolCallBlocks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('removes json code block, keeps surrounding prose', () => {
		const text = 'Before\n```json\n{"tool":"readFile","args":{}}\n```\nAfter';
		const stripped = stripToolCallBlocks(text);
		assert.ok(stripped.includes('Before'), 'should keep text before block');
		assert.ok(stripped.includes('After'), 'should keep text after block');
		assert.ok(!stripped.includes('readFile'), 'should remove tool call content');
	});

	test('returns unchanged string when no blocks present', () => {
		const text = 'Just plain prose.';
		assert.strictEqual(stripToolCallBlocks(text), text);
	});

	test('removes multiple blocks', () => {
		const text = 'A\n```json\n{"tool":"a"}\n```\nB\n```json\n{"tool":"b"}\n```\nC';
		const stripped = stripToolCallBlocks(text);
		assert.ok(stripped.includes('A'));
		assert.ok(stripped.includes('B'));
		assert.ok(stripped.includes('C'));
		assert.ok(!stripped.includes('"tool"'));
	});

	test('handles empty input', () => {
		assert.strictEqual(stripToolCallBlocks(''), '');
	});
});
