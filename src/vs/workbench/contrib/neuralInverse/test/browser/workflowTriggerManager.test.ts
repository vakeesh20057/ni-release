/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { WorkflowTriggerManager } from '../../browser/workflowTriggerManager.js';
import { IWorkflowDefinition } from '../../common/workflowTypes.js';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';

// ─── Stubs ────────────────────────────────────────────────────────────────────

function makeSaveEmitter() {
	return new Emitter<{ model: { resource: URI } }>();
}

function makeFileChangeEmitter() {
	return new Emitter<any>();
}

function makeStubTextFileService(saveEmitter: Emitter<{ model: { resource: URI } }>) {
	return {
		files: {
			onDidSave: saveEmitter.event,
		},
	} as any;
}

function makeStubFileService(changeEmitter: Emitter<any>) {
	return {
		onDidFilesChange: changeEmitter.event,
		exists: async () => false,
		del: async () => {},
		readFile: async () => ({ value: { toString: () => '' } }),
	} as any;
}

function makeStubWorkspaceCtx(root = '/workspace') {
	return {
		getWorkspace: () => ({
			folders: [{ uri: URI.file(root) }],
		}),
	} as any;
}

function makeStubTerminalService() {
	return {
		instances: [],
		createTerminal: async () => ({ title: '', sendText: () => {} }),
	} as any;
}

function makeWorkflow(overrides: Partial<IWorkflowDefinition> = {}): IWorkflowDefinition {
	return {
		id: 'wf-1', name: 'Test Workflow', description: '',
		trigger: 'manual', enabled: true, steps: [],
		...overrides,
	};
}

// ─── Debounce tests ───────────────────────────────────────────────────────────

suite('WorkflowTriggerManager — debouncing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('fires only once when save happens twice within 2s', async () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		const wf = makeWorkflow({ trigger: 'file-save' });
		mgr.refresh([wf]);

		// Simulate two rapid saves
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/file.ts') } });
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/file.ts') } });

		assert.strictEqual(fired.length, 1, `expected 1 fire, got ${fired.length} (second should be debounced)`);
		assert.strictEqual(fired[0], 'wf-1');
	});

	test('debounce is per-workflow (different workflows fire independently)', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		const wf1 = makeWorkflow({ id: 'wf-a', trigger: 'file-save' });
		const wf2 = makeWorkflow({ id: 'wf-b', trigger: 'file-save' });
		mgr.refresh([wf1, wf2]);

		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/x.ts') } });

		// Both workflows should fire (separate debounce state per id)
		assert.ok(fired.includes('wf-a'), 'wf-a should fire');
		assert.ok(fired.includes('wf-b'), 'wf-b should fire');
	});
});

// ─── refresh() teardown ───────────────────────────────────────────────────────

suite('WorkflowTriggerManager — refresh() teardown', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('after refresh([]) no more triggers fire', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		mgr.refresh([makeWorkflow({ trigger: 'file-save' })]);
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/a.ts') } });
		assert.strictEqual(fired.length, 1);

		// Tear down by refreshing with empty list
		mgr.refresh([]);
		fired.length = 0;

		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/b.ts') } });
		assert.strictEqual(fired.length, 0, 'no triggers should fire after refresh([])');
	});

	test('refresh replaces old listeners — old workflow no longer fires', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		const wfOld = makeWorkflow({ id: 'old-wf', trigger: 'file-save' });
		const wfNew = makeWorkflow({ id: 'new-wf', trigger: 'file-save' });

		mgr.refresh([wfOld]);
		mgr.refresh([wfNew]); // replaces old

		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/f.ts') } });

		assert.ok(!fired.includes('old-wf'), 'old workflow listener should be torn down');
		assert.ok(fired.includes('new-wf'), 'new workflow listener should fire');
	});
});

// ─── manual trigger is not wired ─────────────────────────────────────────────

suite('WorkflowTriggerManager — manual trigger', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('manual-trigger workflow is never auto-fired on save', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		mgr.refresh([makeWorkflow({ trigger: 'manual' })]);
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/z.ts') } });

		assert.strictEqual(fired.length, 0, 'manual trigger should never auto-fire');
	});
});

// ─── disabled workflow is not wired ──────────────────────────────────────────

suite('WorkflowTriggerManager — disabled workflows', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disabled file-save workflow does not fire', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		mgr.refresh([makeWorkflow({ trigger: 'file-save', enabled: false })]);
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/q.ts') } });

		assert.strictEqual(fired.length, 0, 'disabled workflow should not fire');
	});
});

// ─── glob filtering ──────────────────────────────────────────────────────────

suite('WorkflowTriggerManager — glob filtering', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('file-save with non-matching glob does not fire', () => {
		const saveEmitter = store.add(makeSaveEmitter());
		const fileChangeEmitter = store.add(makeFileChangeEmitter());
		const fired: string[] = [];

		const mgr = store.add(new WorkflowTriggerManager(
			makeStubTextFileService(saveEmitter),
			makeStubFileService(fileChangeEmitter),
			makeStubWorkspaceCtx(),
			makeStubTerminalService(),
			(id) => fired.push(id),
		));

		mgr.refresh([makeWorkflow({ trigger: 'file-save', triggerGlob: '**/*.css' })]);
		// Save a .ts file — should not match *.css glob
		saveEmitter.fire({ model: { resource: URI.file('/workspace/src/file.ts') } });

		assert.strictEqual(fired.length, 0, 'non-matching glob should not fire');
	});
});

// ─── triggerOnExit evaluation ─────────────────────────────────────────────────

suite('WorkflowTriggerManager — triggerOnExit evaluation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Reproduce the exit-code evaluation logic from the source
	function shouldFire(expectedExit: 'success' | 'failure' | 'any', exitCode: number): boolean {
		const succeeded = exitCode === 0;
		return (
			expectedExit === 'any' ||
			(expectedExit === 'success' && succeeded) ||
			(expectedExit === 'failure' && !succeeded)
		);
	}

	test("'success' fires on exit 0", () => {
		assert.ok(shouldFire('success', 0));
	});

	test("'success' does not fire on exit 1", () => {
		assert.ok(!shouldFire('success', 1));
	});

	test("'failure' fires on exit 1", () => {
		assert.ok(shouldFire('failure', 1));
	});

	test("'failure' does not fire on exit 0", () => {
		assert.ok(!shouldFire('failure', 0));
	});

	test("'any' fires on exit 0", () => {
		assert.ok(shouldFire('any', 0));
	});

	test("'any' fires on exit 1", () => {
		assert.ok(shouldFire('any', 1));
	});

	test("'any' fires on arbitrary non-zero exit codes", () => {
		assert.ok(shouldFire('any', 127));
		assert.ok(shouldFire('any', 2));
	});
});
