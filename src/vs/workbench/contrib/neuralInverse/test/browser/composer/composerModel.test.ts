/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ComposerModel, IComposerNode, IComposerEdge, NodeType } from '../../../browser/composer/model/composerModel.js';

function makeNode(id: string, type: NodeType = 'agent', x = 0, y = 0): IComposerNode {
	return {
		id,
		type,
		label: id,
		position: { x, y },
		size: { width: 180, height: 80 },
		config: {},
		ports: [],
		enabled: true,
	};
}

function makeEdge(id: string, src: string, srcPort: string, tgt: string, tgtPort: string): IComposerEdge {
	return { id, sourceNodeId: src, sourcePortId: srcPort, targetNodeId: tgt, targetPortId: tgtPort };
}

suite('ComposerModel — node operations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('addNode stores node and fires change event', () => {
		const model = new ComposerModel();
		let fired = false;
		model.onDidChange(() => { fired = true; });

		model.addNode(makeNode('n1'));
		assert.ok(model.nodes.has('n1'));
		assert.ok(fired);
		model.dispose();
	});

	test('removeNode deletes node and its edges', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		model.addEdge(makeEdge('e1', 'n1', 'out', 'n2', 'in'));

		model.removeNode('n1');
		assert.ok(!model.nodes.has('n1'));
		assert.ok(!model.edges.has('e1'), 'edge referencing removed node should be deleted');
		model.dispose();
	});

	test('moveNode updates position', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1', 'agent', 0, 0));
		model.moveNode('n1', { x: 100, y: 200 });

		const node = model.getNode('n1')!;
		assert.strictEqual(node.position.x, 100);
		assert.strictEqual(node.position.y, 200);
		model.dispose();
	});

	test('getNode returns undefined for unknown id', () => {
		const model = new ComposerModel();
		assert.strictEqual(model.getNode('nonexistent'), undefined);
		model.dispose();
	});

	test('updateNodeConfig merges config without replacing other fields', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.updateNodeConfig('n1', { agentId: 'code-reviewer', maxIterations: 10 });

		const node = model.getNode('n1')!;
		assert.strictEqual(node.config['agentId'], 'code-reviewer');
		assert.strictEqual(node.config['maxIterations'], 10);
		assert.strictEqual(node.label, 'n1', 'label should be unchanged');
		model.dispose();
	});
});

suite('ComposerModel — edge operations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('addEdge stores edge', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		model.addEdge(makeEdge('e1', 'n1', 'out', 'n2', 'in'));

		assert.ok(model.edges.has('e1'));
		model.dispose();
	});

	test('removeEdge deletes edge', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		model.addEdge(makeEdge('e1', 'n1', 'out', 'n2', 'in'));
		model.removeEdge('e1');

		assert.ok(!model.edges.has('e1'));
		model.dispose();
	});

	test('getEdgesForNode returns all connected edges', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		model.addNode(makeNode('n3'));
		model.addEdge(makeEdge('e1', 'n1', 'out', 'n2', 'in'));
		model.addEdge(makeEdge('e2', 'n1', 'out', 'n3', 'in'));

		const edges = model.getEdgesForNode('n1');
		assert.strictEqual(edges.length, 2);
		model.dispose();
	});
});

suite('ComposerModel — selection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('select sets selection and fires event', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		let fired = false;
		model.onDidChange(() => { fired = true; });

		model.select(['n1', 'n2']);
		assert.ok(model.selection.has('n1'));
		assert.ok(model.selection.has('n2'));
		assert.ok(fired);
		model.dispose();
	});

	test('clearSelection empties selection', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.select(['n1']);
		model.clearSelection();
		assert.strictEqual(model.selection.size, 0);
		model.dispose();
	});
});

suite('ComposerModel — clear and snapshot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('clear removes all nodes and edges', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		model.addNode(makeNode('n2'));
		model.addEdge(makeEdge('e1', 'n1', 'out', 'n2', 'in'));
		model.clear();

		assert.strictEqual(model.nodes.size, 0);
		assert.strictEqual(model.edges.size, 0);
		model.dispose();
	});

	test('getSnapshot returns immutable copy', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1'));
		const snap = model.getSnapshot();

		assert.ok(snap.nodes.has('n1'));
		// Modifying model should not affect snapshot
		model.addNode(makeNode('n2'));
		assert.ok(!snap.nodes.has('n2'));
		model.dispose();
	});

	test('getBounds returns correct bounding box', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('n1', 'agent', 100, 50));
		model.addNode(makeNode('n2', 'agent', 400, 300));

		const bounds = model.getBounds();
		assert.ok(bounds !== null);
		assert.ok(bounds!.minX <= 100);
		assert.ok(bounds!.minY <= 50);
		assert.ok(bounds!.maxX >= 400);
		assert.ok(bounds!.maxY >= 300);
		model.dispose();
	});

	test('getBounds returns null for empty model', () => {
		const model = new ComposerModel();
		assert.strictEqual(model.getBounds(), null);
		model.dispose();
	});
});
