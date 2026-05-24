/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { NodeType, IComposerNode } from '../model/composerModel.js';
import { NodeRegistry } from './nodeRegistry.js';

export interface INodeRenderOptions {
	selected: boolean;
	hovered: boolean;
	running: boolean;
}

const ICON_PATHS: Record<string, string> = {
	'zap': 'M13 2L3 14h7l-2 8 10-12h-7l2-8z',
	'bot': 'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 12 2zm-3 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
	'git-branch': 'M6 3v12m0 0a3 3 0 1 0 3 3M6 15a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h3m0 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
	'combine': 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
	'output': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
	'group': 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
};

export class NodeRenderer {

	constructor(private readonly _registry: NodeRegistry) {}

	createNodeIcon(type: NodeType, size: number = 16): SVGGElement {
		const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		const def = this._registry.getDefinition(type);
		if (!def) { return group; }

		const iconPath = ICON_PATHS[def.icon];
		if (!iconPath) { return group; }

		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', iconPath);
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', def.color);
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');

		const scale = size / 24;
		path.setAttribute('transform', `scale(${scale})`);
		group.appendChild(path);

		return group;
	}

	getNodeColors(node: IComposerNode, options: INodeRenderOptions): {
		fill: string;
		stroke: string;
		strokeWidth: number;
		textFill: string;
	} {
		const def = this._registry.getDefinition(node.type);
		const baseColor = def?.color || '#666';

		if (options.selected) {
			return { fill: '#2a3040', stroke: '#6ba3e8', strokeWidth: 2, textFill: '#fff' };
		}
		if (options.hovered) {
			return { fill: '#2a2a2a', stroke: baseColor, strokeWidth: 1.5, textFill: '#eee' };
		}
		if (options.running) {
			return { fill: '#252525', stroke: '#e0a84e', strokeWidth: 2, textFill: '#ddd' };
		}
		return { fill: '#252525', stroke: baseColor, strokeWidth: 1.5, textFill: '#ddd' };
	}

	getNodeShape(type: NodeType): 'rect' | 'diamond' | 'hexagon' {
		switch (type) {
			case 'conditional': return 'diamond';
			case 'trigger': return 'hexagon';
			default: return 'rect';
		}
	}

	createHexagonPoints(width: number, height: number): string {
		const inset = 15;
		return [
			`${inset},0`,
			`${width - inset},0`,
			`${width},${height / 2}`,
			`${width - inset},${height}`,
			`${inset},${height}`,
			`0,${height / 2}`
		].join(' ');
	}

	createDiamondPoints(width: number, height: number): string {
		return [
			`${width / 2},0`,
			`${width},${height / 2}`,
			`${width / 2},${height}`,
			`0,${height / 2}`
		].join(' ');
	}
}
