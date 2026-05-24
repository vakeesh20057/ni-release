/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { ComposerModel } from '../model/composerModel.js';
import { EdgeValidator } from '../edges/edgeValidator.js';

export interface ILayoutOptions {
	layerSpacingX: number;
	layerSpacingY: number;
	nodeSpacingX: number;
	nodeSpacingY: number;
	direction: 'horizontal' | 'vertical';
	preserveManualPositions: boolean;
	padding: number;
}

const DEFAULT_LAYOUT: ILayoutOptions = {
	layerSpacingX: 280,
	layerSpacingY: 120,
	nodeSpacingX: 100,
	nodeSpacingY: 40,
	direction: 'horizontal',
	preserveManualPositions: true,
	padding: 60
};

export class CanvasLayout {

	private readonly _edgeValidator = new EdgeValidator();

	autoLayout(model: ComposerModel, options?: Partial<ILayoutOptions>): void {
		const opts = { ...DEFAULT_LAYOUT, ...options };
		const order = this._edgeValidator.getTopologicalOrder(model);
		if (!order) { return; }

		const layers = this._assignLayers(model, order);
		this._minimizeCrossings(model, layers);
		this._assignPositions(model, layers, opts);
	}

	layoutSubgraph(model: ComposerModel, nodeIds: Set<string>, anchor: { x: number; y: number }): void {
		const subOrder: string[] = [];
		const order = this._edgeValidator.getTopologicalOrder(model);
		if (!order) { return; }

		for (const id of order) {
			if (nodeIds.has(id)) { subOrder.push(id); }
		}

		const layers = this._assignLayers(model, subOrder);
		const opts = { ...DEFAULT_LAYOUT, padding: 0 };

		let layerX = anchor.x;
		for (const layer of layers) {
			let nodeY = anchor.y;
			for (const nodeId of layer) {
				const node = model.getNode(nodeId);
				if (!node) { continue; }
				if (node.manuallyPositioned && opts.preserveManualPositions) { continue; }
				model.updateNode(nodeId, { position: { x: layerX, y: nodeY } });
				nodeY += node.size.height + opts.nodeSpacingY;
			}
			layerX += opts.layerSpacingX;
		}
	}

	private _assignLayers(model: ComposerModel, order: string[]): string[][] {
		const depth = new Map<string, number>();

		for (const nodeId of order) {
			const incoming = model.getIncomingEdges(nodeId);
			let maxParentDepth = -1;
			for (const edge of incoming) {
				const parentDepth = depth.get(edge.sourceNodeId);
				if (parentDepth !== undefined && parentDepth > maxParentDepth) {
					maxParentDepth = parentDepth;
				}
			}
			depth.set(nodeId, maxParentDepth + 1);
		}

		const maxDepth = Math.max(0, ...depth.values());
		const layers: string[][] = [];
		for (let i = 0; i <= maxDepth; i++) { layers.push([]); }

		for (const [nodeId, d] of depth) {
			layers[d].push(nodeId);
		}
		return layers;
	}

	private _minimizeCrossings(model: ComposerModel, layers: string[][]): void {
		for (let sweep = 0; sweep < 4; sweep++) {
			const forward = sweep % 2 === 0;
			const start = forward ? 1 : layers.length - 2;
			const end = forward ? layers.length : -1;
			const step = forward ? 1 : -1;

			for (let i = start; i !== end; i += step) {
				const layer = layers[i];
				const refLayer = layers[i - step];
				this._orderByBarycenter(model, layer, refLayer, forward);
			}
		}
	}

	private _orderByBarycenter(model: ComposerModel, layer: string[], refLayer: string[], useIncoming: boolean): void {
		const refPositions = new Map<string, number>();
		for (let i = 0; i < refLayer.length; i++) {
			refPositions.set(refLayer[i], i);
		}

		const barycenters = new Map<string, number>();
		for (const nodeId of layer) {
			const edges = useIncoming ? model.getIncomingEdges(nodeId) : model.getOutgoingEdges(nodeId);
			const refIds = edges.map(e => useIncoming ? e.sourceNodeId : e.targetNodeId);

			let sum = 0;
			let count = 0;
			for (const refId of refIds) {
				const pos = refPositions.get(refId);
				if (pos !== undefined) {
					sum += pos;
					count++;
				}
			}
			barycenters.set(nodeId, count > 0 ? sum / count : Infinity);
		}

		layer.sort((a, b) => {
			const ba = barycenters.get(a) ?? Infinity;
			const bb = barycenters.get(b) ?? Infinity;
			return ba - bb;
		});
	}

	private _assignPositions(model: ComposerModel, layers: string[][], opts: ILayoutOptions): void {
		if (opts.direction === 'horizontal') {
			this._assignHorizontal(model, layers, opts);
		} else {
			this._assignVertical(model, layers, opts);
		}
	}

	private _assignHorizontal(model: ComposerModel, layers: string[][], opts: ILayoutOptions): void {
		let layerX = opts.padding;

		for (const layer of layers) {
			const totalHeight = this._layerSize(model, layer, 'height', opts.nodeSpacingY);
			let nodeY = opts.padding + Math.max(0, (600 - totalHeight) / 2);
			let maxWidth = 0;

			for (const nodeId of layer) {
				const node = model.getNode(nodeId);
				if (!node) { continue; }
				if (node.manuallyPositioned && opts.preserveManualPositions) {
					maxWidth = Math.max(maxWidth, node.size.width);
					continue;
				}

				model.updateNode(nodeId, { position: { x: layerX, y: nodeY } });
				nodeY += node.size.height + opts.nodeSpacingY;
				maxWidth = Math.max(maxWidth, node.size.width);
			}

			layerX += maxWidth + opts.layerSpacingX;
		}
	}

	private _assignVertical(model: ComposerModel, layers: string[][], opts: ILayoutOptions): void {
		let layerY = opts.padding;

		for (const layer of layers) {
			const totalWidth = this._layerSize(model, layer, 'width', opts.nodeSpacingX);
			let nodeX = opts.padding + Math.max(0, (1000 - totalWidth) / 2);
			let maxHeight = 0;

			for (const nodeId of layer) {
				const node = model.getNode(nodeId);
				if (!node) { continue; }
				if (node.manuallyPositioned && opts.preserveManualPositions) {
					maxHeight = Math.max(maxHeight, node.size.height);
					continue;
				}

				model.updateNode(nodeId, { position: { x: nodeX, y: layerY } });
				nodeX += node.size.width + opts.nodeSpacingX;
				maxHeight = Math.max(maxHeight, node.size.height);
			}

			layerY += maxHeight + opts.layerSpacingY;
		}
	}

	private _layerSize(model: ComposerModel, layer: string[], dim: 'width' | 'height', spacing: number): number {
		let total = 0;
		for (const nodeId of layer) {
			const node = model.getNode(nodeId);
			if (!node) { continue; }
			total += node.size[dim] + spacing;
		}
		return total > 0 ? total - spacing : 0;
	}
}
