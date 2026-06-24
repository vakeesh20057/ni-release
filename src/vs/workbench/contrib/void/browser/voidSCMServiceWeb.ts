/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { IGenerateCommitMessageService } from './voidSCMService.js';
import { ISCMService } from '../../scm/common/scm.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize2 } from '../../../../nls.js';
import { ThrottledDelayer } from '../../../../base/common/async.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { gitCommitMessage_systemMessage, gitCommitMessage_userMessage } from '../common/prompt/prompts.js';
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js';
import { ModelSelection, OverridesOfModel, ModelSelectionOptions } from '../common/voidSettingsTypes.js';

// Web stub for IVoidSCMService — git commands are not directly executable in the browser.
class VoidSCMServiceWeb implements IVoidSCMService {
	readonly _serviceBrand: undefined;
	async gitStat(_path: string): Promise<string> { return ''; }
	async gitSampledDiffs(_path: string): Promise<string> { return ''; }
	async gitBranch(_path: string): Promise<string> { return ''; }
	async gitLog(_path: string): Promise<string> { return ''; }
}

interface ModelOptions {
	modelSelection: ModelSelection | null;
	modelSelectionOptions?: ModelSelectionOptions;
	overridesOfModel: OverridesOfModel;
}

const loadingContextKey = 'voidSCMGenerateCommitMessageLoading';

class GenerateCommitMessageServiceWeb extends Disposable implements IGenerateCommitMessageService {
	readonly _serviceBrand: undefined;
	private readonly execute = new ThrottledDelayer(300);
	private llmRequestId: string | null = null;
	private currentRequestId: string | null = null;
	private loadingCtxKey: IContextKey<boolean>;

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IConvertToLLMMessageService private readonly convertToLLMMessageService: IConvertToLLMMessageService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.loadingCtxKey = contextKeyService.createKey(loadingContextKey, false);
	}

	override dispose() {
		this.execute.dispose();
		super.dispose();
	}

	async generateCommitMessage() {
		this.loadingCtxKey.set(true);
		this.execute.trigger(async () => {
			const requestId = generateUuid();
			this.currentRequestId = requestId;
			try {
				const { repo } = this.gitRepoInfo();

				// In web mode we can't run git CLI, so pass empty strings — the LLM will generate a generic commit message
				const stat = '';
				const sampledDiffs = '';
				const branch = '';
				const log = '';

				if (!this.isCurrentRequest(requestId)) { throw new CancellationError(); }

				const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature['SCM'] ?? null;
				const modelSelectionOptions = modelSelection ? this.voidSettingsService.state.optionsOfModelSelection['SCM'][modelSelection.providerName]?.[modelSelection.modelName] : undefined;
				const overridesOfModel = this.voidSettingsService.state.overridesOfModel;
				const modelOptions: ModelOptions = { modelSelection, modelSelectionOptions, overridesOfModel };

				const prompt = gitCommitMessage_userMessage(stat, sampledDiffs, branch, log);
				const simpleMessages = [{ role: 'user', content: prompt } as const];
				const { messages, separateSystemMessage } = this.convertToLLMMessageService.prepareLLMSimpleMessages({
					simpleMessages,
					systemMessage: gitCommitMessage_systemMessage,
					modelSelection: modelOptions.modelSelection,
					featureName: 'SCM',
				});

				let commitMessage = await this.sendLLMMessage(messages, separateSystemMessage!, modelOptions);
				if (!this.isCurrentRequest(requestId)) { throw new CancellationError(); }
				commitMessage = this._appendCoAuthorTrailers(commitMessage, modelOptions.modelSelection);
				repo.input.setValue(commitMessage, false);
			} catch (error) {
				this.onError(error);
			} finally {
				if (this.isCurrentRequest(requestId)) {
					this.loadingCtxKey.set(false);
				}
			}
		});
	}

	abort() {
		if (this.llmRequestId) { this.llmMessageService.abort(this.llmRequestId); }
		this.execute.cancel();
		this.loadingCtxKey.set(false);
		this.currentRequestId = null;
	}

	private gitRepoInfo() {
		const repo = Array.from(this.scmService.repositories || []).find((r: any) => r.provider.contextValue === 'git');
		if (!repo) { throw new Error('No git repository found'); }
		return { repo };
	}

	private sendLLMMessage(messages: LLMChatMessage[], separateSystemMessage: string, modelOptions: ModelOptions): Promise<string> {
		return new Promise((resolve, reject) => {
			this.llmRequestId = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				chatMode: null,
				modelSelection: modelOptions.modelSelection,
				modelSelectionOptions: modelOptions.modelSelectionOptions,
				overridesOfModel: modelOptions.overridesOfModel,
				onText: () => { },
				onFinalMessage: (params: { fullText: string }) => {
					const match = params.fullText.match(/<output>([\s\S]*?)<\/output>/i);
					resolve(match ? match[1].trim() : params.fullText.trim());
				},
				onError: (error) => { console.error(error); reject(error); },
				onAbort: () => { reject(new CancellationError()); },
				logging: { loggingName: 'VoidSCM - Commit Message (web)' },
			});
		});
	}

	private isCurrentRequest(requestId: string) { return requestId === this.currentRequestId; }

	private _appendCoAuthorTrailers(message: string, modelSelection: ModelSelection | null): string {
		if (message.includes('Co-authored-by:')) { return message; }
		const platform = 'Co-authored-by: neuralinverse-dev <noreply@neuralinverse.com>';
		let llmTrailer: string;
		const provider = (modelSelection?.providerName ?? '').toLowerCase();
		const model = (modelSelection?.modelName ?? '').toLowerCase();
		if (provider.includes('openai') || model.includes('gpt') || model.includes('chatgpt') || model.includes('o1') || model.includes('o3') || model.includes('o4')) {
			llmTrailer = 'Co-authored-by: ChatGPT <noreply@openai.com>';
		} else if (provider.includes('google') || model.includes('gemini') || model.includes('gemma')) {
			llmTrailer = 'Co-authored-by: Gemini <noreply@google.com>';
		} else if (provider.includes('deepseek') || model.includes('deepseek')) {
			llmTrailer = 'Co-authored-by: DeepSeek <noreply@deepseek.com>';
		} else if (provider.includes('mistral') || model.includes('mistral') || model.includes('codestral')) {
			llmTrailer = 'Co-authored-by: Mistral <noreply@mistral.ai>';
		} else if (provider.includes('meta') || model.includes('llama')) {
			llmTrailer = 'Co-authored-by: Meta AI <noreply@meta.com>';
		} else {
			llmTrailer = 'Co-authored-by: Claude <noreply@anthropic.com>';
		}
		return `${message}\n\n${platform}\n${llmTrailer}`;
	}

	private onError(error: any) {
		if (!isCancellationError(error)) {
			console.error(error);
			this.notificationService.error(localize2('voidFailedToGenerateCommitMessage', 'Failed to generate commit message.').value);
		}
	}
}

registerSingleton(IVoidSCMService, VoidSCMServiceWeb, InstantiationType.Eager);
// Actions are already registered by voidSCMService.ts (loaded via void.contribution.ts).
// Only override the service implementations here.
registerSingleton(IGenerateCommitMessageService, GenerateCommitMessageServiceWeb, InstantiationType.Delayed);
