/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { NodeRegistry } from '../nodes/nodeRegistry.js';
import { IAgentDefinition } from '../../../common/workflowTypes.js';

export interface IPaletteItem {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly category: string;
	readonly nodeType: string;
	readonly configOverrides?: Record<string, unknown>;
	readonly icon: string;
	readonly color: string;
}

export class NodePalette extends Disposable {

	private _container: HTMLElement | null = null;
	private _searchInput: HTMLInputElement | null = null;
	private _listContainer: HTMLElement | null = null;
	private _filter = '';
	private _items: IPaletteItem[] = [];
	private _agents: IAgentDefinition[] = [];

	private readonly _onDidStartDrag = this._register(new Emitter<IPaletteItem>());
	readonly onDidStartDrag: Event<IPaletteItem> = this._onDidStartDrag.event;

	constructor(private readonly _nodeRegistry: NodeRegistry) {
		super();
	}

	mount(container: HTMLElement): void {
		this._container = container;
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.width = '220px';
		container.style.borderRight = '1px solid #333';
		container.style.backgroundColor = '#1e1e1e';
		container.style.overflow = 'hidden';

		const header = document.createElement('div');
		header.style.padding = '12px';
		header.style.borderBottom = '1px solid #333';
		header.style.flexShrink = '0';

		const title = document.createElement('div');
		title.textContent = 'Nodes';
		title.style.fontSize = '12px';
		title.style.fontWeight = '600';
		title.style.color = '#ccc';
		title.style.marginBottom = '8px';
		title.style.textTransform = 'uppercase';
		title.style.letterSpacing = '0.5px';
		header.appendChild(title);

		this._searchInput = document.createElement('input');
		this._searchInput.type = 'text';
		this._searchInput.placeholder = 'Search nodes...';
		this._searchInput.style.width = '100%';
		this._searchInput.style.padding = '6px 10px';
		this._searchInput.style.border = '1px solid #444';
		this._searchInput.style.borderRadius = '4px';
		this._searchInput.style.backgroundColor = '#2a2a2a';
		this._searchInput.style.color = '#ddd';
		this._searchInput.style.fontSize = '12px';
		this._searchInput.style.outline = 'none';
		this._searchInput.style.boxSizing = 'border-box';
		this._searchInput.addEventListener('input', () => {
			this._filter = this._searchInput!.value.toLowerCase();
			this._renderList();
		});
		header.appendChild(this._searchInput);
		container.appendChild(header);

		this._listContainer = document.createElement('div');
		this._listContainer.style.flex = '1';
		this._listContainer.style.overflowY = 'auto';
		this._listContainer.style.padding = '8px';
		container.appendChild(this._listContainer);

		this._buildItems();
		this._renderList();
	}

	setAgents(agents: IAgentDefinition[]): void {
		this._agents = agents;
		this._buildItems();
		this._renderList();
	}

	destroy(): void {
		if (this._container) {
			this._container.innerHTML = '';
		}
		this._container = null;
		this._searchInput = null;
		this._listContainer = null;
	}

	private _buildItems(): void {
		this._items = [];

		const triggerDefs = this._nodeRegistry.getByCategory('trigger');
		for (const def of triggerDefs) {
			this._items.push({
				id: `palette-${def.type}`,
				label: def.label,
				description: def.description,
				category: 'Triggers',
				nodeType: def.type,
				icon: def.icon,
				color: def.color
			});
		}

		for (const agent of this._agents) {
			this._items.push({
				id: `palette-agent-${agent.id}`,
				label: agent.name,
				description: agent.description || 'Agent step',
				category: 'Agents',
				nodeType: 'agent',
				configOverrides: { agentId: agent.id, allowedTools: agent.allowedTools },
				icon: 'bot',
				color: '#6ba3e8'
			});
		}

		if (this._agents.length === 0) {
			const agentDef = this._nodeRegistry.getDefinition('agent');
			if (agentDef) {
				this._items.push({
					id: 'palette-agent-generic',
					label: 'Agent',
					description: 'Generic agent step (assign agent later)',
					category: 'Agents',
					nodeType: 'agent',
					icon: agentDef.icon,
					color: agentDef.color
				});
			}
		}

		const logicDefs = this._nodeRegistry.getByCategory('logic');
		for (const def of logicDefs) {
			this._items.push({
				id: `palette-${def.type}`,
				label: def.label,
				description: def.description,
				category: 'Logic',
				nodeType: def.type,
				icon: def.icon,
				color: def.color
			});
		}

		const outputDefs = this._nodeRegistry.getByCategory('output');
		for (const def of outputDefs) {
			this._items.push({
				id: `palette-${def.type}`,
				label: def.label,
				description: def.description,
				category: 'Output',
				nodeType: def.type,
				icon: def.icon,
				color: def.color
			});
		}
	}

