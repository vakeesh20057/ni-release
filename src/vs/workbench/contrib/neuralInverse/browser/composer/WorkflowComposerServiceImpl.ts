/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IWorkflowDefinition } from '../../common/workflowTypes.js';
import { NodeType } from './model/composerModel.js';
import { IWorkflowComposerService, IComposerModelSnapshot } from './service.js';
import { ComposerModel, IComposerEdge } from './model/composerModel.js';
import { ComposerHistory, AddNodeCommand, RemoveNodeCommand, AddEdgeCommand, RemoveEdgeCommand } from './model/composerHistory.js';
import { ComposerSerializer, ISerializedWorkflow } from './model/composerSerializer.js';
import { EdgeValidator, IGraphValidationResult } from './edges/edgeValidator.js';
import { NodeRegistry } from './nodes/nodeRegistry.js';
import { WorkflowCanvas } from './canvas/workflowCanvas.js';
import { CanvasRenderer } from './canvas/canvasRenderer.js';
import { CanvasLayout } from './canvas/canvasLayout.js';
import { CanvasInteraction } from './canvas/canvasInteraction.js';
import { NodePalette } from './panels/nodePalette.js';
import { PropertyPanel } from './panels/propertyPanel.js';
import { RunPanel } from './panels/runPanel.js';
import { IWorkflowAgentService } from '../workflowAgentService.js';
import { IAgentStoreService } from '../agentStoreService.js';

export class WorkflowComposerServiceImpl extends Disposable implements IWorkflowComposerService {

	declare readonly _serviceBrand: undefined;

	private readonly _model: ComposerModel;
	private readonly _history: ComposerHistory;
	private readonly _serializer: ComposerSerializer;
	private readonly _edgeValidator: EdgeValidator;
	private readonly _nodeRegistry: NodeRegistry;
	private readonly _canvasLayout: CanvasLayout;

	private _canvas: WorkflowCanvas | null = null;
	private _renderer: CanvasRenderer | null = null;
	private _interaction: CanvasInteraction | null = null;
	private _palette: NodePalette | null = null;
	private _propertyPanel: PropertyPanel | null = null;
	private _runPanel: RunPanel | null = null;
	private _mounted = false;
	private _dirty = false;
	private _currentWorkflowId: string | undefined;
	private _currentMetadata: { id: string; name: string; description: string } | undefined;

	private readonly _onDidChangeModel = this._register(new Emitter<void>());
	readonly onDidChangeModel: Event<void> = this._onDidChangeModel.event;

	private readonly _onDidSave = this._register(new Emitter<IWorkflowDefinition>());
	readonly onDidSave: Event<IWorkflowDefinition> = this._onDidSave.event;

	private readonly _onDidStartRun = this._register(new Emitter<string>());
	readonly onDidStartRun: Event<string> = this._onDidStartRun.event;

	constructor(
		@IWorkflowAgentService private readonly _workflowAgentService: IWorkflowAgentService,
		@IAgentStoreService private readonly _agentStoreService: IAgentStoreService
	) {
		super();
		this._model = this._register(new ComposerModel());
		this._history = this._register(new ComposerHistory());
		this._serializer = new ComposerSerializer();
		this._edgeValidator = new EdgeValidator();
		this._nodeRegistry = new NodeRegistry();
		this._canvasLayout = new CanvasLayout();

		this._register(this._model.onDidChange(() => {
			this._dirty = true;
			this._onDidChangeModel.fire();
		}));
	}

	get isOpen(): boolean { return this._currentWorkflowId !== undefined || this._model.nodes.size > 0; }
	get isDirty(): boolean { return this._dirty; }
	get currentWorkflowId(): string | undefined { return this._currentWorkflowId; }

	async openWorkflow(id: string): Promise<void> {
		const definition = this._workflowAgentService.getWorkflow(id);
		if (!definition) { return; }

		const serialized: ISerializedWorkflow = { definition };
		const model = this._serializer.deserialize(serialized);

		this._model.loadSnapshot(model.getSnapshot());
		this._currentWorkflowId = id;
		this._currentMetadata = { id: definition.id, name: definition.name, description: definition.description };
		this._dirty = false;
		this._history.clear();

		if (this._renderer) { this._renderer.render(); }
		this._refreshAgentPalette();
	}

