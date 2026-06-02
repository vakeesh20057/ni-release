/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RTOS Debug Service
 *
 * Provides RTOS-aware debugging by parsing kernel data structures from target RAM.
 * Supports FreeRTOS, Zephyr, and ThreadX.
 *
 * Implementation reads RTOS internal structs via GDB/OpenOCD memory read commands:
 *  - FreeRTOS: pxCurrentTCB, xReadyTasksLists, xDelayedTaskList, xSuspendedTaskList
 *  - Zephyr: _kernel.threads, _kernel.ready_q, k_heap
 *  - ThreadX: _tx_thread_created_ptr, _tx_byte_pool_created_ptr
 *
 * The service detects which RTOS is in use from the firmware session's project info
 * or from symbol inspection (presence of vTaskSwitchContext, z_thread_create, etc.).
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IFirmwareSessionService } from '../../firmwareSessionService.js';
import { IFirmwareDebugService } from '../debug/debugService.js';
import {
	RTOSType,
	IRTOSThreadInfo,
	IRTOSHeapInfo,
	IRTOSSyncPrimitive,
	IRTOSTimerInfo,
	IRTOSSnapshot,
	RTOSThreadState,
} from './rtosTypes.js';


export const IRTOSDebugService = createDecorator<IRTOSDebugService>('rtosDebugService');

export interface IRTOSDebugService {
	readonly _serviceBrand: undefined;

	readonly detectedRTOS: RTOSType;
	readonly onSnapshotUpdated: Event<IRTOSSnapshot>;

	/** Detect which RTOS is running (from symbols or project config). */
	detect(): Promise<RTOSType>;

	/** Take a snapshot of all RTOS state (threads, heap, sync primitives). */
	snapshot(): Promise<IRTOSSnapshot>;

	/** Get thread list. */
	getThreads(): Promise<IRTOSThreadInfo[]>;

	/** Get heap statistics. */
	getHeap(): Promise<IRTOSHeapInfo | undefined>;

	/** Get synchronization primitives (mutexes, semaphores, queues). */
	getSyncPrimitives(): Promise<IRTOSSyncPrimitive[]>;

	/** Get software timers. */
	getTimers(): Promise<IRTOSTimerInfo[]>;

	/** Get RTOS tick count. */
	getTickCount(): Promise<number>;
}


class RTOSDebugServiceImpl extends Disposable implements IRTOSDebugService {
	readonly _serviceBrand: undefined;

	private _detectedRTOS: RTOSType = 'none';

	private readonly _onSnapshotUpdated = this._register(new Emitter<IRTOSSnapshot>());
	readonly onSnapshotUpdated = this._onSnapshotUpdated.event;

	get detectedRTOS(): RTOSType { return this._detectedRTOS; }

	constructor(
		@IFirmwareSessionService private readonly _session: IFirmwareSessionService,
		@IFirmwareDebugService private readonly _debug: IFirmwareDebugService,
	) {
		super();
	}

	async detect(): Promise<RTOSType> {
		// 1. Check project info
		const rtos = this._session.session.projectInfo?.rtos?.toLowerCase();
		if (rtos) {
			if (rtos.includes('freertos')) this._detectedRTOS = 'freertos';
			else if (rtos.includes('zephyr')) this._detectedRTOS = 'zephyr';
			else if (rtos.includes('threadx')) this._detectedRTOS = 'threadx';
			else if (rtos.includes('rt-thread') || rtos.includes('rtthread')) this._detectedRTOS = 'rtthread';
			else if (rtos.includes('chibios')) this._detectedRTOS = 'chibios';
			return this._detectedRTOS;
		}

		// 2. Check symbols via GDB 'info address' command
		if (this._debug.state.clientConnected) {
			const freertosCheck = await this._debug.sendCommand('info address pxCurrentTCB');
			if (freertosCheck.output && !freertosCheck.output.includes('No symbol')) {
				this._detectedRTOS = 'freertos';
				return this._detectedRTOS;
			}
			const zephyrCheck = await this._debug.sendCommand('info address _kernel');
			if (zephyrCheck.output && !zephyrCheck.output.includes('No symbol')) {
				this._detectedRTOS = 'zephyr';
				return this._detectedRTOS;
			}
			const threadxCheck = await this._debug.sendCommand('info address _tx_thread_created_ptr');
			if (threadxCheck.output && !threadxCheck.output.includes('No symbol')) {
				this._detectedRTOS = 'threadx';
				return this._detectedRTOS;
			}
		}

		this._detectedRTOS = 'none';
		return this._detectedRTOS;
	}

