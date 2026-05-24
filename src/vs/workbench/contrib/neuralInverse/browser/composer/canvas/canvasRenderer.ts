/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ComposerModel, IComposerNode, IComposerEdge, IModelChangeEvent } from '../model/composerModel.js';
import { WorkflowCanvas } from './workflowCanvas.js';
import { NodeRegistry } from '../nodes/nodeRegistry.js';

interface IRenderedNode {
	group: SVGGElement;
	body: SVGRectElement | SVGPolygonElement;
	label: SVGTextElement;
	ports: Map<string, SVGCircleElement>;
	badge?: SVGGElement;
}

interface IRenderedEdge {
	path: SVGPathElement;
	hitArea: SVGPathElement;
}

const PORT_RADIUS = 6;
const PORT_HIT_RADIUS = 12;
const SELECTION_STROKE = '#6ba3e8';
const SELECTION_WIDTH = 2;
const DISABLED_OPACITY = 0.4;

export class CanvasRenderer extends Disposable {

	private readonly _renderedNodes = new Map<string, IRenderedNode>();
	private readonly _renderedEdges = new Map<string, IRenderedEdge>();
	private _rafId: number | null = null;
	private _dirty = false;

	constructor(
		private readonly _canvas: WorkflowCanvas,
		private readonly _model: ComposerModel,
		private readonly _nodeRegistry: NodeRegistry
	) {
		super();
		this._register(_model.onDidChange(e => this._onModelChange(e)));
	}

	render(): void {
		this._renderAllNodes();
		this._renderAllEdges();
	}

	getPortScreenPosition(nodeId: string, portId: string): { x: number; y: number } | null {
		const rendered = this._renderedNodes.get(nodeId);
		if (!rendered) { return null; }
		const portEl = rendered.ports.get(portId);
		if (!portEl) { return null; }

		const node = this._model.getNode(nodeId);
		if (!node) { return null; }

		const cx = parseFloat(portEl.getAttribute('cx') || '0');
		const cy = parseFloat(portEl.getAttribute('cy') || '0');
		return { x: node.position.x + cx, y: node.position.y + cy };
	}

	getNodeAtPoint(canvasX: number, canvasY: number): string | null {
		for (const [nodeId, node] of this._model.nodes) {
			const { x, y } = node.position;
			const { width, height } = node.size;
			if (canvasX >= x && canvasX <= x + width && canvasY >= y && canvasY <= y + height) {
				return nodeId;
			}
		}
		return null;
	}

	getPortAtPoint(canvasX: number, canvasY: number): { nodeId: string; portId: string } | null {
		for (const [nodeId, node] of this._model.nodes) {
			for (const port of node.ports) {
				const pos = this._getPortPosition(node, port.id);
				const dx = canvasX - (node.position.x + pos.x);
				const dy = canvasY - (node.position.y + pos.y);
				if (dx * dx + dy * dy <= PORT_HIT_RADIUS * PORT_HIT_RADIUS) {
					return { nodeId, portId: port.id };
				}
			}
		}
		return null;
	}

	getEdgeAtPoint(canvasX: number, canvasY: number): string | null {
		for (const [edgeId, rendered] of this._renderedEdges) {
			const hitArea = rendered.hitArea;
			if (!hitArea) { continue; }
			const point = this._canvas.svgRoot!.createSVGPoint();
			point.x = canvasX;
			point.y = canvasY;
			if (hitArea.isPointInStroke(point)) {
				return edgeId;
			}
		}
		return null;
	}

	highlightEdge(edgeId: string, highlight: boolean): void {
		const rendered = this._renderedEdges.get(edgeId);
		if (!rendered) { return; }
		rendered.path.setAttribute('stroke', highlight ? SELECTION_STROKE : '#666');
		rendered.path.setAttribute('stroke-width', highlight ? '3' : '2');
		rendered.path.setAttribute('marker-end', highlight ? 'url(#edge-arrow-selected)' : 'url(#edge-arrow)');
	}