	createNew(templateId?: string): void {
		this._model.clear();
		this._history.clear();

		if (templateId) {
			this._loadTemplate(templateId);
		} else {
			const triggerNode = this._nodeRegistry.createTriggerNode({ x: 60, y: 200 }, 'manual');
			this._model.addNode(triggerNode);
		}

		this._currentWorkflowId = undefined;
		this._currentMetadata = undefined;
		this._dirty = true;

		if (this._renderer) { this._renderer.render(); }
		this._refreshAgentPalette();
	}

	close(): void {
		this._model.clear();
		this._history.clear();
		this._currentWorkflowId = undefined;
		this._currentMetadata = undefined;
		this._dirty = false;
	}

	async save(): Promise<void> {
		const metadata = this._currentMetadata || {
			id: `workflow-${Date.now().toString(36)}`,
			name: 'Untitled Workflow',
			description: ''
		};
		await this._saveWithMetadata(metadata);
	}

	async saveAs(id: string, name: string): Promise<void> {
		const metadata = { id, name, description: '' };
		await this._saveWithMetadata(metadata);
	}

	async runCurrent(): Promise<string> {
		const metadata = this._currentMetadata || { id: 'temp', name: 'Untitled', description: '' };
		const serialized = this._serializer.serialize(this._model, metadata);
		await this._workflowAgentService.saveWorkflow(serialized.definition);
		const run = await this._workflowAgentService.runWorkflow(serialized.definition.id, '', 'manual');
		this._onDidStartRun.fire(run.id);
		this._showRunPanel(run.id);
		return run.id;
	}

	cancelRun(runId: string): void {
		this._workflowAgentService.cancelRun(runId);
	}

	getModel(): IComposerModelSnapshot {
		return this._model.getSnapshot();
	}

	addNode(type: NodeType, position: { x: number; y: number }, config?: Record<string, unknown>): string {
		const node = this._nodeRegistry.createNode(type, position, config);
		this._history.execute(new AddNodeCommand(node), this._model);
		return node.id;
	}

	removeNode(id: string): void {
		this._history.execute(new RemoveNodeCommand(id), this._model);
	}

	addEdge(sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): string | null {
		const result = this._edgeValidator.canConnect(this._model, sourceNodeId, sourcePortId, targetNodeId, targetPortId);
		if (!result.valid) { return null; }

		const edge: IComposerEdge = {
			id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
			sourceNodeId,
			sourcePortId,
			targetNodeId,
			targetPortId
		};
		this._history.execute(new AddEdgeCommand(edge), this._model);
		return edge.id;
	}

	removeEdge(id: string): void {
		this._history.execute(new RemoveEdgeCommand(id), this._model);
	}

	undo(): void { this._history.undo(this._model); }
	redo(): void { this._history.redo(this._model); }
	canUndo(): boolean { return this._history.canUndo; }
	canRedo(): boolean { return this._history.canRedo; }

	autoLayout(): void {
		this._canvasLayout.autoLayout(this._model, { preserveManualPositions: false });
	}

	zoomToFit(): void {
		const bounds = this._model.getBounds();
		if (bounds && this._canvas) {
			this._canvas.zoomToFit({
				x: bounds.minX,
				y: bounds.minY,
				width: bounds.maxX - bounds.minX,
				height: bounds.maxY - bounds.minY
			});
		}
	}

	validate(): IGraphValidationResult {
		return this._edgeValidator.validateGraph(this._model);
	}

