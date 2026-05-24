/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';

export type NodeType = 'agent' | 'trigger' | 'conditional' | 'transform' | 'output' | 'group';

export interface IPortDefinition {
	readonly id: string;
	readonly label: string;
	readonly dataType: 'flow' | 'text' | 'json' | 'any';
	readonly side: 'input' | 'output';
}

export interface IComposerNode {
	id: string;
	type: NodeType;
	label: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	config: Record<string, unknown>;
	ports: IPortDefinition[];
	collapsed?: boolean;
	parentGroup?: string;
	manuallyPositioned?: boolean;
	enabled: boolean;
}

export interface IComposerEdge {
	id: string;
	sourceNodeId: string;
	sourcePortId: string;
	targetNodeId: string;
	targetPortId: string;
}

export interface IViewport {
	x: number;
	y: number;
	zoom: number;
}

export interface IModelSnapshot {
	readonly nodes: ReadonlyMap<string, IComposerNode>;
	readonly edges: ReadonlyMap<string, IComposerEdge>;
	readonly selection: ReadonlySet<string>;
	readonly viewport: Readonly<IViewport>;
}

export interface ICommand {
	readonly description: string;
	execute(model: ComposerModel): void;
	undo(model: ComposerModel): void;
}

export interface IModelChangeEvent {
	readonly kind: 'nodes' | 'edges' | 'selection' | 'viewport';
	readonly nodeIds?: string[];
	readonly edgeIds?: string[];
}

export class ComposerModel extends Disposable {

	private readonly _nodes = new Map<string, IComposerNode>();
	private readonly _edges = new Map<string, IComposerEdge>();
	private readonly _selection = new Set<string>();
	private _viewport: IViewport = { x: 0, y: 0, zoom: 1 };

	private readonly _onDidChange = this._register(new Emitter<IModelChangeEvent>());
	readonly onDidChange: Event<IModelChangeEvent> = this._onDidChange.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection: Event<void> = this._onDidChangeSelection.event;

	get nodes(): ReadonlyMap<string, IComposerNode> { return this._nodes; }
	get edges(): ReadonlyMap<string, IComposerEdge> { return this._edges; }
	get selection(): ReadonlySet<string> { return this._selection; }
	get viewport(): Readonly<IViewport> { return this._viewport; }

	getSnapshot(): IModelSnapshot {
		return {
			nodes: new Map(this._nodes),
			edges: new Map(this._edges),
			selection: new Set(this._selection),
			viewport: { ...this._viewport }
		};
	}

	// ── Node Operations ──────────────────────────────────────────────────────

	addNode(node: IComposerNode): void {
		this._nodes.set(node.id, node);
		this._onDidChange.fire({ kind: 'nodes', nodeIds: [node.id] });
	}

	removeNode(id: string): IComposerNode | undefined {
		const node = this._nodes.get(id);
		if (!node) { return undefined; }
		this._nodes.delete(id);
		this._selection.delete(id);

		const removedEdges: string[] = [];
		for (const [edgeId, edge] of this._edges) {
			if (edge.sourceNodeId === id || edge.targetNodeId === id) {
				this._edges.delete(edgeId);
				removedEdges.push(edgeId);
			}
		}

		this._onDidChange.fire({ kind: 'nodes', nodeIds: [id] });
		if (removedEdges.length > 0) {
			this._onDidChange.fire({ kind: 'edges', edgeIds: removedEdges });
		}
		return node;
	}

	updateNode(id: string, patch: Partial<Omit<IComposerNode, 'id' | 'type'>>): void {
		const node = this._nodes.get(id);
		if (!node) { return; }
		Object.assign(node, patch);
		this._onDidChange.fire({ kind: 'nodes', nodeIds: [id] });
	}

	moveNode(id: string, x: number, y: number): void {
		const node = this._nodes.get(id);
		if (!node) { return; }
		node.position = { x, y };
		node.manuallyPositioned = true;
		this._onDidChange.fire({ kind: 'nodes', nodeIds: [id] });
	}

	getNode(id: string): IComposerNode | undefined {
		return this._nodes.get(id);
	}

	// ── Edge Operations ──────────────────────────────────────────────────────

	addEdge(edge: IComposerEdge): void {
		this._edges.set(edge.id, edge);
		this._onDidChange.fire({ kind: 'edges', edgeIds: [edge.id] });
	}

	removeEdge(id: string): IComposerEdge | undefined {
		const edge = this._edges.get(id);
		if (!edge) { return undefined; }
		this._edges.delete(id);
		this._onDidChange.fire({ kind: 'edges', edgeIds: [id] });
		return edge;
	}

	getEdge(id: string): IComposerEdge | undefined {
		return this._edges.get(id);
	}

