/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

export interface IBackgroundTaskRequest {
	title: string;
	description: string;
	branchName?: string;
	baseBranch?: string;
	createPR?: boolean;
}

export type BackgroundTaskStatus =
	| 'queued'
	| 'branching'
	| 'running'
	| 'committing'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface IBackgroundTask {
	id: string;
	request: IBackgroundTaskRequest;
	status: BackgroundTaskStatus;
	branchName: string;
	baseBranch: string;
	worktreePath: string;
	runId?: string;
	progress: string[];
	commits: string[];
	error?: string;
	startedAt?: number;
	completedAt?: number;
}

export const MAX_CONCURRENT_BACKGROUND_AGENTS = 3;
