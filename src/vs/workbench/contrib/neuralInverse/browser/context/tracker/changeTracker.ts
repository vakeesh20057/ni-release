/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';

export const IChangeTrackerService = createDecorator<IChangeTrackerService>('neuralInverseChangeTracker');

export interface IEditEvent {
	uri: string;
	timestamp: number;
	lineRange: { start: number; end: number };
	charCount: number;
}

export interface IFileEditProfile {
	uri: string;
	lastEditAt: number;
	editCount: number;
	totalCharsChanged: number;
	editVelocity: number;
	coEditedWith: Set<string>;
	recentLineRanges: Array<{ start: number; end: number }>;
}

export interface IChangeTrackerService {
	readonly _serviceBrand: undefined;
	readonly onDidRecordEdit: Event<IEditEvent>;
	getRecentlyEdited(withinMs?: number): IFileEditProfile[];
	getCoEditedFiles(uri: string): string[];
	getEditHeat(uri: string): number;
	getEditVelocity(uri: string): number;
	getHotRegions(uri: string): Array<{ start: number; end: number; heat: number }>;
	isFileActive(uri: string, windowMs?: number): boolean;
	reset(): void;
}

const RING_BUFFER_SIZE = 2000;
const CO_EDIT_WINDOW_MS = 30_000;
const HEAT_HALF_LIFE_MS = 120_000;
const VELOCITY_WINDOW_MS = 60_000;
const MAX_LINE_RANGES_PER_FILE = 50;
const PROFILE_CLEANUP_INTERVAL_MS = 300_000;
const STALE_PROFILE_AGE_MS = 3_600_000;
const MAX_PROFILES = 500;