	mount(container: HTMLElement): void {
		if (this._mounted) { this.unmount(); }

		container.style.display = 'flex';
		container.style.flexDirection = 'row';
		container.style.height = '100%';
		container.style.width = '100%';
		container.style.position = 'relative';

		const paletteContainer = document.createElement('div');
		paletteContainer.style.height = '100%';
		paletteContainer.style.flexShrink = '0';
		container.appendChild(paletteContainer);

		const centerArea = document.createElement('div');
		centerArea.style.flex = '1';
		centerArea.style.display = 'flex';
		centerArea.style.flexDirection = 'column';
		centerArea.style.overflow = 'hidden';
		centerArea.style.position = 'relative';

		const toolbar = this._createToolbar();
		centerArea.appendChild(toolbar);

		const canvasContainer = document.createElement('div');
		canvasContainer.style.flex = '1';
		canvasContainer.style.minHeight = '0';
		canvasContainer.style.position = 'relative';
		canvasContainer.style.overflow = 'hidden';
		centerArea.appendChild(canvasContainer);

		const runPanelContainer = document.createElement('div');
		centerArea.appendChild(runPanelContainer);

		container.appendChild(centerArea);

		const propertyContainer = document.createElement('div');
		propertyContainer.style.height = '100%';
		propertyContainer.style.flexShrink = '0';
		container.appendChild(propertyContainer);

		this._canvas = this._register(new WorkflowCanvas());
		this._canvas.mount(canvasContainer);

		this._renderer = this._register(new CanvasRenderer(this._canvas, this._model, this._nodeRegistry));
		this._renderer.render();

		this._interaction = this._register(new CanvasInteraction(
			this._canvas, this._model, this._history, this._renderer, this._nodeRegistry
		));
		this._interaction.attach();

		this._register(this._interaction.onDrop(e => {
			try {
				const data = JSON.parse(e.data);
				const node = this._nodeRegistry.createNode(
					data.nodeType as NodeType,
					{ x: e.canvasX, y: e.canvasY },
					data.configOverrides
				);
				if (data.label) { node.label = data.label; }
				this._history.execute(new AddNodeCommand(node), this._model);
			} catch { /* invalid drop data */ }
		}));

		this._register(this._interaction.onNodeDoubleClick(nodeId => {
			this._model.select([nodeId]);
			if (this._propertyPanel) { this._propertyPanel.refresh(); }
		}));

		this._palette = this._register(new NodePalette(this._nodeRegistry));
		this._palette.mount(paletteContainer);
		this._refreshAgentPalette();

		// Refresh palette whenever agents load or change (they load async after mount)
		this._register(this._agentStoreService.onDidChange(() => {
			this._refreshAgentPalette();
		}));

		this._propertyPanel = this._register(new PropertyPanel(
			this._model, this._history, this._nodeRegistry,
			() => this._getToolNames()
		));
		this._propertyPanel.mount(propertyContainer);

		this._runPanel = this._register(new RunPanel());
		this._runPanel.mount(runPanelContainer);
		this._register(this._runPanel.onCancel(runId => this.cancelRun(runId)));

		this._mounted = true;

		// Start with a blank workflow so the canvas is never empty on first open
		if (this._model.nodes.size === 0) {
			this.createNew();
		}
	}

	unmount(): void {
		if (!this._mounted) { return; }

		if (this._interaction) { this._interaction.detach(); }
		if (this._canvas) { this._canvas.destroy(); }
		if (this._palette) { this._palette.destroy(); }
		if (this._propertyPanel) { this._propertyPanel.destroy(); }
		if (this._runPanel) { this._runPanel.destroy(); }

		this._canvas = null;
		this._renderer = null;
		this._interaction = null;
		this._palette = null;
		this._propertyPanel = null;
		this._runPanel = null;
		this._mounted = false;
	}

	refresh(): void {
		if (!this._canvas || !this._renderer) { return; }
		// Re-measure after the container becomes visible (tab switch restores display)
		this._canvas.updateContainerRect();
		this._renderer.render();
	}

	private async _saveWithMetadata(metadata: { id: string; name: string; description: string }): Promise<void> {
		const serialized = this._serializer.serialize(this._model, metadata);
		await this._workflowAgentService.saveWorkflow(serialized.definition);
		this._currentWorkflowId = metadata.id;
		this._currentMetadata = metadata;
		this._dirty = false;
		this._onDidSave.fire(serialized.definition);
	}

	private _loadTemplate(templateId: string): void {
		const definition = this._workflowAgentService.getWorkflow(templateId);
		if (!definition) { return; }

		const serialized: ISerializedWorkflow = { definition };
		const model = this._serializer.deserialize(serialized);
		this._model.loadSnapshot(model.getSnapshot());
		this._canvasLayout.autoLayout(this._model, { preserveManualPositions: false });
	}

