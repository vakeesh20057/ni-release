/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { ComposerModel, IComposerNode, IComposerEdge, IViewport, NodeType } from './composerModel.js';
import { IWorkflowDefinition, IWorkflowStep, WorkflowTrigger } from '../../../common/workflowTypes.js';
import { EdgeValidator } from '../edges/edgeValidator.js';

export interface IComposerLayout {
	nodes: Record<string, { x: number; y: number; width: number; height: number; collapsed?: boolean }>;
	viewport: IViewport;
}

export interface ISerializedWorkflow {
	definition: IWorkflowDefinition;
	_composerLayout?: IComposerLayout;
}

export class ComposerSerializer {

	private readonly _edgeValidator = new EdgeValidator();

	serialize(model: ComposerModel, metadata: { id: string; name: string; description: string }): ISerializedWorkflow {
		const triggerNode = this._findTriggerNode(model);
		const trigger = this._extractTrigger(triggerNode);
		const steps = this._buildSteps(model);

		const definition: IWorkflowDefinition = {
			id: metadata.id,
			name: metadata.name,
			description: metadata.description,
			trigger: trigger.type,
			triggerGlob: trigger.glob,
			scheduleIntervalMinutes: trigger.scheduleMinutes,
			triggerCommand: trigger.command,
			triggerOnExit: trigger.triggerOnExit,
			steps,
			enabled: true
		};

		this._stripUndefined(definition as unknown as Record<string, unknown>);

		const layout: IComposerLayout = {
			nodes: {},
			viewport: { ...model.viewport }
		};

		for (const node of model.nodes.values()) {
			layout.nodes[node.id] = {
				x: node.position.x,
				y: node.position.y,
				width: node.size.width,
				height: node.size.height,
				collapsed: node.collapsed
			};
		}

		return { definition, _composerLayout: layout };
	}

	deserialize(data: ISerializedWorkflow): ComposerModel {
		const model = new ComposerModel();
		const { definition, _composerLayout: layout } = data;

		const triggerNode = this._createTriggerFromDefinition(definition);
		model.addNode(triggerNode);

		const stepNodeMap = new Map<string, IComposerNode>();
		for (const step of definition.steps) {
			const node = this._createNodeFromStep(step);
			stepNodeMap.set(step.id, node);
			model.addNode(node);
		}

		let edgeCounter = 0;
		const stepsWithNoDeps = definition.steps.filter(s => !s.dependsOn || s.dependsOn.length === 0);
		for (const step of stepsWithNoDeps) {
			const targetNode = stepNodeMap.get(step.id);
			if (targetNode) {
				const edge: IComposerEdge = {
					id: `edge-${(++edgeCounter).toString(36)}`,
					sourceNodeId: triggerNode.id,
					sourcePortId: 'trigger-out',
					targetNodeId: targetNode.id,
					targetPortId: 'agent-in'
				};
				model.addEdge(edge);
			}
		}

		for (const step of definition.steps) {
			if (!step.dependsOn) { continue; }
			const targetNode = stepNodeMap.get(step.id);
			if (!targetNode) { continue; }

			for (const depId of step.dependsOn) {
				const sourceNode = stepNodeMap.get(depId);
				if (!sourceNode) { continue; }

				const edge: IComposerEdge = {
					id: `edge-${(++edgeCounter).toString(36)}`,
					sourceNodeId: sourceNode.id,
					sourcePortId: 'agent-out',
					targetNodeId: targetNode.id,
					targetPortId: 'agent-in'
				};
				model.addEdge(edge);
			}
		}

		if (layout) {
			this._applyLayout(model, layout);
		} else {
			this._applyAutoLayout(model);
		}

		return model;
	}

