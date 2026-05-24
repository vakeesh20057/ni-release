/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ComposerModel, IComposerNode } from '../model/composerModel.js';
import { ComposerHistory, UpdateNodeConfigCommand, UpdateNodeLabelCommand, ToggleNodeEnabledCommand } from '../model/composerHistory.js';
import { NodeRegistry, INodeConfigField } from '../nodes/nodeRegistry.js';

export class PropertyPanel extends Disposable {

	private _container: HTMLElement | null = null;
	private _contentArea: HTMLElement | null = null;

	constructor(
		private readonly _model: ComposerModel,
		private readonly _history: ComposerHistory,
		private readonly _nodeRegistry: NodeRegistry,
		private readonly _availableTools?: () => string[]
	) {
		super();
		this._register(_model.onDidChangeSelection(() => this._onSelectionChange()));
	}

	mount(container: HTMLElement): void {
		this._container = container;
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.width = '260px';
		container.style.borderLeft = '1px solid #333';
		container.style.backgroundColor = '#1e1e1e';
		container.style.overflow = 'hidden';

		this._contentArea = document.createElement('div');
		this._contentArea.style.flex = '1';
		this._contentArea.style.overflowY = 'auto';
		this._contentArea.style.padding = '12px';
		container.appendChild(this._contentArea);

		this._renderEmpty();
	}

	destroy(): void {
		if (this._container) { this._container.innerHTML = ''; }
		this._container = null;
		this._contentArea = null;
	}

	refresh(): void {
		this._onSelectionChange();
	}

	private _onSelectionChange(): void {
		const selected = this._model.getSelectedNodes();
		if (selected.length === 1) {
			this._renderNodeConfig(selected[0]);
		} else if (selected.length > 1) {
			this._renderMultiSelect(selected);
		} else {
			this._renderEmpty();
		}
	}

	private _renderEmpty(): void {
		if (!this._contentArea) { return; }
		this._contentArea.innerHTML = '';
		const msg = document.createElement('div');
		msg.style.color = '#666';
		msg.style.fontSize = '12px';
		msg.style.textAlign = 'center';
		msg.style.padding = '40px 20px';
		msg.textContent = 'Select a node to view its properties';
		this._contentArea.appendChild(msg);
	}

	private _renderMultiSelect(nodes: IComposerNode[]): void {
		if (!this._contentArea) { return; }
		this._contentArea.innerHTML = '';

		this._addSectionHeader(`${nodes.length} nodes selected`);

		const enabledRow = this._createCheckboxRow('Enabled', nodes.every(n => n.enabled), (checked) => {
			this._history.beginBatch('Toggle enabled');
			for (const node of nodes) {
				if (node.enabled !== checked) {
					this._history.execute(new ToggleNodeEnabledCommand(node.id), this._model);
				}
			}
			this._history.endBatch(this._model);
		});
		this._contentArea.appendChild(enabledRow);
	}

	private _renderNodeConfig(node: IComposerNode): void {
		if (!this._contentArea) { return; }
		this._contentArea.innerHTML = '';

		this._addSectionHeader('Node');

		const labelInput = this._createTextInput('Name', node.label, (value) => {
			this._history.execute(new UpdateNodeLabelCommand(node.id, value), this._model);
		});
		this._contentArea.appendChild(labelInput);

		const enabledRow = this._createCheckboxRow('Enabled', node.enabled, () => {
			this._history.execute(new ToggleNodeEnabledCommand(node.id), this._model);
		});
		this._contentArea.appendChild(enabledRow);

		const def = this._nodeRegistry.getDefinition(node.type);
		if (!def) { return; }

		this._addSectionHeader('Configuration');

		for (const field of def.configSchema) {
			if (field.visibleWhen) {
				const currentValue = node.config[field.visibleWhen.field];
				if (currentValue !== field.visibleWhen.value) { continue; }
			}

			const fieldEl = this._createField(node, field);
			if (fieldEl) { this._contentArea.appendChild(fieldEl); }
		}
	}

