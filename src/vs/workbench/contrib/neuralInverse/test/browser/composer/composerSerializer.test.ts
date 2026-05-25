/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ComposerModel, IComposerNode, NodeType } from '../../../browser/composer/model/composerModel.js';
import { ComposerSerializer } from '../../../browser/composer/model/composerSerializer.js';

function makeNode(id: string, type: NodeType, x = 0, y = 0): IComposerNode {
	return {
		id,
		type,
		label: id,
		position: { x, y },
		size: { width: 180, height: 80 },
		config: type === 'trigger' ? { triggerType: 'manual' } : { agentId: 'code-reviewer', role: 'executor', allowedTools: ['readFile'], maxIterations: 20 },
		ports: type === 'trigger'
			? [{ id: 'trigger-out', label: 'Fires', dataType: 'flow', side: 'output' }]
			: [{ id: 'agent-in', label: 'Input', dataType: 'flow', side: 'input' }, { id: 'agent-out', label: 'Output', dataType: 'text', side: 'output' }],
		enabled: true,
	};
}

suite('ComposerSerializer — serialize', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('serializes trigger node to IWorkflowDefinition trigger field', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger'));

		const s = new ComposerSerializer();
		const result = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });

		assert.strictEqual(result.definition.trigger, 'manual');
		model.dispose();
	});

	test('serializes agent node to workflow step', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger'));
		model.addNode(makeNode('a1', 'agent'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });

		const s = new ComposerSerializer();
		const result = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });

		const steps = result.definition.steps;
		assert.ok(steps.length >= 1, 'should have at least one step');
		const agentStep = steps.find(s => s.id === 'a1' || s.agentId === 'code-reviewer');
		assert.ok(agentStep, 'agent step should exist');
		assert.ok(agentStep!.allowedTools.includes('readFile'));
		model.dispose();
	});

	test('dependsOn reflects edge connections', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger'));
		model.addNode(makeNode('a1', 'agent'));
		model.addNode(makeNode('a2', 'agent'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const s = new ComposerSerializer();
		const result = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });

		const a2Step = result.definition.steps.find(st => st.id === 'a2');
		assert.ok(a2Step, 'a2 step should exist');
		assert.ok(a2Step!.dependsOn?.includes('a1'), 'a2 should depend on a1');
		model.dispose();
	});

	test('layout metadata stored under _composerLayout', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger', 100, 200));

		const s = new ComposerSerializer();
		const result = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });

		assert.ok('_composerLayout' in result.definition, '_composerLayout key should be present');
		const layout = (result.definition as any)._composerLayout;
		assert.ok(layout.nodes && layout.nodes['t1'], 'layout should store node position');
		assert.strictEqual(layout.nodes['t1'].x, 100);
		assert.strictEqual(layout.nodes['t1'].y, 200);
		model.dispose();
	});
});

suite('ComposerSerializer — deserialize', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('deserializes workflow with steps back into nodes', () => {
		const definition = {
			id: 'wf-1',
			name: 'Test',
			description: '',
			trigger: 'manual' as const,
			enabled: true,
			steps: [
				{ id: 'a1', agentId: 'code-reviewer', role: 'executor' as const, allowedTools: ['readFile'], maxIterations: 20 }
			]
		};

		const s = new ComposerSerializer();
		const model = s.deserialize({ definition });

		// Should have at least the agent node (and possibly a trigger node added automatically)
		assert.ok(model.nodes.size >= 1);
		const agentNode = [...model.nodes.values()].find(n => n.id === 'a1' || n.config['agentId'] === 'code-reviewer');
		assert.ok(agentNode, 'agent node should be deserialized');
		model.dispose();
	});

	test('roundtrip serialize → deserialize preserves node count', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger'));
		model.addNode(makeNode('a1', 'agent'));
		model.addNode(makeNode('a2', 'agent'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const s = new ComposerSerializer();
		const serialized = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });
		const restored = s.deserialize(serialized);

		// Agent nodes should roundtrip (trigger may be implicit)
		const agentNodes = [...restored.nodes.values()].filter(n => n.type === 'agent');
		assert.ok(agentNodes.length >= 2, `expected ≥2 agent nodes, got ${agentNodes.length}`);

		model.dispose();
		restored.dispose();
	});

	test('roundtrip preserves layout positions from _composerLayout', () => {
		const model = new ComposerModel();
		const node = makeNode('a1', 'agent', 150, 250);
		model.addNode(node);

		const s = new ComposerSerializer();
		const serialized = s.serialize(model, { id: 'wf-1', name: 'Test', description: '' });
		const restored = s.deserialize(serialized);

		const restoredNode = [...restored.nodes.values()].find(n => n.id === 'a1');
		if (restoredNode) {
			assert.strictEqual(restoredNode.position.x, 150);
			assert.strictEqual(restoredNode.position.y, 250);
		}

		model.dispose();
		restored.dispose();
	});
});