	roundtripCheck(model: ComposerModel, metadata: { id: string; name: string; description: string }): boolean {
		const serialized = this.serialize(model, metadata);
		const deserialized = this.deserialize(serialized);

		if (model.nodes.size !== deserialized.nodes.size) { return false; }
		if (model.edges.size !== deserialized.edges.size) { return false; }

		const origOrder = this._edgeValidator.getTopologicalOrder(model);
		const newOrder = this._edgeValidator.getTopologicalOrder(deserialized);
		if (!origOrder || !newOrder) { return false; }
		if (origOrder.length !== newOrder.length) { return false; }

		return true;
	}

	private _findTriggerNode(model: ComposerModel): IComposerNode | undefined {
		const triggers = model.getNodesByType('trigger');
		return triggers[0];
	}

	private _extractTrigger(node: IComposerNode | undefined): {
		type: WorkflowTrigger;
		glob?: string;
		scheduleMinutes?: number;
		command?: string;
		triggerOnExit?: 'success' | 'failure' | 'any';
	} {
		if (!node) {
			return { type: 'manual' };
		}

		const config = node.config;
		const type = (config['triggerType'] as WorkflowTrigger) || 'manual';
		return {
			type,
			glob: type === 'file-save' ? config['glob'] as string : undefined,
			scheduleMinutes: type === 'schedule' ? config['scheduleMinutes'] as number : undefined,
			command: type === 'terminal-command' ? config['command'] as string : undefined,
			triggerOnExit: type === 'terminal-command' ? config['triggerOnExit'] as 'success' | 'failure' | 'any' : undefined
		};
	}

	private _buildSteps(model: ComposerModel): IWorkflowStep[] {
		const order = this._edgeValidator.getTopologicalOrder(model);
		if (!order) { return []; }

		const steps: IWorkflowStep[] = [];
		for (const nodeId of order) {
			const node = model.getNode(nodeId);
			if (!node || node.type === 'trigger' || node.type === 'group') { continue; }
			if (!node.enabled) { continue; }

			if (node.type === 'agent') {
				const deps = model.getIncomingEdges(nodeId)
					.map(e => e.sourceNodeId)
					.filter(id => {
						const src = model.getNode(id);
						return src && src.type !== 'trigger';
					});

				steps.push({
					id: nodeId,
					agentId: (node.config['agentId'] as string) || '',
					role: (node.config['role'] as string) || 'executor',
					dependsOn: deps.length > 0 ? deps : undefined,
					allowedTools: (node.config['allowedTools'] as string[]) || [],
					maxIterations: node.config['maxIterations'] as number
				});
			} else if (node.type === 'conditional' || node.type === 'transform' || node.type === 'output') {
				const deps = model.getIncomingEdges(nodeId)
					.map(e => e.sourceNodeId)
					.filter(id => {
						const src = model.getNode(id);
						return src && src.type !== 'trigger';
					});

				steps.push({
					id: nodeId,
					agentId: `__${node.type}__`,
					role: node.type,
					dependsOn: deps.length > 0 ? deps : undefined,
					allowedTools: [],
					maxIterations: 1
				});
			}
		}

		return steps;
	}

	private _createTriggerFromDefinition(def: IWorkflowDefinition): IComposerNode {
		const config: Record<string, unknown> = {
			triggerType: def.trigger,
			glob: def.triggerGlob || '',
			scheduleMinutes: def.scheduleIntervalMinutes || 5,
			command: def.triggerCommand || '',
			triggerOnExit: def.triggerOnExit || 'failure',
			debounceMs: 300
		};

		return {
			id: '__trigger__',
			type: 'trigger' as NodeType,
			label: this._triggerLabel(def.trigger),
			position: { x: 0, y: 0 },
			size: { width: 160, height: 70 },
			config,
			ports: [{ id: 'trigger-out', label: 'Fires', dataType: 'flow', side: 'output' }],
			enabled: true
		};
	}

