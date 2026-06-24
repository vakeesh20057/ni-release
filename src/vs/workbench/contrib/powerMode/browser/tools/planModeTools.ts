/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan Mode transition tools for Power Mode.
 *
 * Enables BUILD agents to enter plan mode mid-conversation (read-only research),
 * draft a plan, and then exit back to full-access build mode.
 */

import { IPowerTool, IToolContext, IToolResult } from '../../common/powerModeTypes.js';
import { definePowerTool } from './powerToolRegistry.js';

// ─── enter_plan_mode: Switch to read-only planning mode ────────────────────

export function createEnterPlanModeTool(): IPowerTool {
	return definePowerTool(
		'enter_plan_mode',
		`Enter plan mode to switch to read-only research and planning.

Use this when you need to:
- Research the codebase before making changes
- Design an implementation approach
- Explore patterns and architecture
- Draft a concrete plan before coding

In plan mode:
- Only read-only tools are available (read, grep, list, glob)
- No file modifications allowed
- Use exit_plan_mode when your plan is ready`,
		[],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			ctx.metadata({ title: 'Entering plan mode' });

			return {
				title: 'Entered plan mode',
				output: 'You are now in read-only research mode. Explore the codebase, understand patterns, and design your approach. Use exit_plan_mode when your plan is ready.',
				metadata: { planMode: true },
			};
		},
	);
}

// ─── exit_plan_mode: Present plan and return to build mode ─────────────────

export function createExitPlanModeTool(): IPowerTool {
	return definePowerTool(
		'exit_plan_mode',
		`Exit plan mode and return to full-access build mode.

Present your implementation plan and resume access to write/edit/bash tools.

Your plan should include:
- Overview of the approach
- Key files to modify
- Step-by-step implementation strategy
- Potential risks or edge cases
- Testing approach`,
		[
			{ name: 'plan', type: 'string', description: 'The implementation plan you have drafted', required: true },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const plan = args.plan as string;

			ctx.metadata({ title: 'Exiting plan mode' });

			return {
				title: 'Exited plan mode',
				output: `Plan recorded. You now have full tool access restored.

Your plan:
${plan}

You can now proceed with implementation.`,
				metadata: { planMode: false, plan },
			};
		},
	);
}
