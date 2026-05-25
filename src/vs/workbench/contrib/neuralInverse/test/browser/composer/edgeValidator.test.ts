/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ComposerModel, IComposerNode, IPortDefinition } from '../../../browser/composer/model/composerModel.js';
import { EdgeValidator } from '../../../browser/composer/edges/edgeValidator.js';

function makeNode(id: string, ports: IPortDefinition[]): IComposerNode {
	return {
		id,
		type: 'agent',
		label: id,
		position: { x: 0, y: 0 },
		size: { width: 180, height: 80 },
		config: {},
		ports,
		enabled: true,
	};
}

function triggerNode(id: string): IComposerNode {
	return makeNode(id, [
		{ id: 'trigger-out', label: 'Fires', dataType: 'flow', side: 'output' }
	]);
}

function agentNode(id: string): IComposerNode {
	return makeNode(id, [
		{ id: 'agent-in', label: 'Input', dataType: 'flow', side: 'input' },
		{ id: 'agent-out', label: 'Output', dataType: 'text', side: 'output' },
	]);
}

function outputNode(id: string): IComposerNode {
	return makeNode(id, [
		{ id: 'output-in', label: 'Result', dataType: 'any', side: 'input' }
	]);
}

suite('EdgeValidator — canConnect', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('valid connection trigger → agent is accepted', () => {
		const model = new ComposerModel();
		model.addNode(triggerNode('t1'));
		model.addNode(agentNode('a1'));

		const v = new EdgeValidator();
		const result = v.canConnect(model, 't1', 'trigger-out', 'a1', 'agent-in');
		assert.ok(result.valid, result.reason);
		model.dispose();
	});

	test('self-connection is rejected', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));

		const v = new EdgeValidator();
		const result = v.canConnect(model, 'a1', 'agent-out', 'a1', 'agent-in');
		assert.ok(!result.valid);
		assert.ok(result.reason!.toLowerCase().includes('self'));
		model.dispose();
	});

	test('connecting output port to output port is rejected', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));
		model.addNode(agentNode('a2'));

		const v = new EdgeValidator();
		// both ports are 'output' side
		const result = v.canConnect(model, 'a1', 'agent-out', 'a2', 'agent-out');
		assert.ok(!result.valid);
		model.dispose();
	});

	test('duplicate connection is rejected', () => {
		const model = new ComposerModel();
		model.addNode(triggerNode('t1'));
		model.addNode(agentNode('a1'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		const result = v.canConnect(model, 't1', 'trigger-out', 'a1', 'agent-in');
		assert.ok(!result.valid);
		assert.ok(result.reason!.toLowerCase().includes('duplicate') || result.reason!.toLowerCase().includes('already'));
		model.dispose();
	});

	test('cycle detection: A→B→A is rejected', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));
		model.addNode(agentNode('a2'));
		// a1 → a2 already exists
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		// a2 → a1 would create a cycle
		const result = v.canConnect(model, 'a2', 'agent-out', 'a1', 'agent-in');
		assert.ok(!result.valid);
		assert.ok(result.reason!.toLowerCase().includes('cycle'));
		model.dispose();
	});

	test('cycle detection: A→B→C→A is rejected', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));
		model.addNode(agentNode('a2'));
		model.addNode(agentNode('a3'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a2', sourcePortId: 'agent-out', targetNodeId: 'a3', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		const result = v.canConnect(model, 'a3', 'agent-out', 'a1', 'agent-in');
		assert.ok(!result.valid);
		assert.ok(result.reason!.toLowerCase().includes('cycle'));
		model.dispose();
	});
});

suite('EdgeValidator — validateGraph', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('valid linear pipeline passes validation', () => {
		const model = new ComposerModel();
		const trigger = triggerNode('t1');
		const agent = agentNode('a1');
		const out = outputNode('o1');
		model.addNode(trigger);
		model.addNode(agent);
		model.addNode(out);
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'o1', targetPortId: 'output-in' });

		const v = new EdgeValidator();
		const result = v.validateGraph(model);
		assert.ok(result.valid);
		assert.strictEqual(result.errors.length, 0);
		model.dispose();
	});

	test('orphan node produces a warning not an error', () => {
		const model = new ComposerModel();
		model.addNode(triggerNode('t1'));
		model.addNode(agentNode('a1')); // orphan — not connected
		model.addNode(agentNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		const result = v.validateGraph(model);
		assert.ok(result.warnings.length > 0, 'orphan node should produce warning');
		model.dispose();
	});

	test('empty model is valid', () => {
		const model = new ComposerModel();
		const v = new EdgeValidator();
		const result = v.validateGraph(model);
		assert.ok(result.valid);
		model.dispose();
	});
});

suite('EdgeValidator — getTopologicalOrder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('linear graph returns correct topological order', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));
		model.addNode(agentNode('a2'));
		model.addNode(agentNode('a3'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a2', sourcePortId: 'agent-out', targetNodeId: 'a3', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		const order = v.getTopologicalOrder(model);
		assert.ok(order !== null, 'topological order should not be null for acyclic graph');
		const idx = (id: string) => order!.indexOf(id);

		assert.ok(idx('a1') < idx('a2'), 'a1 should come before a2');
		assert.ok(idx('a2') < idx('a3'), 'a2 should come before a3');
		model.dispose();
	});

	test('topological order includes all nodes', () => {
		const model = new ComposerModel();
		model.addNode(agentNode('a1'));
		model.addNode(agentNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const v = new EdgeValidator();
		const order = v.getTopologicalOrder(model);
		assert.ok(order !== null);
		assert.strictEqual(order!.length, 2);
		model.dispose();
	});
});
