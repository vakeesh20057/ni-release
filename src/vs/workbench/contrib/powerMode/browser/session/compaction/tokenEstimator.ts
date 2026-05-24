/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import { IPowerMessage, ITextPart, IToolCallPart, IReasoningPart } from '../../../common/powerModeTypes.js';
import { ICompactionConfig, ITokenEstimate, IMessageTokenProfile, ISessionTokenProfile } from '../../../common/compactionTypes.js';

enum ContentType {
	Prose = 'prose',
	Code = 'code',
	JSON = 'json',
	Mixed = 'mixed'
}

interface IContentAnalysis {
	type: ContentType;
	charsPerToken: number;
	whitespaceRatio: number;
}

interface ITokenBreakdown {
	text: number;
	reasoning: number;
	toolCalls: number;
	toolOutputs: number;
	overhead: number;
}

export class TokenEstimator {

	private static readonly CHARS_PER_TOKEN_PROSE = 4.0;
	private static readonly CHARS_PER_TOKEN_CODE = 3.5;
	private static readonly CHARS_PER_TOKEN_JSON = 3.0;
	private static readonly MESSAGE_OVERHEAD_TOKENS = 4;
	private static readonly TOOL_CALL_STRUCTURE_OVERHEAD = 12;
	private static readonly TOOL_OUTPUT_STRUCTURE_OVERHEAD = 8;