	setEdgeAnimating(edgeId: string, animating: boolean): void {
		const rendered = this._renderedEdges.get(edgeId);
		if (!rendered) { return; }
		if (animating) {
			rendered.path.setAttribute('stroke-dasharray', '8 4');
			rendered.path.style.animation = 'edge-flow 0.5s linear infinite';
		} else {
			rendered.path.removeAttribute('stroke-dasharray');
			rendered.path.style.animation = '';
		}
	}

	setNodeStatus(nodeId: string, status: 'idle' | 'running' | 'done' | 'failed' | 'skipped'): void {
		const rendered = this._renderedNodes.get(nodeId);
		if (!rendered) { return; }

		if (rendered.badge) {
			rendered.group.removeChild(rendered.badge);
			rendered.badge = undefined;
		}

		if (status === 'idle') { return; }

		const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		const node = this._model.getNode(nodeId);
		if (!node) { return; }

		const bx = node.size.width - 12;
		const by = -8;

		const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		circle.setAttribute('cx', String(bx));
		circle.setAttribute('cy', String(by));
		circle.setAttribute('r', '8');

		const colors: Record<string, string> = {
			running: '#e0a84e',
			done: '#4ec96e',
			failed: '#e85c5c',
			skipped: '#888'
		};
		circle.setAttribute('fill', colors[status] || '#888');
		badge.appendChild(circle);

		const icons: Record<string, string> = {
			running: '▶',
			done: '✓',
			failed: '✗',
			skipped: '—'
		};
		const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		text.setAttribute('x', String(bx));
		text.setAttribute('y', String(by + 4));
		text.setAttribute('text-anchor', 'middle');
		text.setAttribute('font-size', '10');
		text.setAttribute('fill', '#fff');
		text.textContent = icons[status] || '';
		badge.appendChild(text);

		rendered.badge = badge;
		rendered.group.appendChild(badge);
	}

	clearAll(): void {
		for (const [, rendered] of this._renderedNodes) {
			rendered.group.parentNode?.removeChild(rendered.group);
		}
		for (const [, rendered] of this._renderedEdges) {
			rendered.path.parentNode?.removeChild(rendered.path);
			rendered.hitArea.parentNode?.removeChild(rendered.hitArea);
		}
		this._renderedNodes.clear();
		this._renderedEdges.clear();
	}

	private _onModelChange(event: IModelChangeEvent): void {
		if (event.kind === 'viewport') { return; }
		this._scheduleDirtyRender();
	}

	private _scheduleDirtyRender(): void {
		if (this._dirty) { return; }
		this._dirty = true;
		this._rafId = requestAnimationFrame(() => {
			this._dirty = false;
			this._rafId = null;
			this._syncRender();
		});
	}

	private _syncRender(): void {
		this._syncNodes();
		this._syncEdges();
	}

	private _syncNodes(): void {
		const currentIds = new Set(this._model.nodes.keys());

		for (const id of this._renderedNodes.keys()) {
			if (!currentIds.has(id)) {
				const rendered = this._renderedNodes.get(id)!;
				rendered.group.parentNode?.removeChild(rendered.group);
				this._renderedNodes.delete(id);
			}
		}

		for (const [id, node] of this._model.nodes) {
			if (!this._canvas.isNodeVisible(node.position.x, node.position.y, node.size.width, node.size.height)) {
				const existing = this._renderedNodes.get(id);
				if (existing) {
					existing.group.style.display = 'none';
				}
				continue;
			}

			if (this._renderedNodes.has(id)) {
				this._updateNodeElement(id, node);
			} else {
				this._createNodeElement(node);
			}
		}
	}

	private _syncEdges(): void {
		const currentIds = new Set(this._model.edges.keys());

		for (const id of this._renderedEdges.keys()) {
			if (!currentIds.has(id)) {
				const rendered = this._renderedEdges.get(id)!;
				rendered.path.parentNode?.removeChild(rendered.path);
				rendered.hitArea.parentNode?.removeChild(rendered.hitArea);
				this._renderedEdges.delete(id);
			}
		}

		for (const [id, edge] of this._model.edges) {
			if (this._renderedEdges.has(id)) {
				this._updateEdgePath(id, edge);
			} else {
				this._createEdgeElement(edge);
			}
		}
	}

