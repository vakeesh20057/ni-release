/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Power Mode Change Tracker
 *
 * Tracks all file changes (write, edit) made by Power Mode and sub-agents.
 * Enables review and rollback functionality.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export interface IFileChange {
	readonly id: string;
	readonly filePath: string;
	readonly fileUri: URI;
	readonly changeType: 'write' | 'edit' | 'delete';
	readonly sessionId: string;
	readonly agentId?: string;
	readonly timestamp: number;
	readonly contentBefore: string | null; // null for new files
	readonly contentAfter: string;
	readonly linesAdded: number;
	readonly linesRemoved: number;
	superseded: boolean; // true if a newer change to this file exists
}

export interface IChangeGroup {
	readonly sessionId: string;
	readonly agentId?: string;
	readonly timestamp: number;
	readonly changes: IFileChange[];
}

export interface IPowerModeChangeTracker {
	readonly _serviceBrand: undefined;

	/** Track a file change before it happens */
	trackChange(params: {
		filePath: string;
		changeType: 'write' | 'edit' | 'delete';
		sessionId: string;
		agentId?: string;
	}): Promise<string>; // Returns change ID

	/** Finalize a change after it's complete */
	finalizeChange(changeId: string, contentAfter: string): Promise<void>;

	/** Get all changes for a session */
	getChangesForSession(sessionId: string): IFileChange[];

	/** Get all changes for an agent */
	getChangesForAgent(agentId: string): IFileChange[];

	/** Get the latest change group (for "press r to review") */
	getLatestChangeGroup(): IChangeGroup | null;

	/** Rollback a specific change */
	rollbackChange(changeId: string): Promise<boolean>;

	/** Rollback all changes in a group */
	rollbackGroup(sessionId: string, agentId?: string): Promise<number>; // Returns count of rolled back files

	/** Clear old change history */
	clearHistory(): void;

	/** Event fired when changes are made */
	readonly onDidChange: Event<IFileChange>;
}

export class PowerModeChangeTracker extends Disposable implements IPowerModeChangeTracker {
	readonly _serviceBrand: undefined;

	private readonly _changes = new Map<string, IFileChange>();
	private _changeCounter = 0;

	private readonly _onDidChange = this._register(new Emitter<IFileChange>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		private readonly fileService: IFileService,
	) {
		super();
	}

	async trackChange(params: {
		filePath: string;
		changeType: 'write' | 'edit' | 'delete';
		sessionId: string;
		agentId?: string;
	}): Promise<string> {
		const changeId = `change_${Date.now()}_${++this._changeCounter}`;
		const fileUri = URI.file(params.filePath);

		// Read current content (if file exists)
		let contentBefore: string | null = null;
		try {
			const fileContent = await this.fileService.readFile(fileUri);
			contentBefore = fileContent.value.toString();
		} catch {
			// File doesn't exist yet (new file)
			contentBefore = null;
		}

		// Mark all previous changes to this file as superseded
		for (const change of this._changes.values()) {
			if (change.filePath === params.filePath && !change.superseded) {
				change.superseded = true;
			}
		}

		const change: IFileChange = {
			id: changeId,
			filePath: params.filePath,
			fileUri,
			changeType: params.changeType,
			sessionId: params.sessionId,
			agentId: params.agentId,
			timestamp: Date.now(),
			contentBefore,
			contentAfter: '', // Will be set in finalizeChange
			linesAdded: 0,
			linesRemoved: 0,
			superseded: false,
		};

		this._changes.set(changeId, change);
		return changeId;
	}

	async finalizeChange(changeId: string, contentAfter: string): Promise<void> {
		const change = this._changes.get(changeId);
		if (!change) {
			return;
		}

		// Calculate line changes
		const beforeLines = change.contentBefore?.split('\n') || [];
		const afterLines = contentAfter.split('\n');

		// Simple line diff (not a full diff algorithm, but good enough)
		const added = afterLines.length - beforeLines.length;
		const removed = beforeLines.length > afterLines.length ? beforeLines.length - afterLines.length : 0;

		(change as any).contentAfter = contentAfter;
		(change as any).linesAdded = Math.max(0, added);
		(change as any).linesRemoved = removed;

		this._onDidChange.fire(change);
	}

	getChangesForSession(sessionId: string): IFileChange[] {
		return Array.from(this._changes.values())
			.filter(c => c.sessionId === sessionId)
			.sort((a, b) => b.timestamp - a.timestamp);
	}

	getChangesForAgent(agentId: string): IFileChange[] {
		return Array.from(this._changes.values())
			.filter(c => c.agentId === agentId)
			.sort((a, b) => b.timestamp - a.timestamp);
	}

	getLatestChangeGroup(): IChangeGroup | null {
		const allChanges = Array.from(this._changes.values())
			.sort((a, b) => b.timestamp - a.timestamp);

		if (allChanges.length === 0) {
			return null;
		}

		// Group by session + agent (changes made in the same session/agent context)
		const latest = allChanges[0];
		const groupChanges = allChanges.filter(c =>
			c.sessionId === latest.sessionId &&
			c.agentId === latest.agentId &&
			Math.abs(c.timestamp - latest.timestamp) < 60000 // Within 1 minute
		);

		return {
			sessionId: latest.sessionId,
			agentId: latest.agentId,
			timestamp: latest.timestamp,
			changes: groupChanges,
		};
	}

	async rollbackChange(changeId: string): Promise<boolean> {
		const change = this._changes.get(changeId);
		if (!change) {
			return false;
		}

		// Can only rollback if not superseded
		if (change.superseded) {
			return false;
		}

		try {
			if (change.contentBefore === null) {
				// Was a new file - delete it
				await this.fileService.del(change.fileUri);
			} else {
				// Restore previous content
				await this.fileService.writeFile(
					change.fileUri,
					VSBuffer.fromString(change.contentBefore)
				);
			}

			// Mark as superseded (can't rollback twice)
			change.superseded = true;
			return true;
		} catch (err) {
			console.error('[PowerMode] Rollback failed:', err);
			return false;
		}
	}

	async rollbackGroup(sessionId: string, agentId?: string): Promise<number> {
		const changes = Array.from(this._changes.values())
			.filter(c =>
				c.sessionId === sessionId &&
				c.agentId === agentId &&
				!c.superseded
			)
			.sort((a, b) => b.timestamp - a.timestamp); // Newest first

		let rolledBack = 0;
		for (const change of changes) {
			const success = await this.rollbackChange(change.id);
			if (success) {
				rolledBack++;
			}
		}

		return rolledBack;
	}

	clearHistory(): void {
		this._changes.clear();
	}
}
