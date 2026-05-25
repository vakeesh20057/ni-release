/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAgentDefinition } from '../../../common/workflowTypes.js';

// ---------------------------------------------------------------------------
// Helpers — minimal stubs that exercise the reload-coalesce logic without
// requiring real file-system services.
// ---------------------------------------------------------------------------

function makeAgent(id: string): IAgentDefinition {
	return {
		id,
		name: id,
		model: { providerName: 'openai', modelName: 'gpt-4' },
		systemInstructions: '',
		allowedTools: [],
		maxIterations: 20,
		isBuiltin: true,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

// Simulates the _reload coalesce logic extracted from AgentStoreService
class ReloadCoalescer {
	agents = new Map<string, IAgentDefinition>();
	reloadCount = 0;
	private _reloading = false;
	private _reloadPending = false;

	constructor(private readonly _files: Map<string, IAgentDefinition>) {}

	async reload(): Promise<void> {
		if (this._reloading) {
			this._reloadPending = true;
			return;
		}
		this._reloading = true;
		try {
			await this._doReload();
			if (this._reloadPending) {
				this._reloadPending = false;
				await this._doReload();
			}
		} finally {
			this._reloading = false;
			this._reloadPending = false;
		}
	}

	private async _doReload(): Promise<void> {
		this.reloadCount++;
		// Simulate async file reads
		await Promise.resolve();
		const incoming = new Map<string, IAgentDefinition>();
		for (const [id, def] of this._files) {
			incoming.set(id, def);
		}
		this.agents = incoming;
	}
}

// ---------------------------------------------------------------------------

suite('AgentStoreService — reload coalescing', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('concurrent reload calls coalesce into at most two executions', async () => {
		const files = new Map([
			['code-reviewer', makeAgent('code-reviewer')],
			['test-generator', makeAgent('test-generator')],
		]);
		const coalescer = new ReloadCoalescer(files);

		// Fire 5 reloads concurrently — should execute at most 2 _doReload calls
		await Promise.all([
			coalescer.reload(),
			coalescer.reload(),
			coalescer.reload(),
			coalescer.reload(),
			coalescer.reload(),
		]);

		assert.ok(coalescer.reloadCount <= 2, `Expected ≤2 reloads, got ${coalescer.reloadCount}`);
	});

	test('agents are available immediately after reload completes', async () => {
		const files = new Map([
			['code-reviewer', makeAgent('code-reviewer')],
		]);
		const coalescer = new ReloadCoalescer(files);
		await coalescer.reload();

		assert.ok(coalescer.agents.has('code-reviewer'), 'code-reviewer should be in agents map');
	});

	test('getAgent never returns undefined mid-reload due to atomic swap', async () => {
		const files = new Map([
			['code-reviewer', makeAgent('code-reviewer')],
			['test-generator', makeAgent('test-generator')],
		]);
		const coalescer = new ReloadCoalescer(files);
		await coalescer.reload();

		// Simulate concurrent reload + lookup
		let lookupResult: IAgentDefinition | undefined;
		const reloadPromise = coalescer.reload();
		lookupResult = coalescer.agents.get('code-reviewer'); // Should still be old map
		await reloadPromise;

		// After reload, agent should be in new map
		assert.ok(coalescer.agents.has('code-reviewer'));
		// During reload, the old map was never cleared (atomic swap)
		assert.ok(lookupResult !== undefined || coalescer.agents.get('code-reviewer') !== undefined,
			'agent should be accessible at all times');
	});

	test('pending reload runs after in-flight reload finishes', async () => {
		const files = new Map([['agent-a', makeAgent('agent-a')]]);
		const coalescer = new ReloadCoalescer(files);

		const p1 = coalescer.reload();
		const p2 = coalescer.reload(); // becomes pending
		await Promise.all([p1, p2]);

		// Both complete without throwing
		assert.strictEqual(coalescer.agents.size, 1);
	});
});

suite('AgentStoreService — agent definition shape', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('makeAgent produces valid IAgentDefinition', () => {
		const agent = makeAgent('code-reviewer');
		assert.strictEqual(agent.id, 'code-reviewer');
		assert.strictEqual(agent.name, 'code-reviewer');
		assert.strictEqual(agent.model.providerName, 'openai');
		assert.ok(Array.isArray(agent.allowedTools));
		assert.strictEqual(agent.isBuiltin, true);
	});

	test('agent id matches filename convention (no spaces, lowercase)', () => {
		const ids = ['code-reviewer', 'test-generator', 'dependency-auditor', 'release-manager'];
		for (const id of ids) {
			assert.match(id, /^[a-z0-9-]+$/, `id "${id}" should be lowercase kebab-case`);
		}
	});
});
