/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { NodeType, IPortDefinition, IComposerNode } from '../model/composerModel.js';

export interface INodeTypeDefinition {
	readonly type: NodeType;
	readonly label: string;
	readonly description: string;
	readonly category: 'trigger' | 'agent' | 'logic' | 'output';
	readonly color: string;
	readonly icon: string;
	readonly defaultSize: { width: number; height: number };
	readonly ports: IPortDefinition[];
	readonly defaultConfig: Record<string, unknown>;
	readonly configSchema: INodeConfigField[];
}

export interface INodeConfigField {
	readonly key: string;
	readonly label: string;
	readonly type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'textarea' | 'tools';
	readonly description?: string;
	readonly defaultValue?: unknown;
	readonly options?: { label: string; value: string }[];
	readonly required?: boolean;
	readonly visibleWhen?: { field: string; value: unknown };
}

const TRIGGER_PORTS: IPortDefinition[] = [
	{ id: 'trigger-out', label: 'Fires', dataType: 'flow', side: 'output' }
];

const AGENT_PORTS: IPortDefinition[] = [
	{ id: 'agent-in', label: 'Input', dataType: 'flow', side: 'input' },
	{ id: 'agent-out', label: 'Output', dataType: 'text', side: 'output' }
];

const CONDITIONAL_PORTS: IPortDefinition[] = [
	{ id: 'cond-in', label: 'Input', dataType: 'any', side: 'input' },
	{ id: 'cond-true', label: 'True', dataType: 'flow', side: 'output' },
	{ id: 'cond-false', label: 'False', dataType: 'flow', side: 'output' }
];

const TRANSFORM_PORTS: IPortDefinition[] = [
	{ id: 'xform-in-1', label: 'Input 1', dataType: 'any', side: 'input' },
	{ id: 'xform-in-2', label: 'Input 2', dataType: 'any', side: 'input' },
	{ id: 'xform-out', label: 'Output', dataType: 'any', side: 'output' }
];

const OUTPUT_PORTS: IPortDefinition[] = [
	{ id: 'output-in', label: 'Result', dataType: 'any', side: 'input' }
];

