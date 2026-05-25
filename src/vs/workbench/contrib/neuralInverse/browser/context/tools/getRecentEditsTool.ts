/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IChangeTrackerService } from '../tracker/changeTracker.js';

export interface IGetRecentEditsArgs {
	withinMinutes?: number;
}

export interface IRecentEditResult {
	uri: string;
	heat: number;
	velocity: number;
	editCount: number;
	lastEditAt: number;
}

/**
 * Core logic for retrieving recently edited files with heat scores.
 * Returns structured data.
 */
export function executeGetRecentEdits(
	args: IGetRecentEditsArgs,
	changeTracker: IChangeTrackerService,
): IRecentEditResult[] {
	// Clamp to sane range: 1 minute to 24 hours
	const minutes = Math.min(Math.max(args.withinMinutes || 30, 1), 1440);
	const withinMs = minutes * 60 * 1000;

	let profiles;
	try {
		profiles = changeTracker.getRecentlyEdited(withinMs);
	} catch {
		return [];
	}

	return profiles.slice(0, 25).map(p => {
		let heat = 0;
		try { heat = changeTracker.getEditHeat(p.uri); } catch { /* stale entry */ }
		return {
			uri: p.uri,
			heat,
			velocity: p.editVelocity,
			editCount: p.editCount,
			lastEditAt: p.lastEditAt,
		};
	});
}