	private _createField(node: IComposerNode, field: INodeConfigField): HTMLElement | null {
		const currentValue = node.config[field.key] ?? field.defaultValue;

		switch (field.type) {
			case 'string':
				return this._createTextInput(field.label, String(currentValue || ''), (val) => {
					this._history.execute(new UpdateNodeConfigCommand(node.id, { [field.key]: val }), this._model);
				}, field.description);

			case 'number':
				return this._createNumberInput(field.label, Number(currentValue || 0), (val) => {
					this._history.execute(new UpdateNodeConfigCommand(node.id, { [field.key]: val }), this._model);
				});

			case 'boolean':
				return this._createCheckboxRow(field.label, Boolean(currentValue), (checked) => {
					this._history.execute(new UpdateNodeConfigCommand(node.id, { [field.key]: checked }), this._model);
				});

			case 'select':
				return this._createSelect(field.label, String(currentValue || ''), field.options || [], (val) => {
					this._history.execute(new UpdateNodeConfigCommand(node.id, { [field.key]: val }), this._model);
				});

			case 'textarea':
				return this._createTextArea(field.label, String(currentValue || ''), (val) => {
					this._history.execute(new UpdateNodeConfigCommand(node.id, { [field.key]: val }), this._model);
				});

			case 'tools':
				return this._createToolsSelector(node, field.key);

			case 'multiselect':
				return null;

			default:
				return null;
		}
	}

	private _createTextInput(label: string, value: string, onChange: (val: string) => void, placeholder?: string): HTMLElement {
		const wrapper = this._createFieldWrapper(label);
		const input = document.createElement('input');
		input.type = 'text';
		input.value = value;
		if (placeholder) { input.placeholder = placeholder; }
		this._styleInput(input);
		input.addEventListener('change', () => onChange(input.value));
		wrapper.appendChild(input);
		return wrapper;
	}

	private _createNumberInput(label: string, value: number, onChange: (val: number) => void): HTMLElement {
		const wrapper = this._createFieldWrapper(label);
		const input = document.createElement('input');
		input.type = 'number';
		input.value = String(value);
		this._styleInput(input);
		input.addEventListener('change', () => onChange(Number(input.value) || 0));
		wrapper.appendChild(input);
		return wrapper;
	}

	private _createCheckboxRow(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.style.display = 'flex';
		wrapper.style.alignItems = 'center';
		wrapper.style.marginBottom = '10px';
		wrapper.style.gap = '8px';

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = checked;
		checkbox.style.accentColor = '#6ba3e8';
		checkbox.addEventListener('change', () => onChange(checkbox.checked));
		wrapper.appendChild(checkbox);

		const labelEl = document.createElement('label');
		labelEl.textContent = label;
		labelEl.style.fontSize = '12px';
		labelEl.style.color = '#bbb';
		wrapper.appendChild(labelEl);

		return wrapper;
	}

	private _createSelect(label: string, value: string, options: { label: string; value: string }[], onChange: (val: string) => void): HTMLElement {
		const wrapper = this._createFieldWrapper(label);
		const select = document.createElement('select');
		select.style.width = '100%';
		select.style.padding = '5px 8px';
		select.style.border = '1px solid #444';
		select.style.borderRadius = '4px';
		select.style.backgroundColor = '#2a2a2a';
		select.style.color = '#ddd';
		select.style.fontSize = '12px';
		select.style.outline = 'none';

		for (const opt of options) {
			const optEl = document.createElement('option');
			optEl.value = opt.value;
			optEl.textContent = opt.label;
			if (opt.value === value) { optEl.selected = true; }
			select.appendChild(optEl);
		}

		select.addEventListener('change', () => onChange(select.value));
		wrapper.appendChild(select);
		return wrapper;
	}

