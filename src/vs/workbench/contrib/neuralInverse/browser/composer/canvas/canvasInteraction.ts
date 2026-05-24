/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ComposerModel, IComposerEdge } from '../model/composerModel.js';
import { ComposerHistory, AddNodeCommand, RemoveNodeCommand, MoveNodeCommand, AddEdgeCommand, RemoveEdgeCommand } from '../model/composerHistory.js';
import { WorkflowCanvas } from './workflowCanvas.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { EdgeValidator } from '../edges/edgeValidator.js';
import { NodeRegistry } from '../nodes/nodeRegistry.js';

type InteractionState =
	| { kind: 'idle' }
	| { kind: 'panning'; startX: number; startY: number; startVpX: number; startVpY: number }
	| { kind: 'dragging-node'; nodeId: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean }
	| { kind: 'dragging-edge'; sourceNodeId: string; sourcePortId: string; currentX: number; currentY: number }
	| { kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number };

export interface IContextMenuRequest {
	readonly screenX: number;
	readonly screenY: number;
	readonly canvasX: number;
	readonly canvasY: number;
	readonly nodeId?: string;
	readonly edgeId?: string;
}

export interface IDropRequest {
	readonly canvasX: number;
	readonly canvasY: number;
	readonly data: string;
}

export class CanvasInteraction extends Disposable {

	private _state: InteractionState = { kind: 'idle' };
	private _spaceHeld = false;
	private _dragEdgeLine: SVGLineElement | null = null;
	private _marqueeRect: SVGRectElement | null = null;
	private readonly _listeners: IDisposable[] = [];
	private readonly _edgeValidator = new EdgeValidator();

	private readonly _onContextMenu = this._register(new Emitter<IContextMenuRequest>());
	readonly onContextMenu: Event<IContextMenuRequest> = this._onContextMenu.event;

	private readonly _onDrop = this._register(new Emitter<IDropRequest>());
	readonly onDrop: Event<IDropRequest> = this._onDrop.event;

	private readonly _onNodeDoubleClick = this._register(new Emitter<string>());
	readonly onNodeDoubleClick: Event<string> = this._onNodeDoubleClick.event;

	constructor(
		private readonly _canvas: WorkflowCanvas,
		private readonly _model: ComposerModel,
		private readonly _history: ComposerHistory,
		private readonly _renderer: CanvasRenderer,
		private readonly _nodeRegistry: NodeRegistry
	) {
		super();
	}

	attach(): void {
		const svg = this._canvas.svgRoot;
		if (!svg) { return; }

		const container = svg.parentElement;
		if (!container) { return; }

		this._listeners.push(this._addListener(svg, 'pointerdown', this._onPointerDown.bind(this)));
		this._listeners.push(this._addListener(window, 'pointermove', this._onPointerMove.bind(this)));
		this._listeners.push(this._addListener(window, 'pointerup', this._onPointerUp.bind(this)));
		this._listeners.push(this._addListener(svg, 'wheel', this._onWheel.bind(this), { passive: false }));
		this._listeners.push(this._addListener(svg, 'dblclick', this._onDoubleClick.bind(this)));
		this._listeners.push(this._addListener(svg, 'contextmenu', this._onContextMenuEvent.bind(this)));
		this._listeners.push(this._addListener(window, 'keydown', this._onKeyDown.bind(this)));
		this._listeners.push(this._addListener(window, 'keyup', this._onKeyUp.bind(this)));
		this._listeners.push(this._addListener(container, 'dragover', this._onDragOver.bind(this)));
		this._listeners.push(this._addListener(container, 'drop', this._onDropEvent.bind(this)));
	}

	detach(): void {
		for (const l of this._listeners) { l.dispose(); }
		this._listeners.length = 0;
	}

