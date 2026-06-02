/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoidInternalTool } from '../../../../void/browser/voidInternalToolService.js';
import { IRTOSDebugService } from '../rtos/rtosDebugService.js';


export function buildRTOSTools(rtosService: IRTOSDebugService): IVoidInternalTool[] {
	return [
		_fwRtosDetect(rtosService),
		_fwRtosThreads(rtosService),
		_fwRtosHeap(rtosService),
		_fwRtosSync(rtosService),
		_fwRtosSnapshot(rtosService),
	];
}


function _fwRtosDetect(svc: IRTOSDebugService): IVoidInternalTool {
	return {
		name: 'fw_rtos_detect',
		description: 'Detect which RTOS is running on the target (FreeRTOS, Zephyr, ThreadX, RT-Thread, ChibiOS). Uses project config and GDB symbol inspection.',
		params: {},
		execute: async () => {
			const rtos = await svc.detect();
			if (rtos === 'none') {
				return 'No RTOS detected. The target appears to be running bare-metal firmware, or the debugger is not connected.';
			}
			return `Detected RTOS: ${rtos}\nUse fw_rtos_threads, fw_rtos_heap, fw_rtos_sync for live kernel state.`;
		},
	};
}


function _fwRtosThreads(svc: IRTOSDebugService): IVoidInternalTool {
	return {
		name: 'fw_rtos_threads',
		description: 'List all RTOS threads/tasks with state, priority, and stack usage. Requires debug connection to target.',
		params: {},
		execute: async () => {
			if (svc.detectedRTOS === 'none') {
				const detected = await svc.detect();
				if (detected === 'none') return 'No RTOS detected. Connect debugger and ensure RTOS symbols are present.';
			}

			const threads = await svc.getThreads();
			if (threads.length === 0) return 'No threads found. Is the debugger connected and target halted?';

			const lines = [`RTOS Threads (${svc.detectedRTOS}) — ${threads.length} task(s):`, ''];
			lines.push('  ID  State       Pri  Name                Stack Used');
			lines.push('  ─── ─────────── ──── ─────────────────── ──────────');

			for (const t of threads) {
				const stateStr = t.state.padEnd(11);
				const nameStr = t.name.padEnd(19);
				const stackStr = t.stackSize > 0
					? `${t.stackUsed}/${t.stackSize} (${((t.stackUsed / t.stackSize) * 100).toFixed(0)}%)`
					: 'n/a';
				lines.push(`  ${String(t.id).padEnd(3)} ${stateStr} ${String(t.priority).padEnd(4)} ${nameStr} ${stackStr}`);
			}

			return lines.join('\n');
		},
	};
}


function _fwRtosHeap(svc: IRTOSDebugService): IVoidInternalTool {
	return {
		name: 'fw_rtos_heap',
		description: 'Get RTOS heap statistics (total, free, used, minimum ever free, largest free block).',
		params: {},
		execute: async () => {
			const heap = await svc.getHeap();
			if (!heap) return 'Heap information not available. RTOS may not use dynamic allocation, or debugger is not connected.';

			const lines = [
				'RTOS Heap Statistics:',
				`  Total:          ${heap.totalSize} bytes (${(heap.totalSize / 1024).toFixed(1)} KB)`,
				`  Used:           ${heap.usedSize} bytes (${((heap.usedSize / heap.totalSize) * 100).toFixed(1)}%)`,
				`  Free:           ${heap.freeSize} bytes`,
				`  Min ever free:  ${heap.minimumEverFree} bytes`,
				`  Largest block:  ${heap.largestFreeBlock} bytes`,
			];

			if (heap.freeSize < heap.totalSize * 0.1) {
				lines.push('', '⚠ WARNING: Less than 10% heap remaining. Risk of allocation failure.');
			}

			return lines.join('\n');
		},
	};
}


function _fwRtosSync(svc: IRTOSDebugService): IVoidInternalTool {
	return {
		name: 'fw_rtos_sync',
		description: 'List RTOS synchronization primitives (mutexes, semaphores, queues, event groups) and their current state.',
		params: {},
		execute: async () => {
			const prims = await svc.getSyncPrimitives();
			if (prims.length === 0) return 'No synchronization primitives found (or registry not enabled in RTOS config).';

			const lines = [`Sync Primitives (${prims.length}):`, ''];
			for (const p of prims) {
				lines.push(`  [${p.type}] ${p.name}: ${p.value}`);
				if (p.waiters.length > 0) {
					lines.push(`    Waiters: ${p.waiters.join(', ')}`);
				}
			}
			return lines.join('\n');
		},
	};
}


function _fwRtosSnapshot(svc: IRTOSDebugService): IVoidInternalTool {
	return {
		name: 'fw_rtos_snapshot',
		description: 'Take a full RTOS state snapshot (threads + heap + sync primitives + timers + tick count). Use for debugging deadlocks or priority inversions.',
		params: {},
		execute: async () => {
			const snap = await svc.snapshot();

			if (snap.rtosType === 'none') return 'No RTOS detected.';

			const lines = [
				`RTOS Snapshot — ${snap.rtosType}`,
				`  Tick count: ${snap.tickCount}`,
				`  Threads: ${snap.threads.length}`,
				`  Sync primitives: ${snap.syncPrimitives.length}`,
				`  Timers: ${snap.timers.length}`,
			];

			if (snap.heap) {
				lines.push(`  Heap: ${snap.heap.usedSize}/${snap.heap.totalSize} bytes used (${((snap.heap.usedSize / snap.heap.totalSize) * 100).toFixed(1)}%)`);
			}

			// Detect potential issues
			const highPriBlocked = snap.threads.filter(t => t.state === 'blocked' && t.priority <= 2);
			if (highPriBlocked.length > 0) {
				lines.push('', '⚠ High-priority threads blocked:');
				for (const t of highPriBlocked) {
					lines.push(`    ${t.name} (pri=${t.priority})`);
				}
				lines.push('  → Possible priority inversion. Check mutex holders.');
			}

			return lines.join('\n');
		},
	};
}
