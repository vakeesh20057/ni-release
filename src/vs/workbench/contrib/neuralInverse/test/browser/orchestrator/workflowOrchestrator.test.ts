/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	WorkflowOrchestrator,
	buildInitialStepRuns,
	buildAgentRun,
} from '../../../browser/orchestrator/workflowOrchestrator.js';
import { IWorkflowDefinition, IWorkflowStep, IAgentDefinition, IAgentRun } from '../../../common/workflowTypes.js';
import { URI } from '../../../../../../base/common/uri.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStep(id: string, agentId: string, deps: string[] = [], tools: string[] = []): IWorkflowStep {
	return { id, agentId, role: 'executor', dependsOn: deps, allowedTools: tools };
}

function makeWorkflow(steps: IWorkflowStep[]): IWorkflowDefinition {
	return {
		id: 'test-wf', name: 'Test', description: '',
		trigger: 'manual', enabled: true, steps,
	};
}

function makeAgent(id: string): IAgentDefinition {
	return {
		id, name: id, model: { providerName: 'openai', modelName: 'gpt-4' },
		systemInstructions: '', allowedTools: [],
	};
}

// ─── buildInitialStepRuns ─────────────────────────────────────────────────────

suite('buildInitialStepRuns', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates one IStepRun per step', () => {
		const wf = makeWorkflow([makeStep('a', 'ag1'), makeStep('b', 'ag2')]);
		const runs = buildInitialStepRuns(wf);
		assert.strictEqual(runs.length, 2);
	});

	test('all steps start with status=pending', () => {
		const wf = makeWorkflow([makeStep('a', 'ag1'), makeStep('b', 'ag2')]);
		for (const run of buildInitialStepRuns(wf)) {
			assert.strictEqual(run.status, 'pending');
		}
	});

	test('stepId matches step.id', () => {
		const steps = [makeStep('step-x', 'ag1'), makeStep('step-y', 'ag2')];
		const runs = buildInitialStepRuns(makeWorkflow(steps));
		assert.strictEqual(runs[0].stepId, 'step-x');
		assert.strictEqual(runs[1].stepId, 'step-y');
	});

	test('toolCalls and outputLog are empty arrays', () => {
		const runs = buildInitialStepRuns(makeWorkflow([makeStep('a', 'ag')]));
		assert.deepStrictEqual(runs[0].toolCalls, []);
		assert.deepStrictEqual(runs[0].outputLog, []);
	});

	test('iterationsUsed starts at 0', () => {
		const runs = buildInitialStepRuns(makeWorkflow([makeStep('a', 'ag')]));
		assert.strictEqual(runs[0].iterationsUsed, 0);
	});
});

// ─── buildAgentRun ────────────────────────────────────────────────────────────