	private _onPointerDown(e: PointerEvent): void {
		this._canvas.updateContainerRect();

		if (e.button === 1 || (e.button === 0 && this._spaceHeld)) {
			this._state = {
				kind: 'panning',
				startX: e.clientX,
				startY: e.clientY,
				startVpX: this._canvas.viewport.x,
				startVpY: this._canvas.viewport.y
			};
			e.preventDefault();
			return;
		}

		if (e.button !== 0) { return; }

		const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
		const portHit = this._renderer.getPortAtPoint(canvasPos.x, canvasPos.y);
		if (portHit) {
			const node = this._model.getNode(portHit.nodeId);
			const port = node?.ports.find(p => p.id === portHit.portId);
			if (port?.side === 'output') {
				this._state = {
					kind: 'dragging-edge',
					sourceNodeId: portHit.nodeId,
					sourcePortId: portHit.portId,
					currentX: canvasPos.x,
					currentY: canvasPos.y
				};
				this._createDragEdgeLine(canvasPos.x, canvasPos.y);
				e.preventDefault();
				return;
			}
		}

		const nodeHit = this._renderer.getNodeAtPoint(canvasPos.x, canvasPos.y);
		if (nodeHit) {
			const node = this._model.getNode(nodeHit)!;
			if (!e.shiftKey && !this._model.selection.has(nodeHit)) {
				this._model.select([nodeHit]);
			} else if (e.shiftKey) {
				if (this._model.selection.has(nodeHit)) {
					this._model.removeFromSelection([nodeHit]);
				} else {
					this._model.addToSelection([nodeHit]);
				}
			}

			this._state = {
				kind: 'dragging-node',
				nodeId: nodeHit,
				offsetX: canvasPos.x - node.position.x,
				offsetY: canvasPos.y - node.position.y,
				startX: node.position.x,
				startY: node.position.y,
				moved: false
			};
			e.preventDefault();
			return;
		}

		const edgeHit = this._renderer.getEdgeAtPoint(canvasPos.x, canvasPos.y);
		if (edgeHit) {
			if (e.shiftKey) {
				this._model.addToSelection([edgeHit]);
			} else {
				this._model.select([edgeHit]);
			}
			e.preventDefault();
			return;
		}

		if (e.shiftKey) {
			this._state = {
				kind: 'marquee',
				startX: canvasPos.x,
				startY: canvasPos.y,
				currentX: canvasPos.x,
				currentY: canvasPos.y
			};
			this._createMarqueeRect();
			e.preventDefault();
			return;
		}

		this._model.clearSelection();
	}

	private _onPointerMove(e: PointerEvent): void {
		switch (this._state.kind) {
			case 'panning': {
				const dx = e.clientX - this._state.startX;
				const dy = e.clientY - this._state.startY;
				this._canvas.setViewport({
					x: this._state.startVpX + dx,
					y: this._state.startVpY + dy,
					zoom: this._canvas.viewport.zoom
				});
				break;
			}
			case 'dragging-node': {
				const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
				const newX = this._canvas.snapToGrid(canvasPos.x - this._state.offsetX);
				const newY = this._canvas.snapToGrid(canvasPos.y - this._state.offsetY);

				const node = this._model.getNode(this._state.nodeId);
				if (node && (node.position.x !== newX || node.position.y !== newY)) {
					this._state.moved = true;
					this._model.moveNode(this._state.nodeId, newX, newY);

					const selectedNodes = this._model.getSelectedNodes();
					if (selectedNodes.length > 1) {
						const dx = newX - node.position.x;
						const dy = newY - node.position.y;
						for (const sel of selectedNodes) {
							if (sel.id !== this._state.nodeId) {
								this._model.moveNode(sel.id, sel.position.x + dx, sel.position.y + dy);
							}
						}
					}
				}
				break;
			}
			case 'dragging-edge': {
				const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
				this._state.currentX = canvasPos.x;
				this._state.currentY = canvasPos.y;
				this._updateDragEdgeLine(canvasPos.x, canvasPos.y);

				const portHit = this._renderer.getPortAtPoint(canvasPos.x, canvasPos.y);
				if (portHit && portHit.nodeId !== this._state.sourceNodeId) {
					const result = this._edgeValidator.canConnect(
						this._model, this._state.sourceNodeId, this._state.sourcePortId,
						portHit.nodeId, portHit.portId
					);
					if (this._dragEdgeLine) {
						this._dragEdgeLine.setAttribute('stroke', result.valid ? '#4ec96e' : '#e85c5c');
					}
				} else if (this._dragEdgeLine) {
					this._dragEdgeLine.setAttribute('stroke', '#666');
				}
				break;
			}
			case 'marquee': {
				const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
				this._state.currentX = canvasPos.x;
				this._state.currentY = canvasPos.y;
				this._updateMarqueeRect();
				this._selectNodesInMarquee();
				break;
			}
		}
	}

