/*---------------------------------------------------------------------------------------------
 *  Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * In-process agent registry for Power Mode.
 *
 * Tracks all active sub-agents and fork-agents spawned during a session.
 * Provides UUID/name dual-lookup and message queuing for inter-agent communication.
 */

import { IPowerMessage } from '../common/powerModeTypes.js';

export interface IActiveAgent {
	agentId: string;
	/** Friendly name (set at spawn time, used for send_message routing) */
	name: string;
	role: string;
	goal: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	abort: AbortController;
	/** Messages queued by send_message, drained between tool rounds */
	pendingMessages: string[];
	result?: string;
	error?: string;
	startedAt: number;
	completedAt?: number;
	/** Full conversation history for this agent (supports resume) */
	conversationHistory: IPowerMessage[];
}

export class AgentRegistry {
	private readonly _agents: Map<string, IActiveAgent> = new Map();
	/** name → agentId */
	private readonly _nameIndex: Map<string, string> = new Map();

	register(agent: IActiveAgent): void {
		this._agents.set(agent.agentId, agent);
		if (agent.name) {
			this._nameIndex.set(agent.name.toLowerCase(), agent.agentId);
		}
	}

	/** Look up by full agentId, short prefix (first 8 chars), or friendly name. */
	get(agentIdOrName: string): IActiveAgent | undefined {
		// Exact UUID match
		const byId = this._agents.get(agentIdOrName);
		if (byId) { return byId; }

		// Short-prefix match
		if (agentIdOrName.length >= 6) {
			for (const [id, agent] of this._agents) {
				if (id.startsWith(agentIdOrName)) { return agent; }
			}
		}

		// Friendly name (case-insensitive)
		const idByName = this._nameIndex.get(agentIdOrName.toLowerCase());
		if (idByName) { return this._agents.get(idByName); }

		return undefined;
	}

	getAll(): IActiveAgent[] {
		return Array.from(this._agents.values());
	}

	unregister(agentId: string): void {
		const agent = this._agents.get(agentId);
		if (agent?.name) {
			this._nameIndex.delete(agent.name.toLowerCase());
		}
		this._agents.delete(agentId);
	}

	/**
	 * Queue a message for delivery to a running agent.
	 * Returns false if the agent is not found.
	 */
	queueMessage(agentIdOrName: string, message: string): boolean {
		const agent = this.get(agentIdOrName);
		if (!agent) { return false; }
		agent.pendingMessages.push(message);
		return true;
	}

	/** Cancel all running agents. */
	cancelAll(): void {
		for (const agent of this._agents.values()) {
			if (agent.status === 'running') {
				agent.abort.abort();
				agent.status = 'cancelled';
				agent.completedAt = Date.now();
			}
		}
	}
}