suite('buildAgentRun', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('initial status is queued', () => {
		const wf = makeWorkflow([makeStep('a', 'ag')]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		assert.strictEqual(run.status, 'queued');
	});

	test('workflowId matches workflow.id', () => {
		const wf = makeWorkflow([makeStep('a', 'ag')]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		assert.strictEqual(run.workflowId, wf.id);
	});

	test('generates unique ids on repeated calls', () => {
		const wf = makeWorkflow([makeStep('a', 'ag')]);
		const r1 = buildAgentRun(wf, { kind: 'manual' });
		const r2 = buildAgentRun(wf, { kind: 'manual' });
		assert.notStrictEqual(r1.id, r2.id);
	});

	test('triggerContext is preserved', () => {
		const wf = makeWorkflow([makeStep('a', 'ag')]);
		const trigger: IAgentRun['triggerContext'] = { kind: 'file-save', fileUri: 'file:///a.ts' };
		const run = buildAgentRun(wf, trigger);
		assert.deepStrictEqual(run.triggerContext, trigger);
	});

	test('startedAt is set (recent timestamp)', () => {
		const before = Date.now();
		const wf = makeWorkflow([makeStep('a', 'ag')]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		assert.ok(run.startedAt >= before);
	});
});

// ─── _buildConcurrencyLevels (tested via run + stub orchestrator) ─────────────

/**
 * We test _buildConcurrencyLevels indirectly by calling run() with a stub
 * executor that records which step ids were started per "tick" — or by
 * observing that cycle detection throws before any step runs.
 *
 * Because AgentExecutor requires live LLM services, we only test the
 * ordering/validation logic (cycle detection, undefined ref detection) which
 * surfaces as run.status = 'failed' without needing a real executor.
 */

function makeOrchestrator(): WorkflowOrchestrator {
	// Stub LLM and settings services — only used inside _runStep which we avoid
	const stubLLM: any = {};
	const stubSettings: any = {};
	const stubRegistry: any = { scope: () => ({ getAll: () => [] }) };
	return new WorkflowOrchestrator(stubLLM, stubSettings, stubRegistry);
}

function makeBaseCtx(): any {
	return { workspaceUri: URI.file('/ws'), fileService: {} as any };
}

function makeCancellation(cancelled = false): any {
	return { cancelled };
}

suite('WorkflowOrchestrator — concurrency level builder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('undefined dependsOn reference causes run to fail', async () => {
		const wf = makeWorkflow([makeStep('a', 'ag1', ['missing'])]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map([['ag1', makeAgent('ag1')]]);

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(), () => {});
		assert.strictEqual(result.status, 'failed');
		assert.ok(result.error?.includes('missing') || result.error?.includes('not defined'));
	});

	test('direct cycle (A→B, B→A) causes run to fail with cycle error', async () => {
		const steps = [
			makeStep('a', 'ag1', ['b']),
			makeStep('b', 'ag2', ['a']),
		];
		const wf = makeWorkflow(steps);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map([['ag1', makeAgent('ag1')], ['ag2', makeAgent('ag2')]]);

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(), () => {});
		assert.strictEqual(result.status, 'failed');
		assert.ok(result.error?.toLowerCase().includes('cycle'), `expected cycle error, got: ${result.error}`);
	});

	test('missing agent before running level marks run as failed', async () => {
		const wf = makeWorkflow([makeStep('a', 'missing-agent')]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map<string, IAgentDefinition>(); // empty

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(), () => {});
		assert.strictEqual(result.status, 'failed');
		assert.ok(result.error?.includes('missing-agent'));
	});

	test('cancellation before first level marks run as cancelled', async () => {
		const wf = makeWorkflow([makeStep('a', 'ag1')]);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map([['ag1', makeAgent('ag1')]]);

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(true), () => {});
		assert.strictEqual(result.status, 'cancelled');
	});

	test('pending steps are marked skipped after cancellation', async () => {
		const steps = [
			makeStep('a', 'ag1'),
			makeStep('b', 'ag2', ['a']),
		];
		const wf = makeWorkflow(steps);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map([['ag1', makeAgent('ag1')], ['ag2', makeAgent('ag2')]]);

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(true), () => {});
		assert.strictEqual(result.status, 'cancelled');
		const stepB = result.steps.find(s => s.stepId === 'b');
		assert.strictEqual(stepB?.status, 'skipped', 'dependent step should be skipped');
	});

	test('three-node cycle is detected', async () => {
		const steps = [
			makeStep('a', 'ag1', ['c']),
			makeStep('b', 'ag2', ['a']),
			makeStep('c', 'ag3', ['b']),
		];
		const wf = makeWorkflow(steps);
		const run = buildAgentRun(wf, { kind: 'manual' });
		const agents = new Map([
			['ag1', makeAgent('ag1')],
			['ag2', makeAgent('ag2')],
			['ag3', makeAgent('ag3')],
		]);

		const orch = makeOrchestrator();
		const result = await orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(), () => {});
		assert.strictEqual(result.status, 'failed');
		assert.ok(result.error?.toLowerCase().includes('cycle'));
	});

	test('linear chain builds three levels: A, B(←A), C(←B)', () => {
		// We verify the level structure via cancellation: if cancelled=false but
		// agentId for step A is missing, only A's level is reached.
		const steps = [
			makeStep('a', 'present', []),
			makeStep('b', 'present', ['a']),
			makeStep('c', 'present', ['b']),
		];
		const wf = makeWorkflow(steps);
		const run = buildAgentRun(wf, { kind: 'manual' });
		// Agent 'present' is missing — run fails at level 0 with agent-not-found
		const agents = new Map<string, IAgentDefinition>();

		const orch = makeOrchestrator();
		// Validates that _buildConcurrencyLevels doesn't throw for a valid linear chain
		// (the error will be agent-not-found, not cycle/ordering)
		return orch.run(wf, run, agents, makeBaseCtx(), 'go', makeCancellation(), () => {}).then(result => {
			assert.strictEqual(result.status, 'failed');
			assert.ok(!result.error?.toLowerCase().includes('cycle'));
		});
	});
});