	private _onPointerUp(e: PointerEvent): void {
		switch (this._state.kind) {
			case 'dragging-node': {
				if (this._state.moved) {
					const node = this._model.getNode(this._state.nodeId);
					if (node) {
						this._model.moveNode(this._state.nodeId, this._state.startX, this._state.startY);
						this._history.execute(
							new MoveNodeCommand(this._state.nodeId, node.position.x, node.position.y),
							this._model
						);
						// Re-apply since execute moved it back then forward
						// Actually MoveNodeCommand stores old in execute, so we need to set it back first
						// The command's execute reads the current position as old, then sets new
						// But we already moved it. Let's just record it properly:
					}
					// Simplified: just mark it as manually positioned (already done in model.moveNode)
				}
				break;
			}
			case 'dragging-edge': {
				this._removeDragEdgeLine();
				const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
				const portHit = this._renderer.getPortAtPoint(canvasPos.x, canvasPos.y);

				if (portHit && portHit.nodeId !== this._state.sourceNodeId) {
					const result = this._edgeValidator.canConnect(
						this._model, this._state.sourceNodeId, this._state.sourcePortId,
						portHit.nodeId, portHit.portId
					);
					if (result.valid) {
						const edge: IComposerEdge = {
							id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
							sourceNodeId: this._state.sourceNodeId,
							sourcePortId: this._state.sourcePortId,
							targetNodeId: portHit.nodeId,
							targetPortId: portHit.portId
						};
						this._history.execute(new AddEdgeCommand(edge), this._model);
					}
				}
				break;
			}
			case 'marquee': {
				this._removeMarqueeRect();
				break;
			}
		}
		this._state = { kind: 'idle' };
	}

