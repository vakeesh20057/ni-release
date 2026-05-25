/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ComposerModel, IComposerNode, NodeType } from '../../../browser/composer/model/composerModel.js';
import {
	ComposerHistory,
	AddNodeCommand,
	RemoveNodeCommand,
	MoveNodeCommand,
	AddEdgeCommand,
	RemoveEdgeCommand,
	UpdateNodeConfigCommand,
} from '../../../browser/composer/model/composerHistory.js';

function makeNode(id: string, type: NodeType = 'agent'): IComposerNode {
	return {
		id,
		type,
		label: id,
		position: { x: 0, y: 0 },
		size: { width: 180, height: 80 },
		config: {},
		ports: [],
		enabled: true,
	};
}

suite('ComposerHistory — undo/redo basics', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('execute adds to undo stack', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.execute(new AddNodeCommand(makeNode('n1')), model);
		assert.ok(history.canUndo);
		assert.ok(!history.canRedo);

		model.dispose();
		history.dispose();
	});

	test('undo removes node and enables redo', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.execute(new AddNodeCommand(makeNode('n1')), model);
		assert.ok(model.nodes.has('n1'));

		history.undo(model);
		assert.ok(!model.nodes.has('n1'));
		assert.ok(!history.canUndo);
		assert.ok(history.canRedo);

		model.dispose();
		history.dispose();
	});

	test('redo re-applies command', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.execute(new AddNodeCommand(makeNode('n1')), model);
		history.undo(model);
		history.redo(model);

		assert.ok(model.nodes.has('n1'));
		assert.ok(history.canUndo);
		assert.ok(!history.canRedo);

		model.dispose();
		history.dispose();
	});

	test('new command clears redo stack', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.execute(new AddNodeCommand(makeNode('n1')), model);
		history.undo(model);
		assert.ok(history.canRedo);

		history.execute(new AddNodeCommand(makeNode('n2')), model);
		assert.ok(!history.canRedo, 'redo stack should be cleared after new command');

		model.dispose();
		history.dispose();
	});

	test('clear empties both stacks', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.execute(new AddNodeCommand(makeNode('n1')), model);
		history.execute(new AddNodeCommand(makeNode('n2')), model);
		history.clear();

		assert.ok(!history.canUndo);
		assert.ok(!history.canRedo);

		model.dispose();
		history.dispose();
	});
});

suite('ComposerHistory — individual commands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('RemoveNodeCommand undo restores node', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();
		const node = makeNode('n1');
		model.addNode(node);

		history.execute(new RemoveNodeCommand('n1'), model);
		assert.ok(!model.nodes.has('n1'));

		history.undo(model);
		assert.ok(model.nodes.has('n1'));

		model.dispose();
		history.dispose();
	});

	test('MoveNodeCommand undo restores original position', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();
		const node = makeNode('n1');
		node.position = { x: 10, y: 20 };
		model.addNode(node);

		history.execute(new MoveNodeCommand('n1', 100, 200), model);
		assert.strictEqual(model.getNode('n1')!.position.x, 100);

		history.undo(model);
		assert.strictEqual(model.getNode('n1')!.position.x, 10);
		assert.strictEqual(model.getNode('n1')!.position.y, 20);

		model.dispose();
		history.dispose();
	});

	test('UpdateNodeConfigCommand undo restores previous config', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();
		const node = makeNode('n1');
		node.config = { agentId: 'old-agent' };
		model.addNode(node);

		history.execute(new UpdateNodeConfigCommand('n1', { agentId: 'new-agent' }), model);
		assert.strictEqual(model.getNode('n1')!.config['agentId'], 'new-agent');

		history.undo(model);
		assert.strictEqual(model.getNode('n1')!.config['agentId'], 'old-agent');

		model.dispose();
		history.dispose();
	});

	test('AddEdge / undo removes edge', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));

		const edge = { id: 'e1', sourceNodeId: 'n1', sourcePortId: 'out', targetNodeId: 'n2', targetPortId: 'in' };
		history.execute(new AddEdgeCommand(edge), model);
		assert.ok(model.edges.has('e1'));

		history.undo(model);
		assert.ok(!model.edges.has('e1'));

		model.dispose();
		history.dispose();
	});

	test('RemoveEdge / undo restores edge', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		const edge = { id: 'e1', sourceNodeId: 'n1', sourcePortId: 'out', targetNodeId: 'n2', targetPortId: 'in' };
		model.addEdge(edge);

		history.execute(new RemoveEdgeCommand('e1'), model);
		assert.ok(!model.edges.has('e1'));

		history.undo(model);
		assert.ok(model.edges.has('e1'));

		model.dispose();
		history.dispose();
	});
});

suite('ComposerHistory — batch operations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('beginBatch/endBatch groups commands into single undo step', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.beginBatch('add three nodes');
		history.execute(new AddNodeCommand(makeNode('n1')), model);
		history.execute(new AddNodeCommand(makeNode('n2')), model);
		history.execute(new AddNodeCommand(makeNode('n3')), model);
		history.endBatch(model);

		assert.ok(model.nodes.has('n1'));
		assert.ok(model.nodes.has('n2'));
		assert.ok(model.nodes.has('n3'));

		// Single undo should remove all three
		history.undo(model);
		assert.ok(!model.nodes.has('n1'));
		assert.ok(!model.nodes.has('n2'));
		assert.ok(!model.nodes.has('n3'));
		assert.ok(!history.canUndo, 'should be at bottom of stack after batch undo');

		model.dispose();
		history.dispose();
	});

	test('batch redo re-adds all nodes together', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		history.beginBatch('add two nodes');
		history.execute(new AddNodeCommand(makeNode('n1')), model);
		history.execute(new AddNodeCommand(makeNode('n2')), model);
		history.endBatch(model);

		history.undo(model);
		history.redo(model);

		assert.ok(model.nodes.has('n1'));
		assert.ok(model.nodes.has('n2'));

		model.dispose();
		history.dispose();
	});
});

suite('ComposerHistory — stack depth limit', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('undo stack does not grow beyond 100 entries', () => {
		const model = new ComposerModel();
		const history = new ComposerHistory();

		for (let i = 0; i < 120; i++) {
			history.execute(new AddNodeCommand(makeNode(`n${i}`)), model);
		}

		// Undo 100 times — should not throw and should stop at 0
		let count = 0;
		while (history.canUndo && count < 110) {
			history.undo(model);
			count++;
		}
		assert.ok(count <= 100, `Should not undo more than 100 times, got ${count}`);

		model.dispose();
		history.dispose();
	});
});