	private _createNodeElement(node: IComposerNode): void {
		const nodeLayer = this._canvas.nodeLayer;
		if (!nodeLayer) { return; }

		const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		group.setAttribute('data-node-id', node.id);
		group.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);
		group.style.opacity = node.enabled ? '1' : String(DISABLED_OPACITY);

		const def = this._nodeRegistry.getDefinition(node.type);
		const color = def?.color || '#666';
		const isSelected = this._model.selection.has(node.id);

		let body: SVGRectElement | SVGPolygonElement;
		if (node.type === 'conditional') {
			body = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
			const w = node.size.width;
			const h = node.size.height;
			body.setAttribute('points', `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`);
			body.setAttribute('fill', '#252525');
			body.setAttribute('stroke', isSelected ? SELECTION_STROKE : color);
			body.setAttribute('stroke-width', isSelected ? String(SELECTION_WIDTH) : '1.5');
		} else if (node.type === 'trigger') {
			body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			body.setAttribute('x', '0');
			body.setAttribute('y', '0');
			body.setAttribute('width', String(node.size.width));
			body.setAttribute('height', String(node.size.height));
			body.setAttribute('rx', '8');
			body.setAttribute('fill', '#252525');
			body.setAttribute('stroke', isSelected ? SELECTION_STROKE : color);
			body.setAttribute('stroke-width', isSelected ? String(SELECTION_WIDTH) : '1.5');
			body.setAttribute('stroke-dasharray', '6 3');
		} else {
			body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			body.setAttribute('x', '0');
			body.setAttribute('y', '0');
			body.setAttribute('width', String(node.size.width));
			body.setAttribute('height', String(node.size.height));
			body.setAttribute('rx', '6');
			body.setAttribute('fill', '#252525');
			body.setAttribute('stroke', isSelected ? SELECTION_STROKE : color);
			body.setAttribute('stroke-width', isSelected ? String(SELECTION_WIDTH) : '1.5');
		}
		group.appendChild(body);

		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		label.setAttribute('x', String(node.size.width / 2));
		label.setAttribute('y', String(node.size.height / 2 + 5));
		label.setAttribute('text-anchor', 'middle');
		label.setAttribute('font-size', '12');
		label.setAttribute('fill', '#ddd');
		label.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
		label.textContent = node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label;
		group.appendChild(label);

		const ports = new Map<string, SVGCircleElement>();
		for (const port of node.ports) {
			const pos = this._getPortPosition(node, port.id);
			const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			circle.setAttribute('cx', String(pos.x));
			circle.setAttribute('cy', String(pos.y));
			circle.setAttribute('r', String(PORT_RADIUS));
			circle.setAttribute('fill', this._getPortColor(port.dataType));
			circle.setAttribute('stroke', '#1a1a1a');
			circle.setAttribute('stroke-width', '2');
			circle.setAttribute('data-port-id', port.id);
			circle.setAttribute('data-port-side', port.side);
			circle.style.cursor = 'crosshair';
			group.appendChild(circle);
			ports.set(port.id, circle);
		}