class ChangeTrackerService extends Disposable implements IChangeTrackerService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRecordEdit = this._register(new Emitter<IEditEvent>());
	readonly onDidRecordEdit = this._onDidRecordEdit.event;

	private readonly _ringBuffer: Array<IEditEvent | undefined>;
	private _ringWriteIdx = 0;
	private _ringCount = 0;
	private readonly _profiles = new Map<string, IFileEditProfile>();
	private readonly _modelSubscriptions = new Map<string, IDisposable>();
	private readonly _cleanupScheduler: RunOnceScheduler;
	private readonly _pendingEdits: IEditEvent[] = [];
	private readonly _flushScheduler: RunOnceScheduler;

	constructor(
		@IModelService private readonly _modelService: IModelService,
	) {
		super();

		this._ringBuffer = new Array(RING_BUFFER_SIZE).fill(undefined);

		this._cleanupScheduler = this._register(new RunOnceScheduler(() => this._cleanupStaleProfiles(), PROFILE_CLEANUP_INTERVAL_MS));
		this._cleanupScheduler.schedule();

		// Batch micro-edits within a single tick to avoid per-keystroke overhead
		this._flushScheduler = this._register(new RunOnceScheduler(() => this._flushPendingEdits(), 50));

		for (const model of this._modelService.getModels()) {
			this._subscribeToModel(model);
		}

		this._register(this._modelService.onModelAdded(model => this._subscribeToModel(model)));
		this._register(this._modelService.onModelRemoved(model => this._unsubscribeFromModel(model)));
	}

	private _subscribeToModel(model: ITextModel): void {
		const key = model.uri.toString();
		if (this._modelSubscriptions.has(key)) return;

		// Skip non-file URIs (output panels, untitled docs with no content, etc.)
		if (model.uri.scheme !== 'file' && model.uri.scheme !== 'vscode-userdata') return;

		const disposable = model.onDidChangeContent(e => {
			const now = Date.now();
			for (const change of e.changes) {
				this._pendingEdits.push({
					uri: key,
					timestamp: now,
					lineRange: { start: change.range.startLineNumber, end: change.range.endLineNumber },
					charCount: change.text.length + (change.rangeLength ?? 0),
				});
			}
			if (!this._flushScheduler.isScheduled()) {
				this._flushScheduler.schedule();
			}
		});

		this._modelSubscriptions.set(key, disposable);
	}

	private _unsubscribeFromModel(model: ITextModel): void {
		const key = model.uri.toString();
		const d = this._modelSubscriptions.get(key);
		if (d) {
			d.dispose();
			this._modelSubscriptions.delete(key);
		}
	}

	private _flushPendingEdits(): void {
		const edits = this._pendingEdits.splice(0, this._pendingEdits.length);
		for (const event of edits) {
			this._recordEdit(event);
		}
	}

	private _recordEdit(event: IEditEvent): void {
		// Write to ring buffer
		this._ringBuffer[this._ringWriteIdx] = event;
		this._ringWriteIdx = (this._ringWriteIdx + 1) % RING_BUFFER_SIZE;
		if (this._ringCount < RING_BUFFER_SIZE) this._ringCount++;

		// Update or create profile
		let profile = this._profiles.get(event.uri);
		if (!profile) {
			if (this._profiles.size >= MAX_PROFILES) {
				this._evictColdestProfile();
			}
			profile = {
				uri: event.uri,
				lastEditAt: 0,
				editCount: 0,
				totalCharsChanged: 0,
				editVelocity: 0,
				coEditedWith: new Set(),
				recentLineRanges: [],
			};
			this._profiles.set(event.uri, profile);
		}

		profile.lastEditAt = event.timestamp;
		profile.editCount++;
		profile.totalCharsChanged += event.charCount;

		// Track hot line ranges (merge overlapping)
		this._mergeLineRange(profile, event.lineRange);

		// Co-edit detection
		const coEditThreshold = event.timestamp - CO_EDIT_WINDOW_MS;
		for (const [otherUri, otherProfile] of this._profiles) {
			if (otherUri === event.uri) continue;
			if (otherProfile.lastEditAt >= coEditThreshold) {
				profile.coEditedWith.add(otherUri);
				otherProfile.coEditedWith.add(event.uri);
			}
		}

		// Update velocity (edits per minute in the recent window)
		profile.editVelocity = this._computeVelocity(event.uri, event.timestamp);

		this._onDidRecordEdit.fire(event);
	}

	private _mergeLineRange(profile: IFileEditProfile, range: { start: number; end: number }): void {
		const ranges = profile.recentLineRanges;

		// Try to merge with an existing range
		for (let i = 0; i < ranges.length; i++) {
			const existing = ranges[i];
			if (range.start <= existing.end + 2 && range.end >= existing.start - 2) {
				existing.start = Math.min(existing.start, range.start);
				existing.end = Math.max(existing.end, range.end);
				return;
			}
		}

		// Add new range, evict oldest if at capacity
		if (ranges.length >= MAX_LINE_RANGES_PER_FILE) {
			ranges.shift();
		}
		ranges.push({ start: range.start, end: range.end });
	}

	private _computeVelocity(uri: string, now: number): number {
		const windowStart = now - VELOCITY_WINDOW_MS;
		let count = 0;

		for (let i = 0; i < this._ringCount; i++) {
			const idx = (this._ringWriteIdx - 1 - i + RING_BUFFER_SIZE) % RING_BUFFER_SIZE;
			const evt = this._ringBuffer[idx];
			if (!evt) break;
			if (evt.timestamp < windowStart) break;
			if (evt.uri === uri) count++;
		}

		return count / (VELOCITY_WINDOW_MS / 60_000);
	}

	private _evictColdestProfile(): void {
		let coldestUri: string | undefined;
		let coldestTime = Infinity;

		for (const [uri, profile] of this._profiles) {
			if (profile.lastEditAt < coldestTime) {
				coldestTime = profile.lastEditAt;
				coldestUri = uri;
			}
		}

		if (coldestUri) {
			// Clean up co-edit references
			const evicted = this._profiles.get(coldestUri)!;
			for (const coUri of evicted.coEditedWith) {
				const coProfile = this._profiles.get(coUri);
				if (coProfile) coProfile.coEditedWith.delete(coldestUri);
			}
			this._profiles.delete(coldestUri);
		}
	}

	private _cleanupStaleProfiles(): void {
		const cutoff = Date.now() - STALE_PROFILE_AGE_MS;
		const stale: string[] = [];

		for (const [uri, profile] of this._profiles) {
			if (profile.lastEditAt < cutoff) {
				stale.push(uri);
			}
		}

		for (const uri of stale) {
			const profile = this._profiles.get(uri)!;
			for (const coUri of profile.coEditedWith) {
				const coProfile = this._profiles.get(coUri);
				if (coProfile) coProfile.coEditedWith.delete(uri);
			}
			this._profiles.delete(uri);
		}

		this._cleanupScheduler.schedule();
	}

	getRecentlyEdited(withinMs = 300_000): IFileEditProfile[] {
		const cutoff = Date.now() - withinMs;
		const results: IFileEditProfile[] = [];

		for (const profile of this._profiles.values()) {
			if (profile.lastEditAt >= cutoff) {
				results.push(profile);
			}
		}

		results.sort((a, b) => b.lastEditAt - a.lastEditAt);
		return results;
	}

	getCoEditedFiles(uri: string): string[] {
		const profile = this._profiles.get(uri);
		if (!profile) return [];
		return Array.from(profile.coEditedWith);
	}

	getEditHeat(uri: string): number {
		const profile = this._profiles.get(uri);
		if (!profile) return 0;
		const elapsed = Date.now() - profile.lastEditAt;
		if (elapsed < 0) return 1.0;
		return Math.exp(-0.693 * elapsed / HEAT_HALF_LIFE_MS);
	}

	getEditVelocity(uri: string): number {
		const profile = this._profiles.get(uri);
		if (!profile) return 0;
		return profile.editVelocity;
	}

	getHotRegions(uri: string): Array<{ start: number; end: number; heat: number }> {
		const profile = this._profiles.get(uri);
		if (!profile) return [];

		const heat = this.getEditHeat(uri);
		return profile.recentLineRanges.map(r => ({
			start: r.start,
			end: r.end,
			heat,
		}));
	}

	isFileActive(uri: string, windowMs = 60_000): boolean {
		const profile = this._profiles.get(uri);
		if (!profile) return false;
		return (Date.now() - profile.lastEditAt) < windowMs;
	}

	reset(): void {
		this._ringBuffer.fill(undefined);
		this._ringWriteIdx = 0;
		this._ringCount = 0;
		this._profiles.clear();
		this._pendingEdits.length = 0;
	}

	override dispose(): void {
		for (const d of this._modelSubscriptions.values()) {
			d.dispose();
		}
		this._modelSubscriptions.clear();
		super.dispose();
	}
}

registerSingleton(IChangeTrackerService, ChangeTrackerService, InstantiationType.Eager);
