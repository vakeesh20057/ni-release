/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Agent Rollback Service — automatic checkpoint & rollback for autonomous execution.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export interface ICheckpoint {
	id: string;
	label: string;
	threadId: string;
	createdAt: number;
	messageIndex: number;
}

export interface IRollbackEvent {
	checkpointId: string;
	reason: string;
}

export interface IAgentRollbackService {
	readonly _serviceBrand: undefined;

	readonly onDidRollback: Event<IRollbackEvent>;

	createCheckpoint(threadId: string, label: string, messageIndex: number): ICheckpoint;
	rollback(checkpointId: string, reason: string): boolean;
	commitCheckpoint(checkpointId: string): void;
	getCheckpoint(checkpointId: string): ICheckpoint | undefined;
	getCheckpointsForThread(threadId: string): ICheckpoint[];
	getLatestCheckpoint(threadId: string): ICheckpoint | undefined;
}

export const IAgentRollbackService = createDecorator<IAgentRollbackService>('agentRollbackService');

class AgentRollbackService extends Disposable implements IAgentRollbackService {
	readonly _serviceBrand: undefined;

	private _checkpoints = new Map<string, ICheckpoint>();
	private _threadCheckpoints = new Map<string, string[]>(); // threadId -> checkpoint IDs

	private readonly _onDidRollback = this._register(new Emitter<IRollbackEvent>());
	readonly onDidRollback = this._onDidRollback.event;

	createCheckpoint(threadId: string, label: string, messageIndex: number): ICheckpoint {
		const checkpoint: ICheckpoint = {
			id: generateUuid(),
			label,
			threadId,
			createdAt: Date.now(),
			messageIndex,
		};

		this._checkpoints.set(checkpoint.id, checkpoint);

		const threadCps = this._threadCheckpoints.get(threadId) ?? [];
		threadCps.push(checkpoint.id);
		this._threadCheckpoints.set(threadId, threadCps);

		return checkpoint;
	}

	rollback(checkpointId: string, reason: string): boolean {
		const checkpoint = this._checkpoints.get(checkpointId);
		if (!checkpoint) { return false; }

		this._onDidRollback.fire({ checkpointId, reason });

		// Remove all checkpoints after this one for the same thread
		const threadCps = this._threadCheckpoints.get(checkpoint.threadId) ?? [];
		const idx = threadCps.indexOf(checkpointId);
		if (idx >= 0) {
			const removed = threadCps.splice(idx + 1);
			for (const id of removed) {
				this._checkpoints.delete(id);
			}
		}

		return true;
	}

	commitCheckpoint(checkpointId: string): void {
		// Committing means we no longer need to rollback to it — remove it
		const checkpoint = this._checkpoints.get(checkpointId);
		if (!checkpoint) { return; }

		this._checkpoints.delete(checkpointId);
		const threadCps = this._threadCheckpoints.get(checkpoint.threadId);
		if (threadCps) {
			const idx = threadCps.indexOf(checkpointId);
			if (idx >= 0) { threadCps.splice(idx, 1); }
		}
	}

	getCheckpoint(checkpointId: string): ICheckpoint | undefined {
		return this._checkpoints.get(checkpointId);
	}

	getCheckpointsForThread(threadId: string): ICheckpoint[] {
		const ids = this._threadCheckpoints.get(threadId) ?? [];
		return ids.map(id => this._checkpoints.get(id)!).filter(Boolean);
	}

	getLatestCheckpoint(threadId: string): ICheckpoint | undefined {
		const ids = this._threadCheckpoints.get(threadId) ?? [];
		if (ids.length === 0) { return undefined; }
		return this._checkpoints.get(ids[ids.length - 1]);
	}
}

registerSingleton(IAgentRollbackService, AgentRollbackService, InstantiationType.Delayed);