	private _createTextArea(label: string, value: string, onChange: (val: string) => void): HTMLElement {
		const wrapper = this._createFieldWrapper(label);
		const textarea = document.createElement('textarea');
		textarea.value = value;
		textarea.rows = 4;
		textarea.style.width = '100%';
		textarea.style.padding = '6px 8px';
		textarea.style.border = '1px solid #444';
		textarea.style.borderRadius = '4px';
		textarea.style.backgroundColor = '#2a2a2a';
		textarea.style.color = '#ddd';
		textarea.style.fontSize = '12px';
		textarea.style.resize = 'vertical';
		textarea.style.outline = 'none';
		textarea.style.fontFamily = 'monospace';
		textarea.style.boxSizing = 'border-box';
		textarea.addEventListener('change', () => onChange(textarea.value));
		wrapper.appendChild(textarea);
		return wrapper;
	}

	private _createToolsSelector(node: IComposerNode, configKey: string): HTMLElement {
		const wrapper = this._createFieldWrapper('Allowed Tools');
		const currentTools = (node.config[configKey] as string[]) || [];
		const allTools = this._availableTools ? this._availableTools() : [];

		if (allTools.length === 0) {
			const msg = document.createElement('div');
			msg.textContent = 'No tools available';
			msg.style.fontSize = '11px';
			msg.style.color = '#666';
			wrapper.appendChild(msg);
			return wrapper;
		}

		const listEl = document.createElement('div');
		listEl.style.maxHeight = '150px';
		listEl.style.overflowY = 'auto';
		listEl.style.border = '1px solid #333';
		listEl.style.borderRadius = '4px';
		listEl.style.padding = '4px';

		for (const tool of allTools) {
			const row = document.createElement('label');
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '6px';
			row.style.padding = '3px 4px';
			row.style.fontSize = '11px';
			row.style.color = '#bbb';
			row.style.cursor = 'pointer';

			const cb = document.createElement('input');
			cb.type = 'checkbox';
			cb.checked = currentTools.includes(tool);
			cb.style.accentColor = '#6ba3e8';
			cb.addEventListener('change', () => {
				const newTools = cb.checked
					? [...currentTools, tool]
					: currentTools.filter(t => t !== tool);
				this._history.execute(new UpdateNodeConfigCommand(node.id, { [configKey]: newTools }), this._model);
			});
			row.appendChild(cb);

			const label = document.createElement('span');
			label.textContent = tool;
			row.appendChild(label);
			listEl.appendChild(row);
		}

		wrapper.appendChild(listEl);
		return wrapper;
	}

	private _createFieldWrapper(label: string): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.style.marginBottom = '12px';

		const labelEl = document.createElement('div');
		labelEl.textContent = label;
		labelEl.style.fontSize = '11px';
		labelEl.style.color = '#999';
		labelEl.style.marginBottom = '4px';
		wrapper.appendChild(labelEl);

		return wrapper;
	}

	private _addSectionHeader(text: string): void {
		if (!this._contentArea) { return; }
		const header = document.createElement('div');
		header.textContent = text;
		header.style.fontSize = '11px';
		header.style.fontWeight = '600';
		header.style.color = '#888';
		header.style.textTransform = 'uppercase';
		header.style.letterSpacing = '0.5px';
		header.style.marginBottom = '10px';
		header.style.marginTop = '8px';
		header.style.paddingBottom = '6px';
		header.style.borderBottom = '1px solid #333';
		this._contentArea.appendChild(header);
	}

	private _styleInput(input: HTMLInputElement): void {
		input.style.width = '100%';
		input.style.padding = '5px 8px';
		input.style.border = '1px solid #444';
		input.style.borderRadius = '4px';
		input.style.backgroundColor = '#2a2a2a';
		input.style.color = '#ddd';
		input.style.fontSize = '12px';
		input.style.outline = 'none';
		input.style.boxSizing = 'border-box';
	}
}