	private _createNodeFromStep(step: IWorkflowStep): IComposerNode {
		if (step.agentId.startsWith('__') && step.agentId.endsWith('__')) {
			const type = step.agentId.slice(2, -2) as NodeType;
			return {
				id: step.id,
				type,
				label: step.role || type,
				position: { x: 0, y: 0 },
				size: { width: 160, height: 70 },
				config: {},
				ports: this._getDefaultPorts(type),
				enabled: true
			};
		}

		return {
			id: step.id,
			type: 'agent',
			label: step.agentId,
			position: { x: 0, y: 0 },
			size: { width: 180, height: 80 },
			config: {
				agentId: step.agentId,
				role: step.role,
				allowedTools: step.allowedTools,
				maxIterations: step.maxIterations || 20,
				contextMode: 'relevant',
				systemPromptOverride: ''
			},
			ports: [
				{ id: 'agent-in', label: 'Input', dataType: 'flow', side: 'input' },
				{ id: 'agent-out', label: 'Output', dataType: 'text', side: 'output' }
			],
			enabled: true
		};
	}

	private _getDefaultPorts(type: NodeType) {
		switch (type) {
			case 'conditional':
				return [
					{ id: 'cond-in', label: 'Input', dataType: 'any' as const, side: 'input' as const },
					{ id: 'cond-true', label: 'True', dataType: 'flow' as const, side: 'output' as const },
					{ id: 'cond-false', label: 'False', dataType: 'flow' as const, side: 'output' as const }
				];
			case 'transform':
				return [
					{ id: 'xform-in-1', label: 'Input 1', dataType: 'any' as const, side: 'input' as const },
					{ id: 'xform-in-2', label: 'Input 2', dataType: 'any' as const, side: 'input' as const },
					{ id: 'xform-out', label: 'Output', dataType: 'any' as const, side: 'output' as const }
				];
			case 'output':
				return [
					{ id: 'output-in', label: 'Result', dataType: 'any' as const, side: 'input' as const }
				];
			default:
				return [];
		}
	}

	private _applyLayout(model: ComposerModel, layout: IComposerLayout): void {
		for (const [nodeId, pos] of Object.entries(layout.nodes)) {
			const node = model.getNode(nodeId);
			if (node) {
				model.updateNode(nodeId, {
					position: { x: pos.x, y: pos.y },
					size: { width: pos.width, height: pos.height },
					collapsed: pos.collapsed
				});
			}
		}
		model.setViewport(layout.viewport);
	}

	private _applyAutoLayout(model: ComposerModel): void {
		const order = this._edgeValidator.getTopologicalOrder(model);
		if (!order) { return; }

		const layers = this._assignLayers(model, order);
		let y = 60;
		for (const layer of layers) {
			let x = 60;
			for (const nodeId of layer) {
				model.updateNode(nodeId, { position: { x, y } });
				const node = model.getNode(nodeId);
				x += (node?.size.width || 180) + 100;
			}
			y += 140;
		}
	}

	private _assignLayers(model: ComposerModel, order: string[]): string[][] {
		const depth = new Map<string, number>();

		for (const nodeId of order) {
			const incoming = model.getIncomingEdges(nodeId);
			let maxDepth = -1;
			for (const edge of incoming) {
				const parentDepth = depth.get(edge.sourceNodeId) ?? -1;
				maxDepth = Math.max(maxDepth, parentDepth);
			}
			depth.set(nodeId, maxDepth + 1);
		}

		const layers: string[][] = [];
		for (const [nodeId, d] of depth) {
			while (layers.length <= d) { layers.push([]); }
			layers[d].push(nodeId);
		}
		return layers;
	}

	private _triggerLabel(trigger: WorkflowTrigger): string {
		switch (trigger) {
			case 'manual': return 'Manual Trigger';
			case 'file-save': return 'On File Save';
			case 'on-commit': return 'On Commit';
			case 'schedule': return 'Scheduled';
			case 'terminal-command': return 'Terminal Command';
			default: return 'Trigger';
		}
	}

	private _stripUndefined(obj: Record<string, unknown>): void {
		for (const key of Object.keys(obj)) {
			if (obj[key] === undefined) {
				delete obj[key];
			}
		}
	}
}
