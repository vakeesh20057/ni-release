/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  .neuralinverseagent project configuration schema.
 *--------------------------------------------------------------------------------------*/

import { ApprovalTier } from './neuralInverseAgentTypes.js';

/**
 * Schema for `.neuralinverseagent` project-level configuration file.
 *
 * Example:
 * ```json
 * {
 *   "approvalTiers": {
 *     "edit_file": "auto",
 *     "run_command": "notify"
 *   },
 *   "context": {
 *     "alwaysInclude": ["src/types/**", "docs/architecture.md"],
 *     "ignore": ["node_modules", "dist", ".git"]
 *   },
 *   "constraints": {
 *     "maxIterations": 50,
 *     "maxConcurrentSubAgents": 3,
 *     "allowedCommands": ["npm test", "npm run build"]
 *   },
 *   "memory": {
 *     "persistSession": true,
 *     "maxTokenBudget": 32000
 *   }
 * }
 * ```
 */
export interface NeuralInverseAgentConfig {
	/** Per-tool approval tier overrides */
	approvalTiers?: Record<string, ApprovalTier>;

	/** Context gathering configuration */
	context?: {
		/** Glob patterns for files to always include in agent context */
		alwaysInclude?: string[];
		/** Glob patterns for files to exclude from agent scanning */
		ignore?: string[];
	};

	/** Execution constraints */
	constraints?: {
		/** Max LLM iterations per task (default: 50) */
		maxIterations?: number;
		/** Max concurrent sub-agents (default: 3) */
		maxConcurrentSubAgents?: number;
		/** Whitelist of allowed terminal commands (empty = allow all) */
		allowedCommands?: string[];
		/** Blacklist of blocked terminal commands */
		blockedCommands?: string[];
	};

	/** Working memory settings */
	memory?: {
		/** Persist session memory to `.neural-inverse/agent-memory.json` */
		persistSession?: boolean;
		/** Max token budget for working memory (default: 32000) */
		maxTokenBudget?: number;
	};
}

export const DEFAULT_AGENT_CONFIG: Required<NeuralInverseAgentConfig> = {
	approvalTiers: {},
	context: {
		alwaysInclude: [],
		ignore: ['node_modules', 'dist', '.git', '*.lock'],
	},
	constraints: {
		maxIterations: 50,
		maxConcurrentSubAgents: 3,
		allowedCommands: [],
		blockedCommands: [],
	},
	memory: {
		persistSession: false,
		maxTokenBudget: 32_000,
	},
};

export const AGENT_CONFIG_FILENAME = '.neuralinverseagent';