	private static readonly CODE_INDICATORS = [
		/\b(function|class|const|let|var|if|else|for|while|return|import|export)\b/g,
		/[{}()\[\];]/g,
		/=>/g,
		/::/g,
		/\$\{/g,
	];

	private static readonly JSON_INDICATORS = [
		/^\s*[\{\[]/,
		/"[^"]*"\s*:/g,
		/,\s*"[^"]*"/g,
	];

	estimate(text: string): ITokenEstimate {
		if (!text || text.length === 0) {
			return { tokens: 0, method: 'chars-heuristic' };
		}

		const analysis = this.analyzeContent(text);
		const effectiveLength = this.computeEffectiveLength(text, analysis.whitespaceRatio);
		const tokens = Math.ceil(effectiveLength / analysis.charsPerToken);

		return {
			tokens: Math.max(1, tokens),
			method: 'chars-heuristic'
		};
	}

	profileMessage(message: IPowerMessage): IMessageTokenProfile {
		const breakdown = this.breakdownMessageTokens(message);

		return {
			messageId: message.id,
			role: message.role,
			totalTokens: breakdown.text + breakdown.reasoning + breakdown.toolCalls + breakdown.toolOutputs + breakdown.overhead,
			textTokens: breakdown.text,
			toolCallTokens: breakdown.toolCalls,
			toolOutputTokens: breakdown.toolOutputs
		};
	}

	profileSession(messages: IPowerMessage[], systemPrompt: string | undefined, config: ICompactionConfig): ISessionTokenProfile {
		let systemTokens = 0;
		if (systemPrompt) {
			systemTokens = this.estimate(systemPrompt).tokens;
		}

		const messageProfiles: IMessageTokenProfile[] = [];
		let totalMessageTokens = 0;

		for (const message of messages) {
			const profile = this.profileMessage(message);
			messageProfiles.push(profile);
			totalMessageTokens += profile.totalTokens;
		}

		const totalTokens = systemTokens + totalMessageTokens;
		const isOverBudget = totalTokens > config.maxContextTokens;
		const overage = isOverBudget ? totalTokens - config.maxContextTokens : 0;

		return {
			totalTokens,
			systemPromptTokens: systemTokens,
			messageProfiles,
			isOverBudget,
			overage
		};
	}

	private analyzeContent(text: string): IContentAnalysis {
		const trimmed = text.trim();
		if (trimmed.length === 0) {
			return {
				type: ContentType.Prose,
				charsPerToken: TokenEstimator.CHARS_PER_TOKEN_PROSE,
				whitespaceRatio: 0
			};
		}

		const isJSON = this.detectJSON(trimmed);
		if (isJSON) {
			return {
				type: ContentType.JSON,
				charsPerToken: TokenEstimator.CHARS_PER_TOKEN_JSON,
				whitespaceRatio: this.computeWhitespaceRatio(text)
			};
		}

		const codeScore = this.computeCodeScore(trimmed);
		if (codeScore > 0.3) {
			return {
				type: ContentType.Code,
				charsPerToken: TokenEstimator.CHARS_PER_TOKEN_CODE,
				whitespaceRatio: this.computeWhitespaceRatio(text)
			};
		}

		if (codeScore > 0.1) {
			return {
				type: ContentType.Mixed,
				charsPerToken: (TokenEstimator.CHARS_PER_TOKEN_PROSE + TokenEstimator.CHARS_PER_TOKEN_CODE) / 2,
				whitespaceRatio: this.computeWhitespaceRatio(text)
			};
		}

		return {
			type: ContentType.Prose,
			charsPerToken: TokenEstimator.CHARS_PER_TOKEN_PROSE,
			whitespaceRatio: this.computeWhitespaceRatio(text)
		};
	}

	private detectJSON(text: string): boolean {
		if (text.startsWith('{') || text.startsWith('[')) {
			try {
				JSON.parse(text);
				return true;
			} catch {
				// Check if it looks like JSON even if malformed
				let jsonLikeScore = 0;
				for (const regex of TokenEstimator.JSON_INDICATORS) {
					const matches = text.match(regex);
					if (matches) {
						jsonLikeScore += matches.length;
					}
				}
				return jsonLikeScore > 5;
			}
		}
		return false;
	}

	private computeCodeScore(text: string): number {
		let totalMatches = 0;
		for (const regex of TokenEstimator.CODE_INDICATORS) {
			const matches = text.match(regex);
			if (matches) {
				totalMatches += matches.length;
			}
		}

		const bracketDensity = (text.match(/[{}()\[\]]/g) || []).length / text.length;
		const semicolonDensity = (text.match(/;/g) || []).length / text.length;
		const indentLines = (text.match(/^\s{2,}/gm) || []).length;
		const totalLines = (text.match(/\n/g) || []).length + 1;
		const indentRatio = indentLines / totalLines;

		const rawScore = (totalMatches * 0.4) + (bracketDensity * 100) + (semicolonDensity * 50) + (indentRatio * 2);
		return Math.min(1.0, rawScore);
	}

	private computeWhitespaceRatio(text: string): number {
		if (text.length === 0) {
			return 0;
		}

		const whitespaceChars = (text.match(/\s/g) || []).length;
		return whitespaceChars / text.length;
	}

	private computeEffectiveLength(text: string, whitespaceRatio: number): number {
		const rawLength = text.length;

		if (whitespaceRatio > 0.5) {
			const excessWhitespace = whitespaceRatio - 0.5;
			const reduction = excessWhitespace * 0.3;
			return Math.ceil(rawLength * (1 - reduction));
		}

		const unicodeHeavy = this.detectUnicodeHeavy(text);
		if (unicodeHeavy) {
			return Math.ceil(rawLength * 1.15);
		}

		return rawLength;
	}

	private detectUnicodeHeavy(text: string): boolean {
		let nonAsciiCount = 0;
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) > 127) {
				nonAsciiCount++;
			}
		}
		return (nonAsciiCount / text.length) > 0.1;
	}

	private breakdownMessageTokens(message: IPowerMessage): ITokenBreakdown {
		const breakdown: ITokenBreakdown = {
			text: 0,
			reasoning: 0,
			toolCalls: 0,
			toolOutputs: 0,
			overhead: TokenEstimator.MESSAGE_OVERHEAD_TOKENS
		};

		if (!message.parts || message.parts.length === 0) {
			return breakdown;
		}

		for (const part of message.parts) {
			switch (part.type) {
				case 'text':
					breakdown.text += this.estimateTextPart(part as ITextPart);
					break;
				case 'reasoning':
					breakdown.reasoning += this.estimateReasoningPart(part as IReasoningPart);
					break;
				case 'tool':
					const toolEstimate = this.estimateToolCallPart(part as IToolCallPart);
					breakdown.toolCalls += toolEstimate.call;
					breakdown.toolOutputs += toolEstimate.output;
					break;
				case 'step-start':
				case 'step-finish':
					breakdown.overhead += 2;
					break;
			}
		}

		return breakdown;
	}

	private estimateTextPart(part: ITextPart): number {
		if (!part.text) {
			return 0;
		}
		return this.estimate(part.text).tokens;
	}

	private estimateReasoningPart(part: IReasoningPart): number {
		if (!part.text) {
			return 0;
		}
		return this.estimate(part.text).tokens;
	}

	private estimateToolCallPart(part: IToolCallPart): { call: number; output: number } {
		let callTokens = TokenEstimator.TOOL_CALL_STRUCTURE_OVERHEAD;
		let outputTokens = 0;

		callTokens += this.estimate(part.toolName).tokens;

		if (part.state && part.state.input) {
			const inputJSON = this.safeStringify(part.state.input);
			callTokens += this.estimate(inputJSON).tokens;
		}

		if (part.state && part.state.title) {
			callTokens += this.estimate(part.state.title).tokens;
		}

		if (part.state && part.state.output) {
			outputTokens = TokenEstimator.TOOL_OUTPUT_STRUCTURE_OVERHEAD;
			outputTokens += this.estimateToolOutput(part.state.output, part.toolName);
		}

		if (part.state && part.state.error) {
			outputTokens += this.estimate(part.state.error).tokens;
		}

		return { call: callTokens, output: outputTokens };
	}

	private estimateToolOutput(output: string, toolName: string): number {
		if (!output || output.length === 0) {
			return 0;
		}

		if (this.isLineNumberedContent(output)) {
			return this.estimateLineNumberedContent(output);
		}

		if (this.isDirectoryListing(output, toolName)) {
			return this.estimateDirectoryListing(output);
		}

		if (this.isGrepResult(output, toolName)) {
			return this.estimateGrepResult(output);
		}

		return this.estimate(output).tokens;
	}

	private isLineNumberedContent(output: string): boolean {
		const lines = output.split('\n').slice(0, 10);
		let numberedLines = 0;
		for (const line of lines) {
			if (/^\s*\d+\t/.test(line)) {
				numberedLines++;
			}
		}
		return numberedLines > 3;
	}

	private estimateLineNumberedContent(output: string): number {
		const lines = output.split('\n');
		let totalTokens = 0;

		for (const line of lines) {
			const match = line.match(/^\s*(\d+)\t(.*)$/);
			if (match) {
				const content = match[2];
				totalTokens += 1;
				totalTokens += this.estimate(content).tokens;
			} else {
				totalTokens += this.estimate(line).tokens;
			}
		}

		return totalTokens;
	}

	private isDirectoryListing(output: string, toolName: string): boolean {
		if (toolName === 'ls' || toolName === 'dir') {
			return true;
		}
		const lines = output.split('\n').slice(0, 20);
		let pathLikeLines = 0;
		for (const line of lines) {
			if (/^[\w\-\.\/\\]+$/.test(line.trim()) || /^\s*(\.+\/|[a-zA-Z]:)/.test(line)) {
				pathLikeLines++;
			}
		}
		return pathLikeLines > 5;
	}

	private estimateDirectoryListing(output: string): number {
		const lines = output.split('\n');
		let totalTokens = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}
			const segments = trimmed.split(/[\/\\]/);
			totalTokens += segments.length;
		}

		return totalTokens;
	}

	private isGrepResult(output: string, toolName: string): boolean {
		if (toolName === 'grep' || toolName === 'search') {
			return true;
		}
		const hasColonPattern = output.split('\n').slice(0, 10).filter(line => /^[^:]+:\d+:/.test(line)).length > 3;
		return hasColonPattern;
	}

	private estimateGrepResult(output: string): number {
		const lines = output.split('\n');
		let totalTokens = 0;

		for (const line of lines) {
			const match = line.match(/^([^:]+):(\d+):(.*)$/);
			if (match) {
				const filepath = match[1];
				const content = match[3];

				totalTokens += this.estimate(filepath).tokens;
				totalTokens += 1;
				totalTokens += this.estimate(content).tokens;
			} else {
				totalTokens += this.estimate(line).tokens;
			}
		}

		return totalTokens;
	}

	private safeStringify(obj: any): string {
		try {
			return JSON.stringify(obj);
		} catch {
			return String(obj);
		}
	}
}
