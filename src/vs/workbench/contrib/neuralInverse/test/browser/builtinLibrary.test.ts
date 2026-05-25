/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BUILTIN_AGENTS, BUILTIN_WORKFLOWS } from '../../browser/builtinLibrary.js';

suite('BuiltinLibrary — agents', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('all agents have required fields', () => {
		for (const agent of BUILTIN_AGENTS) {
			assert.ok(agent.id, `agent missing id`);
			assert.ok(agent.name, `agent ${agent.id} missing name`);
			assert.ok(agent.systemInstructions, `agent ${agent.id} missing systemInstructions`);
			assert.ok(Array.isArray(agent.allowedTools), `agent ${agent.id} allowedTools should be array`);
			assert.strictEqual(agent.isBuiltin, true, `agent ${agent.id} should be marked isBuiltin`);
		}
	});

	test('agent ids are unique', () => {
		const ids = BUILTIN_AGENTS.map(a => a.id);
		const unique = new Set(ids);
		assert.strictEqual(unique.size, ids.length, 'duplicate agent ids found');
	});

	test('agent ids are valid kebab-case slugs', () => {
		for (const agent of BUILTIN_AGENTS) {
			assert.match(agent.id, /^[a-z0-9-]+$/, `agent id "${agent.id}" must be kebab-case`);
		}
	});

	test('all agents have a model with providerName and modelName', () => {
		for (const agent of BUILTIN_AGENTS) {
			assert.ok(agent.model.providerName, `agent ${agent.id} missing model.providerName`);
			assert.ok(agent.model.modelName, `agent ${agent.id} missing model.modelName`);
		}
	});

	test('all agents have at least one allowed tool', () => {
		for (const agent of BUILTIN_AGENTS) {
			assert.ok(agent.allowedTools.length > 0, `agent ${agent.id} has no allowedTools`);
		}
	});

	test('code-reviewer agent exists and has readFile and gitDiff tools', () => {
		const agent = BUILTIN_AGENTS.find(a => a.id === 'code-reviewer');
		assert.ok(agent, 'code-reviewer agent must exist');
		assert.ok(agent!.allowedTools.includes('readFile'), 'code-reviewer needs readFile');
		assert.ok(agent!.allowedTools.includes('gitDiff'), 'code-reviewer needs gitDiff');
	});

	test('test-generator agent exists', () => {
		const agent = BUILTIN_AGENTS.find(a => a.id === 'test-generator');
		assert.ok(agent, 'test-generator agent must exist');
	});

	test('security-auditor agent exists', () => {
		const agent = BUILTIN_AGENTS.find(a => a.id === 'security-auditor');
		assert.ok(agent, 'security-auditor agent must exist');
	});

	test('all agents have systemInstructions longer than 50 chars', () => {
		for (const agent of BUILTIN_AGENTS) {
			assert.ok(agent.systemInstructions.length > 50,
				`agent ${agent.id} systemInstructions too short (${agent.systemInstructions.length} chars)`);
		}
	});
});

suite('BuiltinLibrary — workflows', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('all workflows have required fields', () => {
		for (const wf of BUILTIN_WORKFLOWS) {
			assert.ok(wf.id, `workflow missing id`);
			assert.ok(wf.name, `workflow ${wf.id} missing name`);
			assert.ok(Array.isArray(wf.steps), `workflow ${wf.id} steps should be array`);
			assert.ok(wf.steps.length > 0, `workflow ${wf.id} has no steps`);
			assert.strictEqual(wf.enabled, true, `workflow ${wf.id} should be enabled by default`);
		}
	});

	test('workflow ids are unique', () => {
		const ids = BUILTIN_WORKFLOWS.map(w => w.id);
		const unique = new Set(ids);
		assert.strictEqual(unique.size, ids.length, 'duplicate workflow ids found');
	});

	test('workflow steps reference agents that exist in BUILTIN_AGENTS', () => {
		const agentIds = new Set(BUILTIN_AGENTS.map(a => a.id));
		for (const wf of BUILTIN_WORKFLOWS) {
			for (const step of wf.steps) {
				assert.ok(agentIds.has(step.agentId),
					`workflow ${wf.id}, step ${step.id} references unknown agentId "${step.agentId}"`);
			}
		}
	});

	test('workflow step dependsOn references exist within same workflow', () => {
		for (const wf of BUILTIN_WORKFLOWS) {
			const stepIds = new Set(wf.steps.map(s => s.id));
			for (const step of wf.steps) {
				for (const dep of (step.dependsOn ?? [])) {
					assert.ok(stepIds.has(dep),
						`workflow ${wf.id}, step ${step.id} depends on unknown step "${dep}"`);
				}
			}
		}
	});

	test('no circular step dependencies in any workflow', () => {
		for (const wf of BUILTIN_WORKFLOWS) {
			const deps = new Map<string, string[]>();
			for (const step of wf.steps) {
				deps.set(step.id, step.dependsOn ?? []);
			}

			// DFS cycle detection
			const visited = new Set<string>();
			const inStack = new Set<string>();

			function dfs(id: string): boolean {
				if (inStack.has(id)) { return true; } // cycle
				if (visited.has(id)) { return false; }
				visited.add(id);
				inStack.add(id);
				for (const dep of (deps.get(id) ?? [])) {
					if (dfs(dep)) { return true; }
				}
				inStack.delete(id);
				return false;
			}

			for (const step of wf.steps) {
				assert.ok(!dfs(step.id), `workflow ${wf.id} has circular dependency involving step ${step.id}`);
			}
		}
	});

	test('all workflow steps have required fields', () => {
		for (const wf of BUILTIN_WORKFLOWS) {
			for (const step of wf.steps) {
				assert.ok(step.id, `workflow ${wf.id} step missing id`);
				assert.ok(step.agentId, `workflow ${wf.id}, step ${step.id} missing agentId`);
				assert.ok(step.role, `workflow ${wf.id}, step ${step.id} missing role`);
				assert.ok(Array.isArray(step.allowedTools), `workflow ${wf.id}, step ${step.id} allowedTools must be array`);
			}
		}
	});

	test('workflow triggers are valid WorkflowTrigger values', () => {
		const valid = new Set(['manual', 'file-save', 'schedule', 'on-commit', 'terminal-command']);
		for (const wf of BUILTIN_WORKFLOWS) {
			assert.ok(valid.has(wf.trigger), `workflow ${wf.id} has invalid trigger "${wf.trigger}"`);
		}
	});
});