const NODE_TYPE_DEFINITIONS: INodeTypeDefinition[] = [
	{
		type: 'trigger',
		label: 'Trigger',
		description: 'Event that starts the workflow',
		category: 'trigger',
		color: '#e0a84e',
		icon: 'zap',
		defaultSize: { width: 160, height: 70 },
		ports: TRIGGER_PORTS,
		defaultConfig: {
			triggerType: 'manual',
			glob: '',
			scheduleMinutes: 5,
			command: '',
			triggerOnExit: 'failure',
			debounceMs: 300
		},
		configSchema: [
			{
				key: 'triggerType', label: 'Event', type: 'select', required: true,
				options: [
					{ label: 'Manual', value: 'manual' },
					{ label: 'File Save', value: 'file-save' },
					{ label: 'On Commit', value: 'on-commit' },
					{ label: 'Schedule', value: 'schedule' },
					{ label: 'Terminal Command', value: 'terminal-command' }
				]
			},
			{ key: 'glob', label: 'File Glob', type: 'string', description: 'e.g. src/**/*.ts', visibleWhen: { field: 'triggerType', value: 'file-save' } },
			{ key: 'debounceMs', label: 'Debounce (ms)', type: 'number', defaultValue: 300, visibleWhen: { field: 'triggerType', value: 'file-save' } },
			{ key: 'scheduleMinutes', label: 'Interval (minutes)', type: 'number', defaultValue: 5, visibleWhen: { field: 'triggerType', value: 'schedule' } },
			{ key: 'command', label: 'Command', type: 'string', description: 'Shell command to poll', visibleWhen: { field: 'triggerType', value: 'terminal-command' } },
			{
				key: 'triggerOnExit', label: 'Fire On', type: 'select', visibleWhen: { field: 'triggerType', value: 'terminal-command' },
				options: [
					{ label: 'Failure (non-zero exit)', value: 'failure' },
					{ label: 'Success (exit 0)', value: 'success' },
					{ label: 'Any exit', value: 'any' }
				]
			},
			{ key: 'branchFilter', label: 'Branch Filter', type: 'string', description: 'Regex for branch name', visibleWhen: { field: 'triggerType', value: 'on-commit' } },
			{ key: 'pathFilter', label: 'Path Filter', type: 'string', description: 'Glob for committed files', visibleWhen: { field: 'triggerType', value: 'on-commit' } }
		]
	},
	{
		type: 'agent',
		label: 'Agent',
		description: 'LLM-powered agent step',
		category: 'agent',
		color: '#6ba3e8',
		icon: 'bot',
		defaultSize: { width: 180, height: 80 },
		ports: AGENT_PORTS,
		defaultConfig: {
			agentId: '',
			role: 'executor',
			allowedTools: [] as string[],
			maxIterations: 20,
			contextMode: 'relevant',
			systemPromptOverride: ''
		},
		configSchema: [
			{ key: 'agentId', label: 'Agent', type: 'select', required: true, options: [] },
			{
				key: 'role', label: 'Role', type: 'select',
				options: [
					{ label: 'Planner', value: 'planner' },
					{ label: 'Executor', value: 'executor' },
					{ label: 'Validator', value: 'validator' },
					{ label: 'Reviewer', value: 'reviewer' }
				]
			},
			{ key: 'allowedTools', label: 'Allowed Tools', type: 'tools' },
			{ key: 'maxIterations', label: 'Max Iterations', type: 'number', defaultValue: 20 },
			{
				key: 'contextMode', label: 'Context Mode', type: 'select',
				options: [
					{ label: 'Full workspace', value: 'full' },
					{ label: 'Relevant files', value: 'relevant' },
					{ label: 'Minimal', value: 'minimal' }
				]
			},
			{ key: 'systemPromptOverride', label: 'System Prompt Override', type: 'textarea' }
		]
	},
	{
		type: 'conditional',
		label: 'Condition',
		description: 'Branch workflow based on output',
		category: 'logic',
		color: '#c085e8',
		icon: 'git-branch',
		defaultSize: { width: 140, height: 70 },
		ports: CONDITIONAL_PORTS,
		defaultConfig: {
			expression: '',
			operator: 'contains',
			operand: ''
		},
		configSchema: [
			{ key: 'expression', label: 'Check Output', type: 'string', description: 'JSONPath into previous step output' },
			{
				key: 'operator', label: 'Operator', type: 'select',
				options: [
					{ label: 'Contains', value: 'contains' },
					{ label: 'Equals', value: 'equals' },
					{ label: 'Not Equals', value: 'not-equals' },
					{ label: 'Matches Regex', value: 'regex' },
					{ label: 'Is Empty', value: 'is-empty' },
					{ label: 'Is Not Empty', value: 'is-not-empty' }
				]
			},
			{ key: 'operand', label: 'Value', type: 'string' }
		]
	},
	{
		type: 'transform',
		label: 'Transform',
		description: 'Combine or reshape step outputs',
		category: 'logic',
		color: '#85c9a8',
		icon: 'combine',
		defaultSize: { width: 160, height: 70 },
		ports: TRANSFORM_PORTS,
		defaultConfig: {
			transformType: 'merge',
			template: ''
		},
		configSchema: [
			{
				key: 'transformType', label: 'Type', type: 'select',
				options: [
					{ label: 'Merge (concatenate)', value: 'merge' },
					{ label: 'Template', value: 'template' },
					{ label: 'First Non-Empty', value: 'first-non-empty' },
					{ label: 'JSON Extract', value: 'json-extract' }
				]
			},
			{ key: 'template', label: 'Template', type: 'textarea', description: 'Use {{input1}} and {{input2}} placeholders', visibleWhen: { field: 'transformType', value: 'template' } },
			{ key: 'jsonPath', label: 'JSON Path', type: 'string', visibleWhen: { field: 'transformType', value: 'json-extract' } }
		]
	},
	{
		type: 'output',
		label: 'Output',
		description: 'Final workflow output',
		category: 'output',
		color: '#e87585',
		icon: 'output',
		defaultSize: { width: 140, height: 60 },
		ports: OUTPUT_PORTS,
		defaultConfig: {
			outputFormat: 'raw',
			label: 'Result'
		},
		configSchema: [
			{
				key: 'outputFormat', label: 'Format', type: 'select',
				options: [
					{ label: 'Raw text', value: 'raw' },
					{ label: 'Markdown', value: 'markdown' },
					{ label: 'JSON', value: 'json' }
				]
			},
			{ key: 'label', label: 'Output Label', type: 'string' }
		]
	},
	{
		type: 'group',
		label: 'Group',
		description: 'Visual container for organizing nodes',
		category: 'logic',
		color: '#8a8a8a',
		icon: 'group',
		defaultSize: { width: 400, height: 300 },
		ports: [],
		defaultConfig: {
			collapsed: false
		},
		configSchema: [
			{ key: 'collapsed', label: 'Collapsed', type: 'boolean' }
		]
	}
];

let _idCounter = 0;

function generateNodeId(type: NodeType): string {
	return `${type}-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}

export class NodeRegistry {

	private readonly _definitions: ReadonlyMap<NodeType, INodeTypeDefinition>;

	constructor() {
		const map = new Map<NodeType, INodeTypeDefinition>();
		for (const def of NODE_TYPE_DEFINITIONS) {
			map.set(def.type, def);
		}
		this._definitions = map;
	}

	getDefinition(type: NodeType): INodeTypeDefinition | undefined {
		return this._definitions.get(type);
	}

	getAllDefinitions(): INodeTypeDefinition[] {
		return NODE_TYPE_DEFINITIONS;
	}

	getByCategory(category: INodeTypeDefinition['category']): INodeTypeDefinition[] {
		return NODE_TYPE_DEFINITIONS.filter(d => d.category === category);
	}

	createNode(type: NodeType, position: { x: number; y: number }, configOverrides?: Record<string, unknown>): IComposerNode {
		const def = this._definitions.get(type);
		if (!def) { throw new Error(`Unknown node type: ${type}`); }

		return {
			id: generateNodeId(type),
			type,
			label: def.label,
			position: { ...position },
			size: { ...def.defaultSize },
			config: { ...def.defaultConfig, ...configOverrides },
			ports: [...def.ports],
			enabled: true
		};
	}

	createAgentNode(position: { x: number; y: number }, agentId: string, agentName: string, allowedTools: string[]): IComposerNode {
		const node = this.createNode('agent', position, { agentId, allowedTools });
		node.label = agentName;
		return node;
	}

	createTriggerNode(position: { x: number; y: number }, triggerType: string): IComposerNode {
		const node = this.createNode('trigger', position, { triggerType });
		node.label = triggerType === 'manual' ? 'Manual Trigger' :
			triggerType === 'file-save' ? 'On File Save' :
			triggerType === 'on-commit' ? 'On Commit' :
			triggerType === 'schedule' ? 'Scheduled' :
			triggerType === 'terminal-command' ? 'Terminal Command' : 'Trigger';
		return node;
	}
}