	private _getToolNames(): string[] {
		const workflows = this._workflowAgentService.getWorkflows();
		const toolSet = new Set<string>();
		for (const wf of workflows) {
			for (const step of wf.steps) {
				for (const tool of step.allowedTools) {
					toolSet.add(tool);
				}
			}
		}
		const agents = this._agentStoreService.getAgents();
		for (const agent of agents) {
			for (const tool of agent.allowedTools) {
				toolSet.add(tool);
			}
		}
		return [...toolSet].sort();
	}

	private _refreshAgentPalette(): void {
		if (!this._palette) { return; }
		const agents = this._agentStoreService.getAgents();
		this._palette.setAgents(agents);
	}

	private _showRunPanel(runId: string): void {
		if (!this._runPanel) { return; }

		const run = this._workflowAgentService.getRun(runId);
		if (run) {
			this._runPanel.show(run);
			this._setupRunTracking(runId);
		}
	}

	private _setupRunTracking(runId: string): void {
		const interval = setInterval(() => {
			const run = this._workflowAgentService.getRun(runId);
			if (!run) { clearInterval(interval); return; }

			this._runPanel?.update(run);

			for (const step of run.steps) {
				this._renderer?.setNodeStatus(step.stepId, this._mapStepStatus(step.status));
			}

			if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
				clearInterval(interval);
			}
		}, 500);
	}

	private _mapStepStatus(status: string): 'idle' | 'running' | 'done' | 'failed' | 'skipped' {
		switch (status) {
			case 'running': return 'running';
			case 'done': return 'done';
			case 'failed': return 'failed';
			case 'skipped': return 'skipped';
			default: return 'idle';
		}
	}

	private _createToolbar(): HTMLElement {
		const toolbar = document.createElement('div');
		toolbar.style.display = 'flex';
		toolbar.style.alignItems = 'center';
		toolbar.style.gap = '4px';
		toolbar.style.padding = '6px 12px';
		toolbar.style.borderBottom = '1px solid #333';
		toolbar.style.backgroundColor = '#1e1e1e';
		toolbar.style.flexShrink = '0';

		const buttons: { label: string; action: () => void; separator?: boolean }[] = [
			{ label: 'New', action: () => this.createNew() },
			{ label: 'Save', action: () => this.save() },
			{ label: '|', action: () => {}, separator: true },
			{ label: 'Undo', action: () => this.undo() },
			{ label: 'Redo', action: () => this.redo() },
			{ label: '|', action: () => {}, separator: true },
			{ label: 'Layout', action: () => { this.autoLayout(); if (this._renderer) { this._renderer.render(); } } },
			{ label: 'Fit', action: () => this.zoomToFit() },
			{ label: '|', action: () => {}, separator: true },
			{ label: 'Validate', action: () => { const r = this.validate(); this._showValidation(r); } },
			{ label: 'Run', action: () => this.runCurrent() }
		];

		for (const btn of buttons) {
			if (btn.separator) {
				const sep = document.createElement('div');
				sep.style.width = '1px';
				sep.style.height = '16px';
				sep.style.backgroundColor = '#444';
				sep.style.margin = '0 4px';
				toolbar.appendChild(sep);
				continue;
			}

			const el = document.createElement('button');
			el.textContent = btn.label;
			el.style.padding = '4px 10px';
			el.style.border = 'none';
			el.style.borderRadius = '3px';
			el.style.backgroundColor = btn.label === 'Run' ? '#2d5a3a' : 'transparent';
			el.style.color = btn.label === 'Run' ? '#4ec96e' : '#bbb';
			el.style.fontSize = '11px';
			el.style.cursor = 'pointer';
			el.style.transition = 'background-color 0.1s';
			el.addEventListener('mouseenter', () => { el.style.backgroundColor = btn.label === 'Run' ? '#3a6e4a' : '#2a2a2a'; });
			el.addEventListener('mouseleave', () => { el.style.backgroundColor = btn.label === 'Run' ? '#2d5a3a' : 'transparent'; });
			el.addEventListener('click', btn.action);
			toolbar.appendChild(el);
		}

		return toolbar;
	}

	private _showValidation(result: IGraphValidationResult): void {
		if (result.valid && result.warnings.length === 0) { return; }
		// Validation badges rendered by renderer based on result
		// Future: toast notification for errors
	}
}
