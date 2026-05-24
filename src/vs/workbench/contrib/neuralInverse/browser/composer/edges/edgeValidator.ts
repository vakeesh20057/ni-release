/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { ComposerModel, IPortDefinition } from '../model/composerModel.js';

export interface IEdgeValidationResult {
	readonly valid: boolean;
	readonly reason?: string;
}

export interface IGraphValidationResult {
	readonly valid: boolean;
	readonly errors: IGraphValidationError[];
	readonly warnings: IGraphValidationWarning[];
}

export interface IGraphValidationError {
	readonly nodeId?: string;
	readonly edgeId?: string;
	readonly message: string;
	readonly code: EdgeValidationCode;
}

export interface IGraphValidationWarning {
	readonly nodeId?: string;
	readonly message: string;
	readonly code: EdgeValidationCode;
}

export type EdgeValidationCode =
	| 'cycle-detected'
	| 'incompatible-ports'
	| 'self-connection'
	| 'duplicate-edge'
	| 'missing-agent-ref'
	| 'orphan-node'
	| 'no-trigger'
	| 'disconnected-trigger'
	| 'max-fan-in-exceeded';

const PORT_COMPATIBILITY: Record<string, Set<string>> = {
	'flow': new Set(['flow', 'any']),
	'text': new Set(['text', 'any']),
	'json': new Set(['json', 'any', 'text']),
	'any': new Set(['flow', 'text', 'json', 'any'])
};

export class EdgeValidator {

	canConnect(
		model: ComposerModel,
		sourceNodeId: string,
		sourcePortId: string,
		targetNodeId: string,
		targetPortId: string
	): IEdgeValidationResult {
		if (sourceNodeId === targetNodeId) {
			return { valid: false, reason: 'Cannot connect a node to itself' };
		}

		const sourceNode = model.getNode(sourceNodeId);
		const targetNode = model.getNode(targetNodeId);
		if (!sourceNode || !targetNode) {
			return { valid: false, reason: 'Source or target node not found' };
		}

		const sourcePort = sourceNode.ports.find(p => p.id === sourcePortId);
		const targetPort = targetNode.ports.find(p => p.id === targetPortId);
		if (!sourcePort || !targetPort) {
			return { valid: false, reason: 'Port not found' };
		}

		if (sourcePort.side !== 'output') {
			return { valid: false, reason: 'Source must be an output port' };
		}
		if (targetPort.side !== 'input') {
			return { valid: false, reason: 'Target must be an input port' };
		}

		if (!this._isCompatible(sourcePort, targetPort)) {
			return { valid: false, reason: `Incompatible port types: ${sourcePort.dataType} -> ${targetPort.dataType}` };
		}

		for (const edge of model.edges.values()) {
			if (edge.sourceNodeId === sourceNodeId && edge.sourcePortId === sourcePortId &&
				edge.targetNodeId === targetNodeId && edge.targetPortId === targetPortId) {
				return { valid: false, reason: 'Connection already exists' };
			}
		}

		const maxFanIn = this._getMaxFanIn(targetNode.type, targetPortId);
		const currentFanIn = model.getIncomingEdges(targetNodeId)
			.filter(e => e.targetPortId === targetPortId).length;
		if (currentFanIn >= maxFanIn) {
			return { valid: false, reason: `Maximum ${maxFanIn} incoming connection(s) for this port` };
		}

		if (this._wouldCreateCycle(model, sourceNodeId, targetNodeId)) {
			return { valid: false, reason: 'Connection would create a cycle' };
		}

		return { valid: true };
	}

	validateGraph(model: ComposerModel): IGraphValidationResult {
		const errors: IGraphValidationError[] = [];
		const warnings: IGraphValidationWarning[] = [];

		for (const [edgeId, edge] of model.edges) {
			const result = this.canConnect(
				model, edge.sourceNodeId, edge.sourcePortId,
				edge.targetNodeId, edge.targetPortId
			);
			if (!result.valid) {
				errors.push({ edgeId, message: result.reason!, code: 'incompatible-ports' });
			}
		}

		const triggers = model.getNodesByType('trigger');
		if (triggers.length === 0) {
			warnings.push({ message: 'Workflow has no trigger node', code: 'no-trigger' });
		}
		for (const trigger of triggers) {
			const outgoing = model.getOutgoingEdges(trigger.id);
			if (outgoing.length === 0) {
				warnings.push({ nodeId: trigger.id, message: 'Trigger is not connected to any step', code: 'disconnected-trigger' });
			}
		}

		for (const node of model.nodes.values()) {
			if (node.type === 'agent') {
				const agentId = node.config['agentId'] as string;
				if (!agentId) {
					errors.push({ nodeId: node.id, message: `Agent node "${node.label}" has no agent assigned`, code: 'missing-agent-ref' });
				}
			}

			if (node.type !== 'trigger' && node.type !== 'group') {
				const incoming = model.getIncomingEdges(node.id);
				const outgoing = model.getOutgoingEdges(node.id);
				if (incoming.length === 0 && outgoing.length === 0) {
					warnings.push({ nodeId: node.id, message: `Node "${node.label}" is disconnected`, code: 'orphan-node' });
				}
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings
		};
	}

	getTopologicalOrder(model: ComposerModel): string[] | null {
		const inDegree = new Map<string, number>();
		const adjacency = new Map<string, string[]>();

		for (const node of model.nodes.values()) {
			if (node.type === 'group') { continue; }
			inDegree.set(node.id, 0);
			adjacency.set(node.id, []);
		}

		for (const edge of model.edges.values()) {
			const targets = adjacency.get(edge.sourceNodeId);
			if (targets) { targets.push(edge.targetNodeId); }
			inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) || 0) + 1);
		}

		const queue: string[] = [];
		for (const [id, degree] of inDegree) {
			if (degree === 0) { queue.push(id); }
		}

		const sorted: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift()!;
			sorted.push(current);

			for (const neighbor of (adjacency.get(current) || [])) {
				const newDegree = (inDegree.get(neighbor) || 1) - 1;
				inDegree.set(neighbor, newDegree);
				if (newDegree === 0) { queue.push(neighbor); }
			}
		}

		const nonGroupCount = [...model.nodes.values()].filter(n => n.type !== 'group').length;
		if (sorted.length !== nonGroupCount) {
			return null;
		}
		return sorted;
	}

	private _wouldCreateCycle(model: ComposerModel, sourceNodeId: string, targetNodeId: string): boolean {
		const visited = new Set<string>();
		const stack = [sourceNodeId];

		while (stack.length > 0) {
			const current = stack.pop()!;
			if (current === targetNodeId) { continue; }
			if (visited.has(current)) { continue; }
			visited.add(current);

			for (const edge of model.getIncomingEdges(current)) {
				if (edge.sourceNodeId === targetNodeId) { return true; }
				stack.push(edge.sourceNodeId);
			}
		}
		return false;
	}

	private _isCompatible(source: IPortDefinition, target: IPortDefinition): boolean {
		const allowed = PORT_COMPATIBILITY[source.dataType];
		return allowed ? allowed.has(target.dataType) : false;
	}

	private _getMaxFanIn(nodeType: string, _portId: string): number {
		if (nodeType === 'transform') { return 10; }
		if (nodeType === 'output') { return 5; }
		return 1;
	}
}
