/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ComposerModel, IComposerNode, NodeType } from '../../../browser/composer/model/composerModel.js';
import { CanvasLayout } from '../../../browser/composer/canvas/canvasLayout.js';

function makeNode(id: string, type: NodeType = 'agent'): IComposerNode {
	return {
		id,
		type,
		label: id,
		position: { x: 0, y: 0 },
		size: { width: 180, height: 80 },
		config: {},
		ports: type === 'trigger'
			? [{ id: 'trigger-out', label: 'Fires', dataType: 'flow', side: 'output' }]
			: [{ id: 'agent-in', label: 'Input', dataType: 'flow', side: 'input' }, { id: 'agent-out', label: 'Output', dataType: 'text', side: 'output' }],
		enabled: true,
	};
}

suite('CanvasLayout — autoLayout', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('linear graph: source node has smaller x than sink node', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('t1', 'trigger'));
		model.addNode(makeNode('a1'));
		model.addNode(makeNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const layout = new CanvasLayout();
		layout.autoLayout(model, { preserveManualPositions: false });

		const t1x = model.getNode('t1')!.position.x;
		const a1x = model.getNode('a1')!.position.x;
		const a2x = model.getNode('a2')!.position.x;

		assert.ok(t1x < a1x, `trigger (${t1x}) should be left of a1 (${a1x})`);
		assert.ok(a1x < a2x, `a1 (${a1x}) should be left of a2 (${a2x})`);
		model.dispose();
	});

	test('nodes have non-zero positive positions after layout', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('a1'));
		model.addNode(makeNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const layout = new CanvasLayout();
		layout.autoLayout(model, { preserveManualPositions: false });

		for (const node of model.nodes.values()) {
			assert.ok(node.position.x >= 0, `${node.id}.x should be >= 0`);
			assert.ok(node.position.y >= 0, `${node.id}.y should be >= 0`);
		}
		model.dispose();
	});

	test('parallel nodes (same layer) have different y positions', () => {
		const model = new ComposerModel();
		// t1 → a1 and t1 → a2 (both a1 and a2 at same depth)
		model.addNode(makeNode('t1', 'trigger'));
		model.addNode(makeNode('a1'));
		model.addNode(makeNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a1', targetPortId: 'agent-in' });
		model.addEdge({ id: 'e2', sourceNodeId: 't1', sourcePortId: 'trigger-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const layout = new CanvasLayout();
		layout.autoLayout(model, { preserveManualPositions: false });

		const a1y = model.getNode('a1')!.position.y;
		const a2y = model.getNode('a2')!.position.y;

		assert.ok(a1y !== a2y, `parallel nodes should have different y positions (got ${a1y} and ${a2y})`);
		model.dispose();
	});

	test('preserveManualPositions=true keeps already-moved nodes in place', () => {
		const model = new ComposerModel();
		const n1 = makeNode('a1');
		n1.position = { x: 999, y: 888 };
		(n1 as any).manuallyPositioned = true; // flag set by interaction on drag
		model.addNode(n1);
		model.addNode(makeNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const layout = new CanvasLayout();
		layout.autoLayout(model, { preserveManualPositions: true });

		// a1 had manuallyPositioned=true so position should be preserved
		const a1 = model.getNode('a1')!;
		assert.strictEqual(a1.position.x, 999);
		assert.strictEqual(a1.position.y, 888);
		model.dispose();
	});

	test('single node is positioned without throwing', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('a1'));

		const layout = new CanvasLayout();
		assert.doesNotThrow(() => layout.autoLayout(model, { preserveManualPositions: false }));
		model.dispose();
	});

	test('empty model does not throw', () => {
		const model = new ComposerModel();
		const layout = new CanvasLayout();
		assert.doesNotThrow(() => layout.autoLayout(model, { preserveManualPositions: false }));
		model.dispose();
	});

	test('layer spacing is at least 200px between consecutive layers', () => {
		const model = new ComposerModel();
		model.addNode(makeNode('a1'));
		model.addNode(makeNode('a2'));
		model.addEdge({ id: 'e1', sourceNodeId: 'a1', sourcePortId: 'agent-out', targetNodeId: 'a2', targetPortId: 'agent-in' });

		const layout = new CanvasLayout();
		layout.autoLayout(model, { preserveManualPositions: false });

		const a1x = model.getNode('a1')!.position.x;
		const a2x = model.getNode('a2')!.position.x;
		assert.ok(a2x - a1x >= 200, `layer spacing should be ≥200px, got ${a2x - a1x}`);
		model.dispose();
	});
});
