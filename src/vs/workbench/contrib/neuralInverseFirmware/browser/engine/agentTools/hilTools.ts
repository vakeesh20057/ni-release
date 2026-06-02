/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IHILTestService } from '../hil/hilTestService.js';
import { IHILTestSpec, IHILStimulus, IHILExpectation } from '../hil/hilTypes.js';


export function buildHILTools(hilService: IHILTestService): IVoidInternalTool[] {
	return [
		_fwHilRun(hilService),
		_fwHilDefine(hilService),
		_fwHilList(hilService),
		_fwHilRunSuite(hilService),
	];
}


function _fwHilRun(svc: IHILTestService): IVoidInternalTool {
	return {
		name: 'fw_hil_run',
		description: 'Run a Hardware-in-the-Loop test. Builds, flashes, applies stimulus, observes output, and evaluates pass/fail criteria. Use fw_hil_define to create test specs first, or pass an inline spec.',
		params: {
			test_id: { description: 'ID of a saved test (from .inverse/hil-tests/), OR omit and provide inline spec params below' },
			name: { description: 'Test name (for inline spec)' },
			stimulus: { description: 'JSON array of stimulus actions: [{type: "serial-send"|"wait"|"reset-target", delayMs: 0, params: {data: "..."}}]' },
			expectations: { description: 'JSON array of expectations: [{type: "serial-contains"|"serial-regex"|"no-crash", description: "...", params: {text: "..."}}]' },
			timeout_ms: { description: 'Test timeout in ms (default: 30000)' },
		},
		execute: async (args: Record<string, any>) => {
			if (svc.isRunning) return 'A HIL test is already running.';

			let spec: IHILTestSpec;

			if (args.test_id) {
				const tests = await svc.loadTests();
				const found = tests.find(t => t.id === args.test_id);
				if (!found) return `Test "${args.test_id}" not found. Use fw_hil_list to see available tests.`;
				spec = found;
			} else {
				let stimulus: IHILStimulus[] = [];
				let expectations: IHILExpectation[] = [];
				try {
					stimulus = typeof args.stimulus === 'string' ? JSON.parse(args.stimulus) : (args.stimulus ?? []);
					expectations = typeof args.expectations === 'string' ? JSON.parse(args.expectations) : (args.expectations ?? []);
				} catch {
					return 'Error: stimulus and expectations must be valid JSON arrays.';
				}

				spec = {
					id: `inline-${Date.now()}`,
					name: args.name ?? 'Inline HIL Test',
					buildFirst: true,
					stimulus,
					expectations,
					timeoutMs: Number(args.timeout_ms) || 30000,
					postFlashDelayMs: 2000,
				};
			}

			const result = await svc.runTest(spec);

			const lines = [
				result.passed ? '✓ HIL TEST PASSED' : '✗ HIL TEST FAILED',
				`  Test: ${result.testName}`,
				`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
			];

			if (result.buildResult) {
				lines.push(`  Build: ${result.buildResult.success ? 'OK' : 'FAILED'} (${result.buildResult.durationMs}ms)`);
			}
			if (result.flashResult) {
				lines.push(`  Flash: ${result.flashResult.success ? 'OK' : 'FAILED'} (${result.flashResult.durationMs}ms)`);
			}

			if (result.expectationResults.length > 0) {
				lines.push('', 'Expectations:');
				for (const exp of result.expectationResults) {
					const icon = exp.passed ? '  ✓' : '  ✗';
					lines.push(`${icon} ${exp.description}`);
					if (!exp.passed && exp.message) lines.push(`      ${exp.message}`);
				}
			}

			if (result.failureReason) {
				lines.push('', `Failure: ${result.failureReason}`);
			}

			if (result.serialCapture) {
				const captureLines = result.serialCapture.split('\n');
				const preview = captureLines.slice(0, 20);
				lines.push('', `Serial capture (${captureLines.length} lines):`);
				for (const l of preview) lines.push(`  ${l}`);
				if (captureLines.length > 20) lines.push(`  ... (${captureLines.length - 20} more lines)`);
			}

			return lines.join('\n');
		},
	};
}


function _fwHilDefine(svc: IHILTestService): IVoidInternalTool {
	return {
		name: 'fw_hil_define',
		description: 'Define and save a HIL test specification to .inverse/hil-tests/. The test can then be run repeatedly with fw_hil_run.',
		params: {
			id: { description: 'Unique test ID (kebab-case, e.g. "uart-echo-test")' },
			name: { description: 'Human-readable test name' },
			description: { description: 'What this test verifies' },
			stimulus: { description: 'JSON array of stimulus actions' },
			expectations: { description: 'JSON array of expectations' },
			timeout_ms: { description: 'Test timeout in ms (default: 30000)' },
			post_flash_delay_ms: { description: 'Delay after flash before stimulus (default: 2000)' },
			tags: { description: 'Comma-separated tags for grouping (e.g. "uart,regression")' },
		},
		execute: async (args: Record<string, any>) => {
			const id = args.id as string;
			if (!id) return 'Error: provide a test id.';

			let stimulus: IHILStimulus[] = [];
			let expectations: IHILExpectation[] = [];
			try {
				stimulus = typeof args.stimulus === 'string' ? JSON.parse(args.stimulus) : (args.stimulus ?? []);
				expectations = typeof args.expectations === 'string' ? JSON.parse(args.expectations) : (args.expectations ?? []);
			} catch {
				return 'Error: stimulus and expectations must be valid JSON arrays.';
			}

			const spec: IHILTestSpec = {
				id,
				name: args.name ?? id,
				description: args.description,
				buildFirst: true,
				stimulus,
				expectations,
				timeoutMs: Number(args.timeout_ms) || 30000,
				postFlashDelayMs: Number(args.post_flash_delay_ms) || 2000,
				tags: args.tags ? (args.tags as string).split(',').map((t: string) => t.trim()) : undefined,
			};

			try {
				await svc.saveTest(spec);
				return `✓ HIL test saved: .inverse/hil-tests/${id}.json\n  Name: ${spec.name}\n  Stimulus: ${stimulus.length} action(s)\n  Expectations: ${expectations.length} check(s)\n  Timeout: ${spec.timeoutMs}ms`;
			} catch (err: any) {
				return `Failed to save test: ${err.message ?? String(err)}`;
			}
		},
	};
}


function _fwHilList(svc: IHILTestService): IVoidInternalTool {
	return {
		name: 'fw_hil_list',
		description: 'List all saved HIL test specifications in the project.',
		params: {},
		execute: async () => {
			const tests = await svc.loadTests();
			if (tests.length === 0) return 'No HIL tests defined. Use fw_hil_define to create one.';

			const lines = [`HIL Tests (${tests.length}):`, ''];
			for (const t of tests) {
				lines.push(`  ${t.id} — ${t.name}`);
				if (t.description) lines.push(`    ${t.description}`);
				lines.push(`    Stimulus: ${t.stimulus.length}, Expectations: ${t.expectations.length}, Timeout: ${t.timeoutMs}ms`);
				if (t.tags) lines.push(`    Tags: ${t.tags.join(', ')}`);
				lines.push('');
			}
			return lines.join('\n');
		},
	};
}


function _fwHilRunSuite(svc: IHILTestService): IVoidInternalTool {
	return {
		name: 'fw_hil_run_suite',
		description: 'Run all HIL tests (or filtered by tags). Reports pass/fail summary.',
		params: {
			tags: { description: 'Optional: comma-separated tags to filter (e.g. "uart,regression")' },
		},
		execute: async (args: Record<string, any>) => {
			if (svc.isRunning) return 'A HIL test is already running.';

			const tags = args.tags ? (args.tags as string).split(',').map(t => t.trim()) : undefined;
			const result = await svc.runSuite(tags ? { tags } : undefined);

			const lines = [
				result.passedTests === result.totalTests ? '✓ ALL TESTS PASSED' : '✗ SUITE FAILED',
				`  ${result.passedTests}/${result.totalTests} passed`,
				`  Duration: ${((result.endTime - result.startTime) / 1000).toFixed(1)}s`,
				'',
				'Results:',
			];

			for (const r of result.results) {
				const icon = r.passed ? '  ✓' : '  ✗';
				lines.push(`${icon} ${r.testName} (${(r.durationMs / 1000).toFixed(1)}s)`);
				if (!r.passed && r.failureReason) {
					lines.push(`      ${r.failureReason}`);
				}
			}

			return lines.join('\n');
		},
	};
}
