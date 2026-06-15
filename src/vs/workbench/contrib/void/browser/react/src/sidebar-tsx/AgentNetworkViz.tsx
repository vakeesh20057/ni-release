/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

// ─── CSS NOTE ─────────────────────────────────────────────────────────────────
// See STYLING_RULES.md in this directory before using Tailwind classes.
// Key rule: void-border-* colors are plain CSS variables — NEVER use /opacity
// modifiers (e.g. border-void-border-3/40). Use opacity-* utilities instead.
// ──────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { useAccessor } from '../util/services.js';

// ─── SubAgentCard ─── Pure props, zero hooks that depend on sub-agent state ──
// Rendered by spawn_agent / wait_for_agent resultWrappers in SidebarChat.

const roleLabels: Record<string, string> = {
	editor: 'writer',
	writer: 'writer',
	explorer: 'explorer',
	verifier: 'verifier',
	compliance: 'compliance',
	debugger: 'debugger',
	reviewer: 'reviewer',
	tester: 'tester',
	documenter: 'documenter',
	architect: 'architect',
};

function cleanGoal(goal: string): string {
	if (!goal) return '';
	const cleaned = goal.length > 80 ? goal.substring(0, 80) + '…' : goal;
	return cleaned;
}

export interface SubAgentCardProps {
	role: string;
	goal: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled' | 'pending';
	agentId?: string;
	threadId?: string;
	duration?: string;
}

export const SubAgentCard: React.FC<SubAgentCardProps> = ({
	role,
	goal,
	status,
	threadId,
}) => {
	const accessor = useAccessor();

	const navigateToThread = useCallback(() => {
		if (!threadId) return;
		const chatThreadsService = accessor.get('IChatThreadService');
		chatThreadsService.switchToThread(threadId);
	}, [accessor, threadId]);

	const displayRole = roleLabels[role] || role;
	const statusIcon = status === 'completed' ? '✓' : status === 'failed' ? '✗' : status === 'running' ? '●' : '○';

	return (
		<div
			className={`my-1.5 py-2 px-3 border-l-2 border-void-border-3 ${threadId ? 'cursor-pointer' : 'cursor-default'}`}
			onClick={navigateToThread}
		>
			<div className="flex items-center gap-2">
				<span className="text-void-fg-4 opacity-60 text-sm flex-shrink-0">{statusIcon}</span>
				<span className="text-[13px] text-void-fg-2 font-medium truncate">{cleanGoal(goal)}</span>
				{threadId && (
					<svg
						width="10" height="10" viewBox="0 0 16 16" fill="none"
						className="flex-shrink-0 opacity-40 text-void-fg-4 ml-auto"
					>
						<path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				)}
			</div>
			<div className="pl-6 text-[11px] text-void-fg-4 opacity-50 mt-0.5">
				Invoked {displayRole} subagent
			</div>
		</div>
	);
};

// ─── AgentThreadBackBar ─── breadcrumb to navigate back from sub-agent thread ─

export const AgentThreadBackBar: React.FC<{
	parentThreadId: string;
	agentRole: string;
	agentGoal: string;
}> = ({ parentThreadId, agentRole, agentGoal }) => {
	const accessor = useAccessor();

	const goBack = useCallback(() => {
		if (!parentThreadId) return;
		const chatThreadsService = accessor.get('IChatThreadService');
		chatThreadsService.switchToThread(parentThreadId);
	}, [accessor, parentThreadId]);

	return (
		<div
			className="flex items-center gap-1.5 px-4 py-1.5 cursor-pointer select-none border-b border-void-border-3"
			onClick={goBack}
		>
			<svg
				width="10" height="10" viewBox="0 0 16 16" fill="none"
				className="flex-shrink-0 opacity-60 text-void-fg-4"
			>
				<path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			<span className="text-[11px] text-void-fg-4 opacity-60">Back</span>
			<span className="text-[11px] text-void-fg-3 capitalize font-medium">{agentRole}</span>
			<span className="text-[10px] text-void-fg-4 opacity-50 truncate min-w-0">{cleanGoal(agentGoal)}</span>
		</div>
	);
};

// Legacy exports for backwards compat (SidebarChat imports these names)
export const AgentNetworkViz = SubAgentCard;
export const AgentCompletionCard = SubAgentCard;
