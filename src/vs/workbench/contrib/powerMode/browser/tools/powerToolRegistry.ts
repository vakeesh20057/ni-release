/*---------------------------------------------------------------------------------------------
 *  Original: MIT License - Copyright (c) SST (opencode)
 *  Modified: Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Power Tool Registry
 *
 * Central registry for all tool implementations available to Power Mode agents.
 * Modeled after OpenCode's ToolRegistry namespace.
 *
 * Tools are registered at service startup. Each agent session gets access to
 * the full registry, filtered by the agent's permission rules.
 */

import { IPowerTool, IPowerPermissions, IToolContext, IToolResult } from '../../common/powerModeTypes.js';

export class PowerToolRegistry {

	private readonly _tools = new Map<string, IPowerTool>();

	register(tool: IPowerTool): void {
		this._tools.set(tool.id, tool);
	}

	registerMany(tools: IPowerTool[]): void {
		for (const tool of tools) {
			this.register(tool);
		}
	}

	get(id: string): IPowerTool | undefined {
		return this._tools.get(id);
	}

	getAll(): IPowerTool[] {
		return [...this._tools.values()];
	}

	has(id: string): boolean {
		return this._tools.has(id);
	}

	/**
	 * Returns a filtered list of tools based on the agent's permissions.
	 * Tools with 'deny' are excluded. Tools with 'ask' are included but
	 * will trigger approval flow at execution time.
	 */
	forAgent(permissions: IPowerPermissions): IPowerTool[] {
		const wildcard = permissions.tools['*'] ?? 'allow';

		return this.getAll().filter(tool => {
			const perm = permissions.tools[tool.id] ?? wildcard;
			return perm !== 'deny';
		});
	}

	/**
	 * Check if a tool call requires approval based on agent permissions.
	 */
	requiresApproval(toolId: string, permissions: IPowerPermissions): boolean {
		const wildcard = permissions.tools['*'] ?? 'allow';
		const perm = permissions.tools[toolId] ?? wildcard;
		return perm === 'ask';
	}

	/**
	 * Build the tool description schema for LLM tool-use.
	 * Returns the format expected by Vercel AI SDK / OpenAI function calling.
	 */
	buildToolSchemas(tools: IPowerTool[]): Record<string, { description: string; parameters: Record<string, any> }> {
		const schemas: Record<string, { description: string; parameters: Record<string, any> }> = {};
		for (const tool of tools) {
			const properties: Record<string, any> = {};
			const required: string[] = [];

			for (const param of tool.parameters) {
				properties[param.name] = {
					type: param.type,
					description: param.description,
				};
				if (param.required) {
					required.push(param.name);
				}
			}

			schemas[tool.id] = {
				description: tool.description,
				parameters: {
					type: 'object',
					properties,
					required,
				},
			};
		}
		return schemas;
	}
}

/**
 * Helper to define a tool with the IPowerTool interface.
 * Mirrors OpenCode's Tool.define() pattern.
 */
export function definePowerTool(
	id: string,
	description: string,
	parameters: IPowerTool['parameters'],
	execute: (args: Record<string, any>, ctx: IToolContext) => Promise<IToolResult>,
): IPowerTool {
	return { id, description, parameters, execute };
}
