/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IClosedLoopService } from '../closedLoop/closedLoopService.js';
import { IPassCriterion, ObserveChannel, DEFAULT_CLOSED_LOOP_CONFIG } from '../closedLoop/closedLoopTypes.js';


export function buildClosedLoopTools(closedLoop: IClosedLoopService): IVoidInternalTool[] {
	return [
		_fwClosedLoop(closedLoop),
		_fwClosedLoopStatus(closedLoop),
		_fwClosedLoopAbort(closedLoop),
	];
}


function _fwClosedLoop(svc: IClosedLoopService): IVoidInternalTool {
	return {
		name: 'fw_closed_loop',
		description: 'Start an autonomous build → flash → observe → diagnose → fix loop. The loop iterates until all pass criteria are met or max iterations reached. This is the main autonomous firmware development command.',
		params: {
			goal: { description: 'What the firmware should achieve (e.g. "Blink LED on PA5 at 1Hz", "Print Hello over UART at 115200 baud")' },
			pass_criteria: { description: 'JSON array of pass criteria objects. Each: {type: "serial-contains"|"serial-regex"|"serial-not-contains"|"no-build-errors", value: string, description?: string}' },
			max_iterations: { description: 'Maximum build/flash/observe cycles (default: 10)' },
			observe_channel: { description: 'Observation channel: "serial", "rtt", "itm" (default: "serial")' },
		},
		execute: async (args: Record<string, any>) => {
			const goal = args.goal as string;
			if (!goal) return 'Error: provide a goal description.';

			if (svc.isRunning) return 'A closed-loop session is already running. Use fw_closed_loop_abort to stop it first.';

			let passCriteria: IPassCriterion[];
			try {
				const raw = typeof args.pass_criteria === 'string' ? JSON.parse(args.pass_criteria) : args.pass_criteria;
				passCriteria = Array.isArray(raw) ? raw : [{ type: 'no-build-errors', value: '' }];
			} catch {
				passCriteria = [{ type: 'no-build-errors', value: '', description: 'Build compiles without errors' }];
			}

			const maxIterations = Number(args.max_iterations) || DEFAULT_CLOSED_LOOP_CONFIG.maxIterations;
			const observeChannel = (args.observe_channel as ObserveChannel) || 'serial';

			const result = await svc.start({
				goal,
				passCriteria,
				maxIterations,
				timeoutMs: DEFAULT_CLOSED_LOOP_CONFIG.timeoutMs,
				observeChannels: [observeChannel],
				autoFix: true,
			});

			const lines = [
				result.success ? '✓ CLOSED-LOOP SUCCEEDED' : '✗ CLOSED-LOOP FAILED',
				`  Goal: ${goal}`,
				`  Iterations: ${result.iterations.length}`,
				`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
			];

			if (result.failureReason) {
				lines.push(`  Reason: ${result.failureReason}`);
			}

			lines.push('', 'Iteration Summary:');
			for (const iter of result.iterations) {
				const status = iter.passCriteriaMet.every(Boolean) ? '✓' : '✗';
				lines.push(`  ${status} #${iter.index}: ${iter.phase} — ${iter.diagnosis ?? 'pass'}`);
			}

			return lines.join('\n');
		},
	};
}


function _fwClosedLoopStatus(svc: IClosedLoopService): IVoidInternalTool {
	return {
		name: 'fw_closed_loop_status',
		description: 'Get the status of the running closed-loop session.',
		params: {},
		execute: async () => {
			if (!svc.isRunning) return 'No closed-loop session is currently running.';
			return `Closed-loop running — iteration ${svc.currentIteration}.`;
		},
	};
}


function _fwClosedLoopAbort(svc: IClosedLoopService): IVoidInternalTool {
	return {
		name: 'fw_closed_loop_abort',
		description: 'Abort the running closed-loop session.',
		params: {},
		execute: async () => {
			if (!svc.isRunning) return 'No closed-loop session to abort.';
			svc.abort();
			return 'Closed-loop abort requested. Current iteration will complete before stopping.';
		},
	};
}
