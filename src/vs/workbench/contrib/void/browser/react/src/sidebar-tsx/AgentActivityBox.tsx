/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Agent Activity Box — expandable sub-chat view showing what main/sub-agent is doing.
 *---------------------------------------------------------------------------------------------*/

import React, { useState, useMemo } from 'react';
import { useAgentTask, useSubAgents, useChatThreadsState } from '../util/services.js';
import type { AgentTask } from '../../../../common/neuralInverseAgentTypes.js';
import type { SubAgentTask } from '../../../../common/subAgentTypes.js';
import type { ChatMessage } from '../../../../common/chatThreadServiceTypes.js';

// ─── Status styling ──────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
	running: 'bg-blue-400/80 animate-pulse',
	completed: 'bg-green-400/80',
	failed: 'bg-red-400/80',
	paused: 'bg-yellow-400/80',
	pending: 'bg-void-fg-4 opacity-40',
	cancelled: 'bg-void-fg-4 opacity-25',
};

const STATUS_LABEL: Record<string, string> = {
	running: 'Running',
	completed: 'Done',
	failed: 'Failed',
	paused: 'Paused',
	pending: 'Queued',
	cancelled: 'Cancelled',
};

// ─── Message rendering (mini chat bubbles) ───────────────────────────────────

const AgentMessageBubble = ({ msg }: { msg: ChatMessage }) => {
	if (msg.role === 'user') {
		const text = msg.displayContent || msg.content;
		if (!text || text.startsWith('[SYSTEM:')) return null;
		return (
			<div className="text-[11px] text-void-fg-3 opacity-70 py-0.5 pl-2 border-l-2 border-void-border-3">
				{text.length > 200 ? text.slice(0, 200) + '…' : text}
			</div>
		);
	}
	if (msg.role === 'assistant') {
		const text = msg.displayContent;
		if (!text) return null;
		return (
			<div className="text-[11px] text-void-fg-2 py-0.5 pl-2 border-l-2 border-blue-500/30">
				{text.length > 300 ? text.slice(0, 300) + '…' : text}
			</div>
		);
	}
	// Tool messages — show as compact one-liner
	if ('name' in msg) {
		const toolMsg = msg as any;
		const status = toolMsg.type === 'success' ? '✓' : toolMsg.type === 'running_now' ? '⟳' : toolMsg.type === 'tool_error' ? '✗' : '·';
		return (
			<div className="text-[10px] text-void-fg-4 opacity-60 py-px pl-2 flex items-center gap-1">
				<span>{status}</span>
				<span className="font-mono">{toolMsg.name}</span>
			</div>
		);
	}
	return null;
};

// ─── Sub-agent sub-chat ──────────────────────────────────────────────────────