	private _onWheel(e: WheelEvent): void {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			this._canvas.zoomAt(factor, e.clientX, e.clientY);
		} else {
			this._canvas.pan(-e.deltaX, -e.deltaY);
		}
	}

	private _onDoubleClick(e: MouseEvent): void {
		const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
		const nodeHit = this._renderer.getNodeAtPoint(canvasPos.x, canvasPos.y);
		if (nodeHit) {
			this._onNodeDoubleClick.fire(nodeHit);
		}
	}

	private _onContextMenuEvent(e: MouseEvent): void {
		e.preventDefault();
		const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
		const nodeHit = this._renderer.getNodeAtPoint(canvasPos.x, canvasPos.y);
		const edgeHit = nodeHit ? undefined : this._renderer.getEdgeAtPoint(canvasPos.x, canvasPos.y);

		this._onContextMenu.fire({
			screenX: e.clientX,
			screenY: e.clientY,
			canvasX: canvasPos.x,
			canvasY: canvasPos.y,
			nodeId: nodeHit || undefined,
			edgeId: edgeHit || undefined
		});
	}

	private _onKeyDown(e: KeyboardEvent): void {
		if (e.code === 'Space') {
			this._spaceHeld = true;
			if (this._canvas.svgRoot) { this._canvas.svgRoot.style.cursor = 'grab'; }
			return;
		}

		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) { return; }

		if (e.code === 'Delete' || e.code === 'Backspace') {
			this._deleteSelected();
			e.preventDefault();
		} else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
			const allIds = [...this._model.nodes.keys(), ...this._model.edges.keys()];
			this._model.select(allIds);
			e.preventDefault();
		} else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
			if (e.shiftKey) {
				this._history.redo(this._model);
			} else {
				this._history.undo(this._model);
			}
			e.preventDefault();
		} else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
			this._history.redo(this._model);
			e.preventDefault();
		} else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
			this._duplicateSelected();
			e.preventDefault();
		}
	}

	private _onKeyUp(e: KeyboardEvent): void {
		if (e.code === 'Space') {
			this._spaceHeld = false;
			if (this._canvas.svgRoot) { this._canvas.svgRoot.style.cursor = 'default'; }
		}
	}

	private _onDragOver(e: DragEvent): void {
		e.preventDefault();
		if (e.dataTransfer) { e.dataTransfer.dropEffect = 'copy'; }
	}

	private _onDropEvent(e: DragEvent): void {
		e.preventDefault();
		const data = e.dataTransfer?.getData('text/plain');
		if (!data) { return; }

		const canvasPos = this._canvas.screenToCanvas(e.clientX, e.clientY);
		this._onDrop.fire({
			canvasX: this._canvas.snapToGrid(canvasPos.x),
			canvasY: this._canvas.snapToGrid(canvasPos.y),
			data
		});
	}

	private _deleteSelected(): void {
		const selectedNodes = this._model.getSelectedNodes();
		const selectedEdges = this._model.getSelectedEdges();

		if (selectedNodes.length === 0 && selectedEdges.length === 0) { return; }

		this._history.beginBatch('Delete selected');
		for (const edge of selectedEdges) {
			this._history.execute(new RemoveEdgeCommand(edge.id), this._model);
		}
		for (const node of selectedNodes) {
			this._history.execute(new RemoveNodeCommand(node.id), this._model);
		}
		this._history.endBatch(this._model);
		this._model.clearSelection();
	}

	private _duplicateSelected(): void {
		const selectedNodes = this._model.getSelectedNodes();
		if (selectedNodes.length === 0) { return; }

		this._history.beginBatch('Duplicate nodes');
		const idMap = new Map<string, string>();

		for (const node of selectedNodes) {
			const newNode = this._nodeRegistry.createNode(node.type, {
				x: node.position.x + 40,
				y: node.position.y + 40
			}, { ...node.config });
			newNode.label = node.label;
			idMap.set(node.id, newNode.id);
			this._history.execute(new AddNodeCommand(newNode), this._model);
		}

		for (const edge of this._model.edges.values()) {
			const newSource = idMap.get(edge.sourceNodeId);
			const newTarget = idMap.get(edge.targetNodeId);
			if (newSource && newTarget) {
				const newEdge: IComposerEdge = {
					id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
					sourceNodeId: newSource,
					sourcePortId: edge.sourcePortId,
					targetNodeId: newTarget,
					targetPortId: edge.targetPortId
				};
				this._history.execute(new AddEdgeCommand(newEdge), this._model);
			}
		}

		this._history.endBatch(this._model);
		this._model.select([...idMap.values()]);
	}

	private _createDragEdgeLine(x: number, y: number): void {
		const overlay = this._canvas.overlayLayer;
		if (!overlay) { return; }

		this._dragEdgeLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		this._dragEdgeLine.setAttribute('x1', String(x));
		this._dragEdgeLine.setAttribute('y1', String(y));
		this._dragEdgeLine.setAttribute('x2', String(x));
		this._dragEdgeLine.setAttribute('y2', String(y));
		this._dragEdgeLine.setAttribute('stroke', '#666');
		this._dragEdgeLine.setAttribute('stroke-width', '2');
		this._dragEdgeLine.setAttribute('stroke-dasharray', '6 3');
		this._dragEdgeLine.style.pointerEvents = 'none';
		overlay.appendChild(this._dragEdgeLine);
	}

	private _updateDragEdgeLine(x: number, y: number): void {
		if (!this._dragEdgeLine) { return; }
		this._dragEdgeLine.setAttribute('x2', String(x));
		this._dragEdgeLine.setAttribute('y2', String(y));
	}

	private _removeDragEdgeLine(): void {
		if (this._dragEdgeLine) {
			this._dragEdgeLine.parentNode?.removeChild(this._dragEdgeLine);
			this._dragEdgeLine = null;
		}
	}

	private _createMarqueeRect(): void {
		const overlay = this._canvas.overlayLayer;
		if (!overlay) { return; }

		this._marqueeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		this._marqueeRect.setAttribute('fill', 'rgba(107, 163, 232, 0.1)');
		this._marqueeRect.setAttribute('stroke', '#6ba3e8');
		this._marqueeRect.setAttribute('stroke-width', '1');
		this._marqueeRect.setAttribute('stroke-dasharray', '4 2');
		this._marqueeRect.style.pointerEvents = 'none';
		overlay.appendChild(this._marqueeRect);
	}

	private _updateMarqueeRect(): void {
		if (!this._marqueeRect || this._state.kind !== 'marquee') { return; }
		const { startX, startY, currentX, currentY } = this._state;
		const x = Math.min(startX, currentX);
		const y = Math.min(startY, currentY);
		const w = Math.abs(currentX - startX);
		const h = Math.abs(currentY - startY);
		this._marqueeRect.setAttribute('x', String(x));
		this._marqueeRect.setAttribute('y', String(y));
		this._marqueeRect.setAttribute('width', String(w));
		this._marqueeRect.setAttribute('height', String(h));
	}

	private _removeMarqueeRect(): void {
		if (this._marqueeRect) {
			this._marqueeRect.parentNode?.removeChild(this._marqueeRect);
			this._marqueeRect = null;
		}
	}

	private _selectNodesInMarquee(): void {
		if (this._state.kind !== 'marquee') { return; }
		const { startX, startY, currentX, currentY } = this._state;
		const minX = Math.min(startX, currentX);
		const minY = Math.min(startY, currentY);
		const maxX = Math.max(startX, currentX);
		const maxY = Math.max(startY, currentY);

		const enclosed: string[] = [];
		for (const node of this._model.nodes.values()) {
			const { x, y } = node.position;
			const { width, height } = node.size;
			if (x >= minX && y >= minY && x + width <= maxX && y + height <= maxY) {
				enclosed.push(node.id);
			}
		}
		this._model.select(enclosed);
	}

	private _addListener(target: EventTarget, type: string, handler: (e: any) => void, options?: AddEventListenerOptions): IDisposable {
		target.addEventListener(type, handler, options);
		return { dispose: () => target.removeEventListener(type, handler, options) };
	}

	override dispose(): void {
		this.detach();
		this._removeDragEdgeLine();
		this._removeMarqueeRect();
		super.dispose();
	}
}
