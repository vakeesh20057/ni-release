/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { ICompactionConfig, ICompactionPlan, ISessionTokenProfile } from '../../../common/compactionTypes.js';
import { IPowerMessage, IPowerMessagePart } from '../../../common/powerModeTypes.js';

export interface IStepGroup {
	stepNumber: number;
	messageIds: string[];
	startIndex: number;
	endIndex: number;
	isComplete: boolean;
}

export class CompactionStrategy {

	shouldCompact(profile: ISessionTokenProfile, config: ICompactionConfig): boolean {
		if (profile.totalTokens > config.maxContextTokens) {
			return true;
		}

		const threshold = config.maxContextTokens * 0.9;
		if (profile.totalTokens > threshold) {
			const hasNaturalBreak = this._hasNaturalBreakPoint(profile);
			if (hasNaturalBreak) {
				return true;
			}
		}

		const minMessages = config.preserveRecentCount + 2;
		if (profile.messageProfiles.length < minMessages) {
			return false;
		}

		return false;
	}

	planCompaction(
		profile: ISessionTokenProfile,
		messages: readonly IPowerMessage[],
		config: ICompactionConfig
	): ICompactionPlan[] {
		const plans: ICompactionPlan[] = [];
		const preservedIds = this.getPreservedMessageIds(messages, config);
		const messageMap = new Map(messages.map(m => [m.id, m]));

		const level1 = this._planLevel1ToolOutputTruncation(profile, messages, config, preservedIds);
		if (level1.estimatedSavings > 0) {
			plans.push(level1);
		}

		const level2 = this._planLevel2DropReasoning(profile, messages, preservedIds);
		if (level2.estimatedSavings > 0) {
			plans.push(level2);
		}

		const level3 = this._planLevel3CollapseRedundant(profile, messages, preservedIds, messageMap);
		if (level3.estimatedSavings > 0) {
			plans.push(level3);
		}

		const level4 = this._planLevel4LLMSummarization(profile, messages, config, preservedIds);
		if (level4.estimatedSavings > 0 && config.useLLMSummarization) {
			plans.push(level4);
		}

		return plans;
	}

	getPreservedMessageIds(messages: readonly IPowerMessage[], config: ICompactionConfig): Set<string> {
		const preserved = new Set<string>();

		if (messages.length === 0) {
			return preserved;
		}

		const firstUser = messages.find(m => m.role === 'user');
		if (firstUser) {
			preserved.add(firstUser.id);
		}

		const recentCount = Math.min(config.preserveRecentCount, messages.length);
		for (let i = messages.length - recentCount; i < messages.length; i++) {
			preserved.add(messages[i].id);
		}

		for (const msg of messages) {
			if (msg.error && !msg.error.retryable) {
				preserved.add(msg.id);
			}
		}

		const activeFilePaths = this._extractActiveFilePaths(messages);
		if (activeFilePaths.size > 0) {
			for (const msg of messages) {
				if (this._referencesActiveFiles(msg, activeFilePaths)) {
					preserved.add(msg.id);
				}
			}
		}

		for (const msg of messages) {
			const pinnedMeta = (msg as any).compactionMetadata;
			if (pinnedMeta && pinnedMeta.pinned === true) {
				preserved.add(msg.id);
			}
		}

		return preserved;
	}

	identifyStepGroups(messages: readonly IPowerMessage[]): IStepGroup[] {
		const groups: IStepGroup[] = [];
		let currentGroup: Partial<IStepGroup> | null = null;

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];