const SubAgentChat = ({ agent }: { agent: SubAgentTask }) => {
	const [open, setOpen] = useState(false);
	const chatState = useChatThreadsState();
	const dotClass = STATUS_DOT[agent.status] || 'bg-void-fg-4 opacity-40';

	const messages = useMemo(() => {
		const thread = chatState.allThreads[agent.threadId];
		return thread?.messages || [];
	}, [chatState, agent.threadId]);

	return (
		<div className="mt-0.5">
			<div
				className="flex items-center gap-1.5 py-0.5 cursor-pointer select-none hover:bg-void-bg-3 rounded px-1 -mx-1"
				onClick={() => setOpen(v => !v)}
			>
				<span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${dotClass}`} />
				<span className="text-[11px] text-void-fg-3 font-medium">{agent.role}</span>
				<span className="text-[10px] text-void-fg-4 opacity-50 truncate min-w-0 flex-1">{agent.goal}</span>
				<span className="text-[10px] text-void-fg-4 opacity-40 flex-shrink-0">{STATUS_LABEL[agent.status] || agent.status}</span>
				<span className="text-[9px] text-void-fg-4 opacity-30">{open ? '▾' : '▸'}</span>
			</div>
			{open && (
				<div className="ml-3 pl-2 border-l border-void-border-3 mt-0.5 max-h-[200px] overflow-y-auto space-y-0.5">
					{messages.length === 0 && (
						<div className="text-[10px] text-void-fg-4 opacity-40 italic">No messages yet</div>
					)}
					{messages.slice(-20).map((msg, i) => (
						<AgentMessageBubble key={i} msg={msg} />
					))}
				</div>
			)}
		</div>
	);
};

// ─── Main Agent Activity Box ─────────────────────────────────────────────────

export const AgentActivityBox = () => {
	const task = useAgentTask();
	const subAgents = useSubAgents();
	const chatState = useChatThreadsState();
	const [expanded, setExpanded] = useState(false);
	const [showMainChat, setShowMainChat] = useState(false);

	const activeSubAgents = useMemo(() => {
		const arr: SubAgentTask[] = [];
		subAgents.forEach(a => arr.push(a));
		return arr;
	}, [subAgents]);

	const mainMessages = useMemo(() => {
		if (!task) return [];
		const thread = chatState.allThreads[task.threadId];
		return thread?.messages || [];
	}, [chatState, task]);

	if (!task) return null;

	const dotClass = STATUS_DOT[task.status] || 'bg-void-fg-4 opacity-40';
	const isActive = task.status === 'running' || task.status === 'paused';
	const elapsed = getElapsed(task.createdAt);

	return (
		<div className={`mx-2 my-1.5 rounded-md border overflow-hidden ${isActive ? 'border-blue-500/30 bg-blue-950/10' : 'border-void-border bg-void-bg-2'}`}>
			{/* Header bar — always visible */}
			<div
				className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-void-bg-3/50 transition-colors"
				onClick={() => setExpanded(v => !v)}
			>
				<span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dotClass}`} />
				<span className="text-[12px] text-void-fg-2 font-medium truncate min-w-0 flex-1">
					{task.goal.length > 60 ? task.goal.slice(0, 60) + '…' : task.goal}
				</span>
				<span className="text-[10px] text-void-fg-4 opacity-50 flex-shrink-0">{elapsed}</span>
				<span className="text-[10px] text-void-fg-4 opacity-30 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
			</div>

			{/* Expanded: sub-chat view */}
			{expanded && (
				<div className="border-t border-void-border-3">
					{/* Quick metrics bar */}
					<div className="flex gap-3 px-3 py-1 text-[10px] text-void-fg-4 opacity-60 bg-void-bg-3/30">
						<span>iter {task.iteration}/{task.maxIterations}</span>
						<span>{task.totalToolCalls} tools</span>
						<span>{task.filesModified.size} edits</span>
						{task.totalErrors > 0 && <span className="text-void-warning">{task.totalErrors} err</span>}
						{task.replans.length > 0 && <span className="text-yellow-400/70">↻{task.replans.length}</span>}
					</div>

					{/* Main agent chat toggle */}
					<div className="px-3 pt-1.5">
						<div
							className="flex items-center gap-1.5 py-0.5 cursor-pointer select-none hover:bg-void-bg-3 rounded px-1 -mx-1"
							onClick={() => setShowMainChat(v => !v)}
						>
							<span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${dotClass}`} />
							<span className="text-[11px] text-void-fg-2 font-medium">Main Agent</span>
							<span className="text-[10px] text-void-fg-4 opacity-40 ml-auto">{mainMessages.length} msgs</span>
							<span className="text-[9px] text-void-fg-4 opacity-30">{showMainChat ? '▾' : '▸'}</span>
						</div>
						{showMainChat && (
							<div className="ml-3 pl-2 border-l border-blue-500/20 mt-0.5 mb-1 max-h-[300px] overflow-y-auto space-y-0.5">
								{mainMessages.slice(-30).map((msg, i) => (
									<AgentMessageBubble key={i} msg={msg} />
								))}
							</div>
						)}
					</div>

					{/* Sub-agents */}
					{activeSubAgents.length > 0 && (
						<div className="px-3 pb-2 pt-0.5">
							<div className="text-[10px] text-void-fg-4 opacity-40 uppercase tracking-wider mb-0.5">Sub-agents ({activeSubAgents.length})</div>
							{activeSubAgents.map(a => (
								<SubAgentChat key={a.id} agent={a} />
							))}
						</div>
					)}

					{/* If no sub-agents and main chat hidden, show steps as fallback */}
					{activeSubAgents.length === 0 && !showMainChat && task.steps.length > 0 && (
						<div className="px-3 pb-2 pt-0.5">
							{task.steps.slice(-5).map(step => (
								<div key={step.id} className="flex items-center gap-1.5 py-px">
									<span className={`w-[4px] h-[4px] rounded-full flex-shrink-0 ${step.status === 'completed' ? 'bg-green-400/80' : step.status === 'running' ? 'bg-blue-400/80 animate-pulse' : 'bg-void-fg-4 opacity-40'}`} />
									<span className="text-[11px] text-void-fg-3 truncate">{step.description}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getElapsed(createdAt: string): string {
	const ms = Date.now() - new Date(createdAt).getTime();
	if (ms < 1000) return '<1s';
	if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	return `${Math.floor(ms / 3_600_000)}h`;
}