		nodeLayer.appendChild(group);
		this._renderedNodes.set(node.id, { group, body, label, ports });
	}

	private _updateNodeElement(id: string, node: IComposerNode): void {
		const rendered = this._renderedNodes.get(id);
		if (!rendered) { return; }

		rendered.group.style.display = '';
		rendered.group.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);
		rendered.group.style.opacity = node.enabled ? '1' : String(DISABLED_OPACITY);

		const def = this._nodeRegistry.getDefinition(node.type);
		const color = def?.color || '#666';
		const isSelected = this._model.selection.has(id);

		rendered.body.setAttribute('stroke', isSelected ? SELECTION_STROKE : color);
		rendered.body.setAttribute('stroke-width', isSelected ? String(SELECTION_WIDTH) : '1.5');
		rendered.label.textContent = node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label;
	}

	private _createEdgeElement(edge: IComposerEdge): void {
		const edgeLayer = this._canvas.edgeLayer;
		if (!edgeLayer) { return; }

		const pathData = this._computeEdgePath(edge);

		const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		hitArea.setAttribute('d', pathData);
		hitArea.setAttribute('stroke', 'transparent');
		hitArea.setAttribute('stroke-width', '16');
		hitArea.setAttribute('fill', 'none');
		hitArea.setAttribute('data-edge-id', edge.id);
		hitArea.style.cursor = 'pointer';
		edgeLayer.appendChild(hitArea);

		const isSelected = this._model.selection.has(edge.id);
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', pathData);
		path.setAttribute('stroke', isSelected ? SELECTION_STROKE : '#666');
		path.setAttribute('stroke-width', isSelected ? '3' : '2');
		path.setAttribute('fill', 'none');
		path.setAttribute('marker-end', isSelected ? 'url(#edge-arrow-selected)' : 'url(#edge-arrow)');
		path.setAttribute('data-edge-id', edge.id);
		path.style.pointerEvents = 'none';
		edgeLayer.appendChild(path);

		this._renderedEdges.set(edge.id, { path, hitArea });
	}

	private _updateEdgePath(id: string, edge: IComposerEdge): void {
		const rendered = this._renderedEdges.get(id);
		if (!rendered) { return; }

		const pathData = this._computeEdgePath(edge);
		rendered.path.setAttribute('d', pathData);
		rendered.hitArea.setAttribute('d', pathData);

		const isSelected = this._model.selection.has(id);
		rendered.path.setAttribute('stroke', isSelected ? SELECTION_STROKE : '#666');
		rendered.path.setAttribute('stroke-width', isSelected ? '3' : '2');
		rendered.path.setAttribute('marker-end', isSelected ? 'url(#edge-arrow-selected)' : 'url(#edge-arrow)');
	}

	private _computeEdgePath(edge: IComposerEdge): string {
		const sourceNode = this._model.getNode(edge.sourceNodeId);
		const targetNode = this._model.getNode(edge.targetNodeId);
		if (!sourceNode || !targetNode) { return 'M 0 0'; }

		const sourcePortPos = this._getPortPosition(sourceNode, edge.sourcePortId);
		const targetPortPos = this._getPortPosition(targetNode, edge.targetPortId);

		const sx = sourceNode.position.x + sourcePortPos.x;
		const sy = sourceNode.position.y + sourcePortPos.y;
		const tx = targetNode.position.x + targetPortPos.x;
		const ty = targetNode.position.y + targetPortPos.y;

		const dx = Math.abs(tx - sx);
		const offset = Math.max(50, dx * 0.4);

		return `M ${sx} ${sy} C ${sx + offset} ${sy}, ${tx - offset} ${ty}, ${tx} ${ty}`;
	}

	private _getPortPosition(node: IComposerNode, portId: string): { x: number; y: number } {
		const port = node.ports.find(p => p.id === portId);
		if (!port) { return { x: 0, y: 0 }; }

		const inputPorts = node.ports.filter(p => p.side === 'input');
		const outputPorts = node.ports.filter(p => p.side === 'output');

		if (port.side === 'input') {
			const idx = inputPorts.indexOf(port);
			const spacing = node.size.height / (inputPorts.length + 1);
			return { x: 0, y: spacing * (idx + 1) };
		} else {
			const idx = outputPorts.indexOf(port);
			const spacing = node.size.height / (outputPorts.length + 1);
			return { x: node.size.width, y: spacing * (idx + 1) };
		}
	}

	private _getPortColor(dataType: string): string {
		switch (dataType) {
			case 'flow': return '#e0a84e';
			case 'text': return '#6ba3e8';
			case 'json': return '#85c9a8';
			case 'any': return '#aaa';
			default: return '#666';
		}
	}

	private _renderAllNodes(): void {
		for (const node of this._model.nodes.values()) {
			if (!this._renderedNodes.has(node.id)) {
				this._createNodeElement(node);
			}
		}
	}

	private _renderAllEdges(): void {
		for (const edge of this._model.edges.values()) {
			if (!this._renderedEdges.has(edge.id)) {
				this._createEdgeElement(edge);
			}
		}
	}

	override dispose(): void {
		if (this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
		}
		this.clearAll();
		super.dispose();
	}
}