	private _renderList(): void {
		if (!this._listContainer) { return; }
		this._listContainer.innerHTML = '';

		const filtered = this._filter
			? this._items.filter(item =>
				item.label.toLowerCase().includes(this._filter) ||
				item.description.toLowerCase().includes(this._filter) ||
				item.category.toLowerCase().includes(this._filter))
			: this._items;

		const grouped = new Map<string, IPaletteItem[]>();
		for (const item of filtered) {
			const list = grouped.get(item.category) || [];
			list.push(item);
			grouped.set(item.category, list);
		}

		for (const [category, items] of grouped) {
			const categoryEl = document.createElement('div');
			categoryEl.style.marginBottom = '12px';

			const catHeader = document.createElement('div');
			catHeader.textContent = category;
			catHeader.style.fontSize = '10px';
			catHeader.style.fontWeight = '600';
			catHeader.style.color = '#888';
			catHeader.style.textTransform = 'uppercase';
			catHeader.style.letterSpacing = '0.5px';
			catHeader.style.marginBottom = '6px';
			catHeader.style.padding = '0 4px';
			categoryEl.appendChild(catHeader);

			for (const item of items) {
				const el = this._createPaletteItemElement(item);
				categoryEl.appendChild(el);
			}

			this._listContainer.appendChild(categoryEl);
		}

		if (filtered.length === 0) {
			const empty = document.createElement('div');
			empty.textContent = 'No matching nodes';
			empty.style.color = '#666';
			empty.style.fontSize = '12px';
			empty.style.padding = '20px';
			empty.style.textAlign = 'center';
			this._listContainer.appendChild(empty);
		}
	}

	private _createPaletteItemElement(item: IPaletteItem): HTMLElement {
		const el = document.createElement('div');
		el.style.display = 'flex';
		el.style.alignItems = 'center';
		el.style.padding = '6px 8px';
		el.style.borderRadius = '4px';
		el.style.cursor = 'grab';
		el.style.marginBottom = '2px';
		el.style.transition = 'background-color 0.1s';
		el.draggable = true;
		el.title = item.description;

		el.addEventListener('mouseenter', () => { el.style.backgroundColor = '#2a2a2a'; });
		el.addEventListener('mouseleave', () => { el.style.backgroundColor = 'transparent'; });

		el.addEventListener('dragstart', (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData('text/plain', JSON.stringify({
					nodeType: item.nodeType,
					configOverrides: item.configOverrides,
					label: item.label
				}));
				e.dataTransfer.effectAllowed = 'copy';
			}
			this._onDidStartDrag.fire(item);
		});

		const colorDot = document.createElement('div');
		colorDot.style.width = '8px';
		colorDot.style.height = '8px';
		colorDot.style.borderRadius = '50%';
		colorDot.style.backgroundColor = item.color;
		colorDot.style.marginRight = '8px';
		colorDot.style.flexShrink = '0';
		el.appendChild(colorDot);

		const labelEl = document.createElement('div');
		labelEl.textContent = item.label;
		labelEl.style.fontSize = '12px';
		labelEl.style.color = '#ddd';
		labelEl.style.overflow = 'hidden';
		labelEl.style.textOverflow = 'ellipsis';
		labelEl.style.whiteSpace = 'nowrap';
		el.appendChild(labelEl);

		return el;
	}
}