	getEdgesForNode(nodeId: string): IComposerEdge[] {
		const result: IComposerEdge[] = [];
		for (const edge of this._edges.values()) {
			if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
				result.push(edge);
			}
		}
		return result;
	}

	getIncomingEdges(nodeId: string): IComposerEdge[] {
		const result: IComposerEdge[] = [];
		for (const edge of this._edges.values()) {
			if (edge.targetNodeId === nodeId) {
				result.push(edge);
			}
		}
		return result;
	}

	getOutgoingEdges(nodeId: string): IComposerEdge[] {
		const result: IComposerEdge[] = [];
		for (const edge of this._edges.values()) {
			if (edge.sourceNodeId === nodeId) {
				result.push(edge);
			}
		}
		return result;
	}

	// ── Selection ────────────────────────────────────────────────────────────

	select(ids: string[]): void {
		this._selection.clear();
		for (const id of ids) {
			if (this._nodes.has(id) || this._edges.has(id)) {
				this._selection.add(id);
			}
		}
		this._onDidChange.fire({ kind: 'selection' });
		this._onDidChangeSelection.fire();
	}

	addToSelection(ids: string[]): void {
		for (const id of ids) {
			if (this._nodes.has(id) || this._edges.has(id)) {
				this._selection.add(id);
			}
		}
		this._onDidChange.fire({ kind: 'selection' });
		this._onDidChangeSelection.fire();
	}

	removeFromSelection(ids: string[]): void {
		for (const id of ids) {
			this._selection.delete(id);
		}
		this._onDidChange.fire({ kind: 'selection' });
		this._onDidChangeSelection.fire();
	}

	clearSelection(): void {
		if (this._selection.size === 0) { return; }
		this._selection.clear();
		this._onDidChange.fire({ kind: 'selection' });
		this._onDidChangeSelection.fire();
	}

	getSelectedNodes(): IComposerNode[] {
		const result: IComposerNode[] = [];
		for (const id of this._selection) {
			const node = this._nodes.get(id);
			if (node) { result.push(node); }
		}
		return result;
	}

	getSelectedEdges(): IComposerEdge[] {
		const result: IComposerEdge[] = [];
		for (const id of this._selection) {
			const edge = this._edges.get(id);
			if (edge) { result.push(edge); }
		}
		return result;
	}

	// ── Viewport ─────────────────────────────────────────────────────────────

	setViewport(viewport: IViewport): void {
		this._viewport = { ...viewport };
		this._onDidChange.fire({ kind: 'viewport' });
	}

	pan(dx: number, dy: number): void {
		this._viewport.x += dx;
		this._viewport.y += dy;
		this._onDidChange.fire({ kind: 'viewport' });
	}

	zoom(factor: number, centerX: number, centerY: number): void {
		const oldZoom = this._viewport.zoom;
		const newZoom = Math.max(0.25, Math.min(4, oldZoom * factor));
		if (newZoom === oldZoom) { return; }

		this._viewport.x = centerX - (centerX - this._viewport.x) * (newZoom / oldZoom);
		this._viewport.y = centerY - (centerY - this._viewport.y) * (newZoom / oldZoom);
		this._viewport.zoom = newZoom;
		this._onDidChange.fire({ kind: 'viewport' });
	}

	// ── Bulk Operations ──────────────────────────────────────────────────────

	clear(): void {
		this._nodes.clear();
		this._edges.clear();
		this._selection.clear();
		this._viewport = { x: 0, y: 0, zoom: 1 };
		this._onDidChange.fire({ kind: 'nodes' });
		this._onDidChange.fire({ kind: 'edges' });
		this._onDidChange.fire({ kind: 'selection' });
		this._onDidChange.fire({ kind: 'viewport' });
	}

	loadSnapshot(snapshot: IModelSnapshot): void {
		this._nodes.clear();
		this._edges.clear();
		this._selection.clear();

		for (const [id, node] of snapshot.nodes) {
			this._nodes.set(id, { ...node });
		}
		for (const [id, edge] of snapshot.edges) {
			this._edges.set(id, { ...edge });
		}
		for (const id of snapshot.selection) {
			this._selection.add(id);
		}
		this._viewport = { ...snapshot.viewport };

		this._onDidChange.fire({ kind: 'nodes' });
		this._onDidChange.fire({ kind: 'edges' });
		this._onDidChange.fire({ kind: 'viewport' });
	}

	// ── Query Helpers ────────────────────────────────────────────────────────

	getNodesByType(type: NodeType): IComposerNode[] {
		const result: IComposerNode[] = [];
		for (const node of this._nodes.values()) {
			if (node.type === type) { result.push(node); }
		}
		return result;
	}

	getChildNodes(groupId: string): IComposerNode[] {
		const result: IComposerNode[] = [];
		for (const node of this._nodes.values()) {
			if (node.parentGroup === groupId) { result.push(node); }
		}
		return result;
	}

	getBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		if (this._nodes.size === 0) { return null; }
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const node of this._nodes.values()) {
			minX = Math.min(minX, node.position.x);
			minY = Math.min(minY, node.position.y);
			maxX = Math.max(maxX, node.position.x + node.size.width);
			maxY = Math.max(maxY, node.position.y + node.size.height);
		}
		return { minX, minY, maxX, maxY };
	}

	isAncestor(potentialAncestor: string, nodeId: string): boolean {
		let current = this._nodes.get(nodeId);
		const visited = new Set<string>();
		while (current?.parentGroup) {
			if (current.parentGroup === potentialAncestor) { return true; }
			if (visited.has(current.parentGroup)) { return false; }
			visited.add(current.parentGroup);
			current = this._nodes.get(current.parentGroup);
		}
		return false;
	}
}
