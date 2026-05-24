/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IComposerEdge, IComposerNode } from '../model/composerModel.js';

export interface IEdgePathOptions {
	animated: boolean;
	selected: boolean;
	valid: boolean;
}

export class EdgeRenderer {

	computePath(
		sourceNode: IComposerNode,
		sourcePortId: string,
		targetNode: IComposerNode,
		targetPortId: string
	): string {
		const sourcePos = this._getPortWorldPosition(sourceNode, sourcePortId);
		const targetPos = this._getPortWorldPosition(targetNode, targetPortId);
		return this._cubicBezier(sourcePos.x, sourcePos.y, targetPos.x, targetPos.y);
	}

	computePartialPath(
		sourceNode: IComposerNode,
		sourcePortId: string,
		endX: number,
		endY: number
	): string {
		const sourcePos = this._getPortWorldPosition(sourceNode, sourcePortId);
		return this._cubicBezier(sourcePos.x, sourcePos.y, endX, endY);
	}

	createPathElement(edge: IComposerEdge, pathData: string, options: IEdgePathOptions): SVGPathElement {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', pathData);
		path.setAttribute('fill', 'none');
		path.setAttribute('data-edge-id', edge.id);

		this.applyStyle(path, options);
		return path;
	}

	applyStyle(path: SVGPathElement, options: IEdgePathOptions): void {
		if (!options.valid) {
			path.setAttribute('stroke', '#e85c5c');
			path.setAttribute('stroke-width', '2');
			path.setAttribute('stroke-dasharray', '4 4');
			path.removeAttribute('marker-end');
		} else if (options.selected) {
			path.setAttribute('stroke', '#6ba3e8');
			path.setAttribute('stroke-width', '3');
			path.removeAttribute('stroke-dasharray');
			path.setAttribute('marker-end', 'url(#edge-arrow-selected)');
		} else {
			path.setAttribute('stroke', '#666');
			path.setAttribute('stroke-width', '2');
			path.removeAttribute('stroke-dasharray');
			path.setAttribute('marker-end', 'url(#edge-arrow)');
		}

		if (options.animated) {
			path.setAttribute('stroke-dasharray', '8 4');
			path.style.animation = 'edge-flow 0.5s linear infinite';
		} else if (options.valid && !options.selected) {
			path.style.animation = '';
		}
	}

	getMidpoint(
		sourceNode: IComposerNode,
		sourcePortId: string,
		targetNode: IComposerNode,
		targetPortId: string
	): { x: number; y: number } {
		const s = this._getPortWorldPosition(sourceNode, sourcePortId);
		const t = this._getPortWorldPosition(targetNode, targetPortId);
		return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
	}

	private _cubicBezier(sx: number, sy: number, tx: number, ty: number): string {
		const dx = Math.abs(tx - sx);
		const offset = Math.max(50, dx * 0.4);
		return `M ${sx} ${sy} C ${sx + offset} ${sy}, ${tx - offset} ${ty}, ${tx} ${ty}`;
	}

	private _getPortWorldPosition(node: IComposerNode, portId: string): { x: number; y: number } {
		const port = node.ports.find(p => p.id === portId);
		if (!port) { return { x: node.position.x, y: node.position.y }; }

		const sameSidePorts = node.ports.filter(p => p.side === port.side);
		const idx = sameSidePorts.indexOf(port);
		const spacing = node.size.height / (sameSidePorts.length + 1);

		if (port.side === 'output') {
			return {
				x: node.position.x + node.size.width,
				y: node.position.y + spacing * (idx + 1)
			};
		} else {
			return {
				x: node.position.x,
				y: node.position.y + spacing * (idx + 1)
			};
		}
	}
}
