/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccessor, useBackgroundAgents } from '../util/services.js';

const STATUS_DOT: Record<string, string> = {
	running: 'bg-blue-400/80 animate-pulse',
	branching: 'bg-yellow-400/80 animate-pulse',
	committing: 'bg-purple-400/80 animate-pulse',
	queued: 'bg-void-fg-4 opacity-40',
	completed: 'bg-green-400/80',
	failed: 'bg-red-400/80',
	cancelled: 'bg-void-fg-4 opacity-25',
};

const STATUS_LABEL: Record<string, string> = {
	running: '⚡ Running',
	branching: '🔀 Branching',
	committing: '💾 Committing',
	queued: '⏳ Queued',
	completed: '✓ Done',
	failed: '✗ Failed',
	cancelled: '⊘ Cancelled',
};

function getElapsed(startedAt?: number): string {
	if (!startedAt) return '';
	const ms = Date.now() - startedAt;
	if (ms < 1000) return '<1s';
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	return `${Math.floor(ms / 3_600_000)}h`;
}

interface BackgroundTask {
	id: string;
	request: { title: string; description: string };
	status: string;
	branchName: string;
	baseBranch: string;
	worktreePath: string;
	progress: string[];
	commits: string[];
	error?: string;
	startedAt?: number;
	completedAt?: number;
}

const AgentConsoleCard = ({ task, onCancel, onViewDiff, onRemove }: {
	task: BackgroundTask;
	onCancel: (id: string) => void;
	onViewDiff: (id: string) => void;
	onRemove: (id: string) => void;
}) => {
	const [expanded, setExpanded] = useState(task.status === 'running' || task.status === 'branching');
	const logRef = useRef<HTMLDivElement>(null);
	const dotClass = STATUS_DOT[task.status] || 'bg-void-fg-4 opacity-40';
	const isActive = task.status === 'running' || task.status === 'branching' || task.status === 'committing';

	useEffect(() => {
		if (logRef.current && expanded) {
			logRef.current.scrollTop = logRef.current.scrollHeight;
		}
	}, [task.progress.length, expanded]);

	return (
		<div className={`rounded-md border overflow-hidden mb-2 ${isActive ? 'border-blue-500/30 bg-blue-950/10' : 'border-void-border bg-void-bg-2'}`}>
			{/* Header */}
			<div
				className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-void-bg-3/50 transition-colors"
				onClick={() => setExpanded(v => !v)}
			>
				<span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dotClass}`} />
				<span className="text-[12px] text-void-fg-2 font-medium truncate min-w-0 flex-1">
					{task.request.title}
				</span>
				<span className="text-[10px] text-void-fg-4 opacity-60 flex-shrink-0">
					{STATUS_LABEL[task.status] || task.status}
				</span>
				{task.startedAt && (
					<span className="text-[10px] text-void-fg-4 opacity-40 flex-shrink-0">
						{getElapsed(task.startedAt)}
					</span>
				)}
				<span className="text-[9px] text-void-fg-4 opacity-30">{expanded ? '▾' : '▸'}</span>
			</div>

			{/* Expanded console */}
			{expanded && (
				<div className="border-t border-void-border-3">
					{/* Metadata bar */}
					<div className="flex gap-3 px-3 py-1 text-[10px] text-void-fg-4 opacity-60 bg-void-bg-3/30">
						<span className="font-mono">{task.branchName}</span>
						<span>{task.commits.length} commit(s)</span>
						<span>{task.progress.length} steps</span>
					</div>

					{/* Progress log (console output) */}
					<div
						ref={logRef}
						className="px-3 py-2 max-h-[300px] overflow-y-auto font-mono text-[11px] text-void-fg-3 bg-void-bg-1/50 space-y-0.5"
					>
						{task.progress.length === 0 && (
							<div className="text-void-fg-4 opacity-40 italic">Waiting...</div>
						)}
						{task.progress.map((line, i) => (
							<div key={i} className="flex items-start gap-1.5">
								<span className="text-void-fg-4 opacity-30 select-none flex-shrink-0">&gt;</span>
								<span className="break-all">{line}</span>
							</div>
						))}
						{task.error && (
							<div className="text-red-400/90 mt-1 pl-3 border-l-2 border-red-500/40">
								{task.error}
							</div>
						)}
					</div>

					{/* Actions bar */}
					<div className="flex gap-2 px-3 py-1.5 border-t border-void-border-3 bg-void-bg-3/20">
						{isActive && (
							<button
								className="text-[10px] px-2 py-0.5 rounded bg-red-900/30 text-red-300 hover:bg-red-900/50 transition-colors"
								onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
							>
								Cancel
							</button>
						)}
						{task.status === 'completed' && task.commits.length > 0 && (
							<button
								className="text-[10px] px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 hover:bg-blue-900/50 transition-colors"
								onClick={(e) => { e.stopPropagation(); onViewDiff(task.id); }}
							>
								View Diff
							</button>
						)}
						{(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
							<button
								className="text-[10px] px-2 py-0.5 rounded bg-void-bg-3 text-void-fg-4 hover:bg-void-bg-4 transition-colors ml-auto"
								onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
							>
								Remove
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
};

export const BackgroundAgentConsole = () => {
	const tasks = useBackgroundAgents();
	const accessor = useAccessor();

	const handleCancel = useCallback((id: string) => {
		const bgService = accessor.get('IBackgroundAgentService') as any;
		bgService?.cancel(id);
	}, [accessor]);

	const handleViewDiff = useCallback((id: string) => {
		const commandService = accessor.get('ICommandService') as any;
		commandService?.executeCommand('neuralInverse.bgAgent.viewDiff');
	}, [accessor]);

	const handleRemove = useCallback((id: string) => {
		const bgService = accessor.get('IBackgroundAgentService') as any;
		bgService?.removeTask(id);
	}, [accessor]);

	const handleSpawn = useCallback(() => {
		const commandService = accessor.get('ICommandService') as any;
		commandService?.executeCommand('neuralInverse.bgAgent.spawn');
	}, [accessor]);

	const taskArray = Array.from(tasks.values());
	const statusOrder = ['running', 'branching', 'committing', 'queued', 'completed', 'failed', 'cancelled'];
	taskArray.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));

	return (
		<div className="h-full flex flex-col bg-void-bg-1">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-void-border">
				<div className="flex items-center gap-2">
					<span className="text-[13px] text-void-fg-2 font-medium">Background Agents</span>
					{taskArray.filter(t => t.status === 'running').length > 0 && (
						<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
							{taskArray.filter(t => t.status === 'running').length} active
						</span>
					)}
				</div>
				<button
					className="text-[11px] px-2.5 py-1 rounded bg-void-bg-3 text-void-fg-2 hover:bg-void-bg-4 transition-colors border border-void-border"
					onClick={handleSpawn}
				>
					+ New Agent
				</button>
			</div>

			{/* Task list */}
			<div className="flex-1 overflow-y-auto p-3">
				{taskArray.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center opacity-50">
						<div className="text-[32px] mb-3">⊘</div>
						<div className="text-[12px] text-void-fg-3">No background agents running</div>
						<div className="text-[11px] text-void-fg-4 mt-1">
							Spawn one to work on a branch while you continue coding
						</div>
					</div>
				) : (
					taskArray.map(task => (
						<AgentConsoleCard
							key={task.id}
							task={task as BackgroundTask}
							onCancel={handleCancel}
							onViewDiff={handleViewDiff}
							onRemove={handleRemove}
						/>
					))
				)}
			</div>
		</div>
	);
};