			for (const part of msg.parts) {
				if (part.type === 'step-start') {
					if (currentGroup) {
						groups.push({
							stepNumber: currentGroup.stepNumber!,
							messageIds: currentGroup.messageIds!,
							startIndex: currentGroup.startIndex!,
							endIndex: i - 1,
							isComplete: false
						});
					}

					currentGroup = {
						stepNumber: (part as any).stepNumber ?? groups.length + 1,
						messageIds: [msg.id],
						startIndex: i,
						endIndex: i
					};
				} else if (part.type === 'step-finish') {
					if (currentGroup) {
						if (!currentGroup.messageIds!.includes(msg.id)) {
							currentGroup.messageIds!.push(msg.id);
						}
						groups.push({
							stepNumber: currentGroup.stepNumber!,
							messageIds: currentGroup.messageIds!,
							startIndex: currentGroup.startIndex!,
							endIndex: i,
							isComplete: true
						});
						currentGroup = null;
					}
				} else {
					if (currentGroup && !currentGroup.messageIds!.includes(msg.id)) {
						currentGroup.messageIds!.push(msg.id);
					}
				}
			}
		}

		if (currentGroup) {
			groups.push({
				stepNumber: currentGroup.stepNumber!,
				messageIds: currentGroup.messageIds!,
				startIndex: currentGroup.startIndex!,
				endIndex: messages.length - 1,
				isComplete: false
			});
		}

		const preStepMessages = messages.slice(0, groups[0]?.startIndex ?? messages.length);
		if (preStepMessages.length > 0) {
			groups.unshift({
				stepNumber: 0,
				messageIds: preStepMessages.map(m => m.id),
				startIndex: 0,
				endIndex: (groups[0]?.startIndex ?? messages.length) - 1,
				isComplete: true
			});
		}

		return groups;
	}

	estimatePostCompactionTokens(plans: readonly ICompactionPlan[], profile: ISessionTokenProfile): number {
		const totalSavings = plans.reduce((sum, plan) => sum + plan.estimatedSavings, 0);
		return Math.max(0, profile.totalTokens - totalSavings);
	}

	private _hasNaturalBreakPoint(profile: ISessionTokenProfile): boolean {
		if (profile.messageProfiles.length < 4) {
			return false;
		}

		const recent = profile.messageProfiles.slice(-3);
		const hasStepFinish = recent.some(mp => {
			return mp.toolCallTokens === 0 && mp.toolOutputTokens === 0;
		});

		return hasStepFinish;
	}

	private _planLevel1ToolOutputTruncation(
		profile: ISessionTokenProfile,
		messages: readonly IPowerMessage[],
		config: ICompactionConfig,
		preservedIds: Set<string>
	): ICompactionPlan {
		const messagesTargeted: string[] = [];
		let estimatedSavings = 0;

		for (const mp of profile.messageProfiles) {
			if (preservedIds.has(mp.messageId)) {
				continue;
			}

			if (mp.toolOutputTokens > config.maxToolOutputTokens) {
				messagesTargeted.push(mp.messageId);
				estimatedSavings += mp.toolOutputTokens - config.maxToolOutputTokens;
			}
		}

		return {
			level: 1,
			tokensToFree: estimatedSavings,
			messagesTargeted,
			estimatedSavings
		};
	}

	private _planLevel2DropReasoning(
		profile: ISessionTokenProfile,
		messages: readonly IPowerMessage[],
		preservedIds: Set<string>
	): ICompactionPlan {
		const messagesTargeted: string[] = [];
		let estimatedSavings = 0;

		for (const msg of messages) {
			if (preservedIds.has(msg.id)) {
				continue;
			}

			const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
			if (reasoningParts.length > 0) {
				messagesTargeted.push(msg.id);
				const reasoningTokens = this._estimatePartsTokens(reasoningParts);
				estimatedSavings += reasoningTokens;
			}
		}

		return {
			level: 2,
			tokensToFree: estimatedSavings,
			messagesTargeted,
			estimatedSavings
		};
	}

	private _planLevel3CollapseRedundant(
		profile: ISessionTokenProfile,
		messages: readonly IPowerMessage[],
		preservedIds: Set<string>,
		messageMap: Map<string, IPowerMessage>
	): ICompactionPlan {
		const messagesTargeted: string[] = [];
		let estimatedSavings = 0;

		const sequences = this._findRedundantToolSequences(messages, preservedIds);
		for (const seq of sequences) {
			for (const msgId of seq.messageIds) {
				if (!messagesTargeted.includes(msgId)) {
					messagesTargeted.push(msgId);
				}
			}
			estimatedSavings += seq.estimatedSavings;
		}

		return {
			level: 3,
			tokensToFree: estimatedSavings,
			messagesTargeted,
			estimatedSavings
		};
	}

	private _planLevel4LLMSummarization(
		profile: ISessionTokenProfile,
		messages: readonly IPowerMessage[],
		config: ICompactionConfig,
		preservedIds: Set<string>
	): ICompactionPlan {
		const stepGroups = this.identifyStepGroups(messages);
		const messagesTargeted: string[] = [];
		let estimatedSavings = 0;

		for (const group of stepGroups) {
			const allPreserved = group.messageIds.every(id => preservedIds.has(id));
			if (allPreserved) {
				continue;
			}

			const groupMessages = group.messageIds
				.map(id => messages.find(m => m.id === id))
				.filter((m): m is IPowerMessage => m !== undefined);

			const groupTokens = groupMessages.reduce((sum, msg) => {
				const mp = profile.messageProfiles.find(p => p.messageId === msg.id);
				return sum + (mp?.totalTokens ?? 0);
			}, 0);

			const summaryTokens = Math.ceil(groupTokens * 0.15);
			const savings = groupTokens - summaryTokens;

			if (savings > 0) {
				messagesTargeted.push(...group.messageIds);
				estimatedSavings += savings;
			}
		}

		return {
			level: 4,
			tokensToFree: estimatedSavings,
			messagesTargeted,
			estimatedSavings
		};
	}

	private _extractActiveFilePaths(messages: readonly IPowerMessage[]): Set<string> {
		const paths = new Set<string>();
		const recentMessages = messages.slice(-10);

		for (const msg of recentMessages) {
			for (const part of msg.parts) {
				if (part.type === 'tool') {
					const args = (part as any).state?.input;
					if (args && typeof args === 'object') {
						if (args.file_path) {
							paths.add(args.file_path);
						}
						if (args.path) {
							paths.add(args.path);
						}
					}
				}
			}
		}

		return paths;
	}

	private _referencesActiveFiles(msg: IPowerMessage, activeFilePaths: Set<string>): boolean {
		for (const part of msg.parts) {
			if (part.type === 'text') {
				const text = (part as any).text ?? '';
				for (const path of activeFilePaths) {
					if (text.includes(path)) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private _estimatePartsTokens(parts: readonly IPowerMessagePart[]): number {
		let total = 0;
		for (const part of parts) {
			if (part.type === 'text') {
				const text = (part as any).text ?? '';
				total += Math.ceil(text.length / 4);
			} else if (part.type === 'reasoning') {
				const text = (part as any).content ?? '';
				total += Math.ceil(text.length / 4);
			}
		}
		return total;
	}

	private _findRedundantToolSequences(
		messages: readonly IPowerMessage[],
		preservedIds: Set<string>
	): Array<{ messageIds: string[]; estimatedSavings: number }> {
		const sequences: Array<{ messageIds: string[]; estimatedSavings: number }> = [];

		let currentReadSequence: { dir: string; messageIds: string[] } | null = null;

		for (const msg of messages) {
			if (preservedIds.has(msg.id)) {
				if (currentReadSequence && currentReadSequence.messageIds.length >= 3) {
					sequences.push({
						messageIds: currentReadSequence.messageIds,
						estimatedSavings: this._estimateSequenceSavings(currentReadSequence.messageIds, messages)
					});
				}
				currentReadSequence = null;
				continue;
			}

			const toolCalls = msg.parts.filter(p => p.type === 'tool');
			if (toolCalls.length === 0) {
				if (currentReadSequence && currentReadSequence.messageIds.length >= 3) {
					sequences.push({
						messageIds: currentReadSequence.messageIds,
						estimatedSavings: this._estimateSequenceSavings(currentReadSequence.messageIds, messages)
					});
				}
				currentReadSequence = null;
				continue;
			}

			for (const toolCall of toolCalls) {
				const name = (toolCall as any).toolName ?? '';
				const args = (toolCall as any).state?.input ?? {};

				if (name === 'read' || name === 'bash' && (args.command?.startsWith('ls') || args.command?.startsWith('find'))) {
					const dir = this._extractDirectory(args);
					if (dir) {
						if (currentReadSequence && currentReadSequence.dir === dir) {
							currentReadSequence.messageIds.push(msg.id);
						} else {
							if (currentReadSequence && currentReadSequence.messageIds.length >= 3) {
								sequences.push({
									messageIds: currentReadSequence.messageIds,
									estimatedSavings: this._estimateSequenceSavings(currentReadSequence.messageIds, messages)
								});
							}
							currentReadSequence = { dir, messageIds: [msg.id] };
						}
					}
				}

				if (name === 'grep' || name === 'bash' && args.command?.includes('grep')) {
					const hasOutput = msg.parts.some(p => {
						if (p.type === 'tool') {
							const output = (p as any).state?.output ?? '';
							return output.length > 20;
						}
						return false;
					});

					if (!hasOutput) {
						sequences.push({
							messageIds: [msg.id],
							estimatedSavings: this._estimateMessageTokens(msg)
						});
					}
				}
			}
		}

		if (currentReadSequence && currentReadSequence.messageIds.length >= 3) {
			sequences.push({
				messageIds: currentReadSequence.messageIds,
				estimatedSavings: this._estimateSequenceSavings(currentReadSequence.messageIds, messages)
			});
		}

		return sequences;
	}

	private _extractDirectory(args: any): string | null {
		if (args.file_path) {
			const parts = args.file_path.split('/');
			parts.pop();
			return parts.join('/');
		}
		if (args.path) {
			return args.path;
		}
		if (args.command) {
			const match = args.command.match(/(?:ls|find)\s+([^\s]+)/);
			if (match) {
				return match[1];
			}
		}
		return null;
	}

	private _estimateSequenceSavings(messageIds: string[], messages: readonly IPowerMessage[]): number {
		let total = 0;
		for (const id of messageIds) {
			const msg = messages.find(m => m.id === id);
			if (msg) {
				total += this._estimateMessageTokens(msg);
			}
		}
		const replacementCost = 20;
		return Math.max(0, total - replacementCost);
	}

	private _estimateMessageTokens(msg: IPowerMessage): number {
		if (msg.tokens) {
			return (msg.tokens.input ?? 0) + (msg.tokens.output ?? 0);
		}

		let total = 0;
		for (const part of msg.parts) {
			if (part.type === 'text') {
				total += Math.ceil(((part as any).text ?? '').length / 4);
			} else if (part.type === 'tool') {
				total += Math.ceil(((part as any).state?.output ?? '').length / 4);
			}
		}
		return total;
	}
}
