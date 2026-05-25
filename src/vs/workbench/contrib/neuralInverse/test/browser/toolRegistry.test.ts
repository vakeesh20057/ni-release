/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToolRegistry } from '../../browser/tools/toolRegistry.js';
import { IAgentTool, IToolResult, IToolExecutionContext } from '../../common/workflowTypes.js';

function makeTool(name: string, requiredParams: string[] = [], optionalParams: string[] = []): IAgentTool {
	const parameters: Record<string, any> = {};
	for (const p of requiredParams) {
		parameters[p] = { type: 'string', description: `param ${p}`, required: true };
	}
	for (const p of optionalParams) {
		parameters[p] = { type: 'string', description: `param ${p}`, required: false };
	}
	return {
		name,
		description: `Description for ${name}`,
		parameters,
		async execute(_args: Record<string, unknown>, _ctx: IToolExecutionContext): Promise<IToolResult> {
			return { success: true, output: `${name} ran` };
		}
	};
}

suite('ToolRegistry — register and retrieve', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('register and get tool by name', () => {
		const registry = new ToolRegistry();
		const tool = makeTool('readFile', ['path']);
		registry.register(tool);
		assert.strictEqual(registry.get('readFile'), tool);
	});

	test('has() returns true after registration', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));
		assert.strictEqual(registry.has('readFile'), true);
	});

	test('has() returns false for unregistered tool', () => {
		const registry = new ToolRegistry();
		assert.strictEqual(registry.has('nonexistent'), false);
	});

	test('get() returns undefined for unknown tool', () => {
		const registry = new ToolRegistry();
		assert.strictEqual(registry.get('unknown'), undefined);
	});

	test('getAll() returns all registered tools', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));
		registry.register(makeTool('writeFile'));
		const all = registry.getAll();
		assert.strictEqual(all.length, 2);
	});

	test('registerMany() registers all tools', () => {
		const registry = new ToolRegistry();
		registry.registerMany([makeTool('a'), makeTool('b'), makeTool('c')]);
		assert.strictEqual(registry.getAll().length, 3);
		assert.ok(registry.has('a'));
		assert.ok(registry.has('b'));
		assert.ok(registry.has('c'));
	});
});

suite('ToolRegistry — scoping', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('scope() returns only allowed tools', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));
		registry.register(makeTool('writeFile'));
		registry.register(makeTool('deleteFile'));

		const scoped = registry.scope(['readFile', 'writeFile']);
		const names = scoped.getAll().map(t => t.name);
		assert.ok(names.includes('readFile'));
		assert.ok(names.includes('writeFile'));
		assert.ok(!names.includes('deleteFile'));
	});

	test('scope() silently ignores unknown tool names', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));

		const scoped = registry.scope(['readFile', 'nonexistentTool']);
		assert.strictEqual(scoped.getAll().length, 1);
		assert.strictEqual(scoped.get('nonexistentTool'), undefined);
	});

	test('scope() with empty list returns no tools', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));
		const scoped = registry.scope([]);
		assert.strictEqual(scoped.getAll().length, 0);
	});

	test('scoped get() returns correct tool', () => {
		const registry = new ToolRegistry();
		const tool = makeTool('readFile', ['path']);
		registry.register(tool);
		const scoped = registry.scope(['readFile']);
		assert.strictEqual(scoped.get('readFile'), tool);
	});
});

suite('ToolRegistry — getSchema', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('getSchema() produces one entry per tool', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile', ['path']));
		registry.register(makeTool('writeFile', ['path', 'content']));
		const schema = registry.getSchema();
		assert.strictEqual(schema.length, 2);
	});

	test('schema entry has name and description', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile', ['path']));
		const [entry] = registry.getSchema() as any[];
		assert.strictEqual(entry.name, 'readFile');
		assert.ok(entry.description);
	});

	test('required parameters are marked in schema', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile', ['path'], ['encoding']));
		const [entry] = registry.getSchema() as any[];
		const required: string[] = entry.input_schema?.required ?? entry.parameters?.required ?? [];
		assert.ok(required.includes('path'), 'path should be required');
		assert.ok(!required.includes('encoding'), 'encoding should not be required');
	});

	test('getSchema() with tool filter returns subset', () => {
		const registry = new ToolRegistry();
		registry.register(makeTool('readFile'));
		registry.register(makeTool('writeFile'));
		const schema = registry.getSchema(['readFile']);
		assert.strictEqual(schema.length, 1);
		assert.strictEqual((schema[0] as any).name, 'readFile');
	});

	test('empty registry returns empty schema', () => {
		const registry = new ToolRegistry();
		assert.deepStrictEqual(registry.getSchema(), []);
	});
});