	/** Read a GDB variable value via 'print' command. Returns numeric value or undefined. */
	private async _readVar(expr: string): Promise<number | undefined> {
		if (!this._debug.state.clientConnected) return undefined;
		const resp = await this._debug.sendCommand(`print/d ${expr}`);
		const match = resp.output?.match(/=\s*(\d+)/);
		return match ? parseInt(match[1], 10) : undefined;
	}

	/** Read a string variable via 'print' command. */
	private async _readString(expr: string): Promise<string | undefined> {
		if (!this._debug.state.clientConnected) return undefined;
		const resp = await this._debug.sendCommand(`print (char*)${expr}`);
		const match = resp.output?.match(/"([^"]*)"/);
		return match ? match[1] : undefined;
	}

	async snapshot(): Promise<IRTOSSnapshot> {
		if (this._detectedRTOS === 'none') {
			await this.detect();
		}

		const [threads, heap, syncPrimitives, timers, tickCount] = await Promise.all([
			this.getThreads(),
			this.getHeap(),
			this.getSyncPrimitives(),
			this.getTimers(),
			this.getTickCount(),
		]);

		const snap: IRTOSSnapshot = {
			rtosType: this._detectedRTOS,
			timestamp: Date.now(),
			threads,
			heap,
			syncPrimitives,
			timers,
			tickCount,
		};

		this._onSnapshotUpdated.fire(snap);
		return snap;
	}

	async getThreads(): Promise<IRTOSThreadInfo[]> {
		switch (this._detectedRTOS) {
			case 'freertos': return this._getFreeRTOSThreads();
			case 'zephyr': return this._getZephyrThreads();
			case 'threadx': return this._getThreadXThreads();
			default: return [];
		}
	}

	async getHeap(): Promise<IRTOSHeapInfo | undefined> {
		switch (this._detectedRTOS) {
			case 'freertos': return this._getFreeRTOSHeap();
			case 'zephyr': return this._getZephyrHeap();
			case 'threadx': return this._getThreadXHeap();
			default: return undefined;
		}
	}

	async getSyncPrimitives(): Promise<IRTOSSyncPrimitive[]> {
		switch (this._detectedRTOS) {
			case 'freertos': return this._getFreeRTOSSyncPrimitives();
			case 'zephyr': return this._getZephyrSyncPrimitives();
			default: return [];
		}
	}

	async getTimers(): Promise<IRTOSTimerInfo[]> {
		switch (this._detectedRTOS) {
			case 'freertos': return this._getFreeRTOSTimers();
			default: return [];
		}
	}

	async getTickCount(): Promise<number> {
		switch (this._detectedRTOS) {
			case 'freertos': {
				const val = await this._readVar('xTickCount');
				return val ?? 0;
			}
			case 'zephyr': {
				const val = await this._readVar('_kernel.ticks');
				return val ?? 0;
			}
			default: return 0;
		}
	}

	// ─── FreeRTOS ────────────────────────────────────────────────────────────

	private async _getFreeRTOSThreads(): Promise<IRTOSThreadInfo[]> {
		const threads: IRTOSThreadInfo[] = [];

		// Read current task name and priority
		const currentName = await this._readString('pxCurrentTCB->pcTaskName');
		const currentPriority = await this._readVar('pxCurrentTCB->uxPriority');
		const currentStack = await this._readVar('(uint32_t)pxCurrentTCB->pxStack');
		const currentId = await this._readVar('pxCurrentTCB->uxTCBNumber');

		if (currentName !== undefined) {
			threads.push({
				id: currentId ?? 0,
				name: currentName ?? 'current',
				state: 'running',
				priority: currentPriority ?? 0,
				stackBase: currentStack ?? 0,
				stackSize: 0,
				stackUsed: 0,
				stackHighWaterMark: 0,
			});
		}

		const taskCount = await this._readVar('uxCurrentNumberOfTasks') ?? 0;
		if (taskCount > 1) {
			const readyTasks = await this._enumerateFreeRTOSList('xReadyTasksLists[0]', 'ready');
			const delayedTasks = await this._enumerateFreeRTOSList('xDelayedTaskList1', 'blocked');
			const suspendedTasks = await this._enumerateFreeRTOSList('xSuspendedTaskList', 'suspended');
			threads.push(...readyTasks, ...delayedTasks, ...suspendedTasks);
		}

		return threads;
	}

	private async _enumerateFreeRTOSList(listExpr: string, state: RTOSThreadState): Promise<IRTOSThreadInfo[]> {
		const tasks: IRTOSThreadInfo[] = [];
		const itemCount = await this._readVar(`${listExpr}.uxNumberOfItems`);
		if (!itemCount || itemCount === 0) return tasks;

		let itemPtr = await this._readVar(`(uint32_t)${listExpr}.xListEnd.pxNext`);
		const endPtr = await this._readVar(`(uint32_t)&${listExpr}.xListEnd`);

		let count = 0;
		while (itemPtr && itemPtr !== endPtr && count < Math.min(itemCount, 32)) {
			const ownerPtr = await this._readVar(`(uint32_t)((ListItem_t*)${itemPtr})->pvOwner`);
			if (ownerPtr) {
				const name = await this._readString(`((TCB_t*)${ownerPtr})->pcTaskName`);
				const priority = await this._readVar(`((TCB_t*)${ownerPtr})->uxPriority`);
				const stackBase = await this._readVar(`(uint32_t)((TCB_t*)${ownerPtr})->pxStack`);
				const tcbNum = await this._readVar(`((TCB_t*)${ownerPtr})->uxTCBNumber`);

				tasks.push({
					id: tcbNum ?? count,
					name: name ?? `task_${count}`,
					state,
					priority: priority ?? 0,
					stackBase: stackBase ?? 0,
					stackSize: 0,
					stackUsed: 0,
					stackHighWaterMark: 0,
				});
			}

			itemPtr = await this._readVar(`(uint32_t)((ListItem_t*)${itemPtr})->pxNext`);
			count++;
		}

		return tasks;
	}

	private async _getFreeRTOSHeap(): Promise<IRTOSHeapInfo | undefined> {
		const freeSize = await this._readVar('xFreeBytesRemaining');
		const minEverFree = await this._readVar('xMinimumEverFreeBytesRemaining');

		if (freeSize === undefined) return undefined;

		const totalSize = await this._readVar('configTOTAL_HEAP_SIZE') ?? 0;
		return {
			totalSize,
			freeSize,
			usedSize: totalSize - freeSize,
			minimumEverFree: minEverFree ?? 0,
			allocCount: 0,
			freeCount: 0,
			largestFreeBlock: 0,
		};
	}

	private async _getFreeRTOSSyncPrimitives(): Promise<IRTOSSyncPrimitive[]> {
		const prims: IRTOSSyncPrimitive[] = [];

		const registrySize = await this._readVar('configQUEUE_REGISTRY_SIZE');
		if (!registrySize || registrySize === 0) return prims;

		for (let i = 0; i < Math.min(registrySize, 16); i++) {
			const name = await this._readString(`xQueueRegistry[${i}].pcQueueName`);
			if (!name) continue;

			const queuePtr = await this._readVar(`(uint32_t)xQueueRegistry[${i}].xHandle`);
			if (!queuePtr) continue;

			const msgWaiting = await this._readVar(`((Queue_t*)${queuePtr})->uxMessagesWaiting`);
			const queueLength = await this._readVar(`((Queue_t*)${queuePtr})->uxLength`);
			const queueType = await this._readVar(`((Queue_t*)${queuePtr})->ucQueueType`);

			const type: IRTOSSyncPrimitive['type'] = queueType === 1 ? 'mutex'
				: queueType === 2 ? 'semaphore' : 'queue';

			prims.push({
				type,
				name,
				value: type === 'mutex'
					? (msgWaiting === 0 ? 'locked' : 'free')
					: `${msgWaiting ?? 0}/${queueLength ?? 0}`,
				waiters: [],
			});
		}

		return prims;
	}

	private async _getFreeRTOSTimers(): Promise<IRTOSTimerInfo[]> {
		const timers: IRTOSTimerInfo[] = [];

		const activeListCount = await this._readVar('xActiveTimerList1.uxNumberOfItems');
		if (!activeListCount) return timers;

		let itemPtr = await this._readVar('(uint32_t)xActiveTimerList1.xListEnd.pxNext');
		const endPtr = await this._readVar('(uint32_t)&xActiveTimerList1.xListEnd');

		let count = 0;
		while (itemPtr && itemPtr !== endPtr && count < 16) {
			const ownerPtr = await this._readVar(`(uint32_t)((ListItem_t*)${itemPtr})->pvOwner`);
			if (ownerPtr) {
				const name = await this._readString(`((Timer_t*)${ownerPtr})->pcTimerName`);
				const period = await this._readVar(`((Timer_t*)${ownerPtr})->xTimerPeriodInTicks`);
				const autoReload = await this._readVar(`((Timer_t*)${ownerPtr})->ucAutoReload`);

				if (name) {
					timers.push({
						name,
						periodTicks: period ?? 0,
						isAutoReload: (autoReload ?? 0) !== 0,
						isActive: true,
					});
				}
			}

			itemPtr = await this._readVar(`(uint32_t)((ListItem_t*)${itemPtr})->pxNext`);
			count++;
		}

		return timers;
	}

	// ─── Zephyr ──────────────────────────────────────────────────────────────

	private async _getZephyrThreads(): Promise<IRTOSThreadInfo[]> {
		const threads: IRTOSThreadInfo[] = [];

		// Zephyr stores threads in a singly-linked list starting at _kernel.threads
		const firstThreadAddr = await this._readVar('(uint32_t)_kernel.threads');
		if (!firstThreadAddr) return threads;

		let threadAddr = firstThreadAddr;
		let count = 0;
		while (threadAddr && threadAddr !== 0 && count < 64) {
			const name = await this._readString(`((struct k_thread*)${threadAddr})->name`);
			const prio = await this._readVar(`((struct k_thread*)${threadAddr})->base.prio`);
			const stackStart = await this._readVar(`((struct k_thread*)${threadAddr})->stack_info.start`);
			const stackSize = await this._readVar(`((struct k_thread*)${threadAddr})->stack_info.size`);
			const state = await this._readVar(`((struct k_thread*)${threadAddr})->base.thread_state`);
			const nextThread = await this._readVar(`(uint32_t)((struct k_thread*)${threadAddr})->next_thread`);

			threads.push({
				id: count,
				name: name ?? `thread_${count}`,
				state: this._zephyrStateToState(state ?? 0),
				priority: prio ?? 0,
				stackBase: stackStart ?? 0,
				stackSize: stackSize ?? 0,
				stackUsed: 0,
				stackHighWaterMark: 0,
			});

			threadAddr = nextThread ?? 0;
			count++;
		}

		return threads;
	}

	private _zephyrStateToState(state: number): RTOSThreadState {
		// Zephyr thread states: _THREAD_DUMMY=0, _THREAD_PENDING=1, _THREAD_PRESTART=2,
		// _THREAD_DEAD=4, _THREAD_SUSPENDED=8, _THREAD_QUEUED=128
		if (state & 0x01) return 'blocked';
		if (state & 0x04) return 'deleted';
		if (state & 0x08) return 'suspended';
		if (state & 0x80) return 'ready';
		return 'running';
	}

	private async _getZephyrHeap(): Promise<IRTOSHeapInfo | undefined> {
		// Zephyr uses sys_heap or k_heap depending on config
		return undefined;
	}

	private async _getZephyrSyncPrimitives(): Promise<IRTOSSyncPrimitive[]> {
		const prims: IRTOSSyncPrimitive[] = [];

		const mutexPtr = await this._readVar('(uint32_t)_kernel.mutex_list');
		if (mutexPtr) {
			let ptr = mutexPtr;
			let count = 0;
			while (ptr && ptr !== 0 && count < 16) {
				const ownerPtr = await this._readVar(`(uint32_t)((struct k_mutex*)${ptr})->owner`);
				const ownerName = ownerPtr ? await this._readString(`((struct k_thread*)${ownerPtr})->name`) : undefined;
				const lockCount = await this._readVar(`((struct k_mutex*)${ptr})->lock_count`);

				prims.push({
					type: 'mutex',
					name: `mutex_${count}`,
					value: lockCount && lockCount > 0 ? `locked(${lockCount}) by ${ownerName ?? 'unknown'}` : 'free',
					waiters: [],
				});

				ptr = await this._readVar(`(uint32_t)((struct k_mutex*)${ptr})->_node.next`) ?? 0;
				count++;
			}
		}

		return prims;
	}

	// ─── ThreadX ─────────────────────────────────────────────────────────────

	private async _getThreadXThreads(): Promise<IRTOSThreadInfo[]> {
		const threads: IRTOSThreadInfo[] = [];

		const firstThreadAddr = await this._readVar('(uint32_t)_tx_thread_created_ptr');
		if (!firstThreadAddr) return threads;

		let threadAddr = firstThreadAddr;
		let count = 0;
		do {
			const name = await this._readString(`((TX_THREAD*)${threadAddr})->tx_thread_name`);
			const priority = await this._readVar(`((TX_THREAD*)${threadAddr})->tx_thread_priority`);
			const state = await this._readVar(`((TX_THREAD*)${threadAddr})->tx_thread_state`);
			const stackStart = await this._readVar(`(uint32_t)((TX_THREAD*)${threadAddr})->tx_thread_stack_start`);
			const stackSize = await this._readVar(`((TX_THREAD*)${threadAddr})->tx_thread_stack_size`);
			const nextAddr = await this._readVar(`(uint32_t)((TX_THREAD*)${threadAddr})->tx_thread_created_next`);

			threads.push({
				id: count,
				name: name ?? `thread_${count}`,
				state: this._threadxStateToState(state ?? 0),
				priority: priority ?? 0,
				stackBase: stackStart ?? 0,
				stackSize: stackSize ?? 0,
				stackUsed: 0,
				stackHighWaterMark: 0,
			});

			threadAddr = nextAddr ?? 0;
			count++;
		} while (threadAddr !== firstThreadAddr && threadAddr !== 0 && count < 64);

		return threads;
	}

	private _threadxStateToState(state: number): RTOSThreadState {
		// TX_READY=0, TX_COMPLETED=1, TX_TERMINATED=2, TX_SUSPENDED=3,
		// TX_SLEEP=4, TX_QUEUE_SUSP=5, TX_SEMAPHORE_SUSP=6, TX_EVENT_FLAG=7,
		// TX_BLOCK_MEMORY=8, TX_BYTE_MEMORY=9, TX_MUTEX_SUSP=13
		switch (state) {
			case 0: return 'ready';
			case 1: case 2: return 'deleted';
			case 3: return 'suspended';
			default: return 'blocked';
		}
	}

	private async _getThreadXHeap(): Promise<IRTOSHeapInfo | undefined> {
		const poolAddr = await this._readVar('(uint32_t)_tx_byte_pool_created_ptr');
		if (!poolAddr) return undefined;

		const available = await this._readVar(`((TX_BYTE_POOL*)${poolAddr})->tx_byte_pool_available`);
		const totalSize = await this._readVar(`((TX_BYTE_POOL*)${poolAddr})->tx_byte_pool_size`);
		const fragments = await this._readVar(`((TX_BYTE_POOL*)${poolAddr})->tx_byte_pool_fragments`);

		if (totalSize === undefined) return undefined;

		return {
			totalSize,
			freeSize: available ?? 0,
			usedSize: totalSize - (available ?? 0),
			minimumEverFree: 0,
			allocCount: fragments ?? 0,
			freeCount: 0,
			largestFreeBlock: 0,
		};
	}
}

registerSingleton(IRTOSDebugService, RTOSDebugServiceImpl, InstantiationType.Delayed);
