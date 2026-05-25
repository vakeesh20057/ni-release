/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { NodeRegistry } from '../../../browser/composer/nodes/nodeRegistry.js';
import { NodeType } from '../../../browser/composer/model/composerModel.js';

suite('NodeRegistry — definitions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const ALL_TYPES: NodeType[] = ['trigger', 'agent', 'conditional', 'transform', 'output', 'group'];

	test('all 6 node types are registered', () => {
		const registry = new NodeRegistry();
		for (const type of ALL_TYPES) {
			assert.ok(registry.getDefinition(type), `${type} should be registered`);
		}
	});

	test('each node type has required fields', () => {
		const registry = new NodeRegistry();
		for (const type of ALL_TYPES) {
			const def = registry.getDefinition(type)!;
			assert.ok(def.label, `${type} should have a label`);
			assert.ok(def.color, `${type} should have a color`);
			assert.ok(def.icon, `${type} should have an icon`);
			assert.ok(def.defaultSize.width > 0, `${type} should have positive width`);
			assert.ok(def.defaultSize.height > 0, `${type} should have positive height`);
			assert.ok(Array.isArray(def.ports), `${type} should have ports array`);
			assert.ok(Array.isArray(def.configSchema), `${type} should have configSchema array`);
		}
	});

	test('trigger node has exactly one output port and no input ports', () => {
		const registry = new NodeRegistry();
		const def = registry.getDefinition('trigger')!;
		const outputs = def.ports.filter(p => p.side === 'output');
		const inputs = def.ports.filter(p => p.side === 'input');
		assert.strictEqual(outputs.length, 1);
		assert.strictEqual(inputs.length, 0);
	});

	test('agent node has one input and one output port', () => {
		const registry = new NodeRegistry();
		const def = registry.getDefinition('agent')!;
		const outputs = def.ports.filter(p => p.side === 'output');
		const inputs = def.ports.filter(p => p.side === 'input');
		assert.strictEqual(inputs.length, 1);
		assert.strictEqual(outputs.length, 1);
	});

	test('conditional node has one input and two output ports', () => {
		const registry = new NodeRegistry();
		const def = registry.getDefinition('conditional')!;
		const outputs = def.ports.filter(p => p.side === 'output');
		const inputs = def.ports.filter(p => p.side === 'input');
		assert.strictEqual(inputs.length, 1);
		assert.strictEqual(outputs.length, 2);
	});

	test('output node has one input and no output ports', () => {
		const registry = new NodeRegistry();
		const def = registry.getDefinition('output')!;
		const outputs = def.ports.filter(p => p.side === 'output');
		const inputs = def.ports.filter(p => p.side === 'input');
		assert.strictEqual(inputs.length, 1);
		assert.strictEqual(outputs.length, 0);
	});

	test('group node has no ports', () => {
		const registry = new NodeRegistry();
		const def = registry.getDefinition('group')!;
		assert.strictEqual(def.ports.length, 0);
	});
});

suite('NodeRegistry — createNode', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('createNode returns node with correct type and position', () => {
		const registry = new NodeRegistry();
		const node = registry.createNode('agent', { x: 100, y: 200 });
		assert.strictEqual(node.type, 'agent');
		assert.strictEqual(node.position.x, 100);
		assert.strictEqual(node.position.y, 200);
	});

	test('createNode merges configOverrides into defaultConfig', () => {
		const registry = new NodeRegistry();
		const node = registry.createNode('agent', { x: 0, y: 0 }, { agentId: 'code-reviewer', maxIterations: 5 });
		assert.strictEqual(node.config['agentId'], 'code-reviewer');
		assert.strictEqual(node.config['maxIterations'], 5);
		// Default from schema should still be present unless overridden
		assert.ok('role' in node.config);
	});

	test('createNode generates unique ids', () => {
		const registry = new NodeRegistry();
		const ids = new Set<string>();
		for (let i = 0; i < 50; i++) {
			ids.add(registry.createNode('agent', { x: 0, y: 0 }).id);
		}
		assert.strictEqual(ids.size, 50, 'all generated ids should be unique');
	});

	test('createNode throws for unknown type', () => {
		const registry = new NodeRegistry();
		assert.throws(() => {
			registry.createNode('unknown' as NodeType, { x: 0, y: 0 });
		});
	});

	test('createTriggerNode sets correct label per trigger type', () => {
		const registry = new NodeRegistry();
		const cases: [string, string][] = [
			['manual', 'Manual Trigger'],
			['file-save', 'On File Save'],
			['on-commit', 'On Commit'],
			['schedule', 'Scheduled'],
			['terminal-command', 'Terminal Command'],
		];
		for (const [triggerType, expectedLabel] of cases) {
			const node = registry.createTriggerNode({ x: 0, y: 0 }, triggerType);
			assert.strictEqual(node.label, expectedLabel, `label for ${triggerType}`);
			assert.strictEqual(node.config['triggerType'], triggerType);
		}
	});

	test('createAgentNode sets agentId and label', () => {
		const registry = new NodeRegistry();
		const node = registry.createAgentNode({ x: 0, y: 0 }, 'code-reviewer', 'Code Reviewer', ['readFile']);
		assert.strictEqual(node.label, 'Code Reviewer');
		assert.strictEqual(node.config['agentId'], 'code-reviewer');
		assert.deepStrictEqual(node.config['allowedTools'], ['readFile']);
	});
});

suite('NodeRegistry — getByCategory', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('trigger category returns trigger node only', () => {
		const registry = new NodeRegistry();
		const defs = registry.getByCategory('trigger');
		assert.ok(defs.length >= 1);
		assert.ok(defs.every(d => d.category === 'trigger'));
	});

	test('logic category returns conditional, transform, group', () => {
		const registry = new NodeRegistry();
		const defs = registry.getByCategory('logic');
		const types = defs.map(d => d.type);
		assert.ok(types.includes('conditional'));
		assert.ok(types.includes('transform'));
		assert.ok(types.includes('group'));
	});

	test('output category returns output node only', () => {
		const registry = new NodeRegistry();
		const defs = registry.getByCategory('output');
		assert.ok(defs.length >= 1);
		assert.ok(defs.every(d => d.category === 'output'));
	});

	test('all definitions are covered by categories', () => {
		const registry = new NodeRegistry();
		const all = registry.getAllDefinitions();
		const byCategory = [
			...registry.getByCategory('trigger'),
			...registry.getByCategory('agent'),
			...registry.getByCategory('logic'),
			...registry.getByCategory('output'),
		];
		assert.strictEqual(byCategory.length, all.length, 'all definitions should be in a category');
	});
});
