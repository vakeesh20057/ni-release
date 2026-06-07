/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILLMMessageService } from './sendLLMMessageService.js';
import {
	ServiceSendLLMMessageParams, ServiceModelListParams,
	OllamaModelResponse, OpenaiCompatibleModelResponse,
	SendLLMMessageParams,
} from './sendLLMMessageTypes.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { IMCPService } from './mcpService.js';
import { IMetricsService } from './metricsService.js';
import { sendLLMMessage } from '../electron-main/llmMessage/sendLLMMessage.js';

// Web implementation of ILLMMessageService.
// Calls sendLLMMessage() directly in the browser (no Electron IPC).
// All LLM SDKs used (Anthropic, OpenAI, Gemini, Mistral, Ollama) are fetch-based and work in browser.
// AWS Bedrock and Google Vertex (which need Node.js credential providers) will error gracefully.
export class LLMMessageServiceWeb extends Disposable implements ILLMMessageService {
	readonly _serviceBrand: undefined;

	private readonly abortRefs: { [requestId: string]: (() => void) } = {};
	private readonly onAbortHooks: { [requestId: string]: (() => void) } = {};

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IMCPService private readonly mcpService: IMCPService,
		@IMetricsService private readonly metricsService: IMetricsService,
	) {
		super();
	}

	sendLLMMessage(params: ServiceSendLLMMessageParams): string | null {
		const { onText, onFinalMessage, onError, onAbort, modelSelection, mcpTools: extraTools, ...rest } = params;

		if (modelSelection === null) {
			onError({ message: 'Please add a provider in Neural Inverse LLM Settings.', fullError: null });
			return null;
		}
		if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
			onError({ message: 'No messages detected.', fullError: null });
			return null;
		}

		const { settingsOfProvider } = this.voidSettingsService.state;
		const mcpTools = (extraTools !== undefined
			? extraTools
			: (this.mcpService.getMCPTools() || [])
		).slice(0, 128);

		const requestId = generateUuid();
		const abortRef: SendLLMMessageParams['abortRef'] = { current: null };

		this.onAbortHooks[requestId] = onAbort;
		// register aborter — will be populated by sendLLMMessage after it starts
		this.abortRefs[requestId] = () => abortRef.current?.();

		const llmParams: SendLLMMessageParams = {
			...rest as any,
			modelSelection,
			settingsOfProvider,
			mcpTools,
			abortRef,
			onText,
			onFinalMessage: (p) => {
				this._clearHooks(requestId);
				onFinalMessage(p);
			},
			onError: (p) => {
				this._clearHooks(requestId);
				onError(p);
			},
		};

		sendLLMMessage(llmParams, this.metricsService);

		return requestId;
	}

	abort(requestId: string): void {
		this.onAbortHooks[requestId]?.();
		this.abortRefs[requestId]?.();
		this._clearHooks(requestId);
	}

	ollamaList(params: ServiceModelListParams<OllamaModelResponse>): void {
		// Ollama is HTTP-based; dynamically import and call the list function directly
		const { onSuccess, onError } = params;
		const { settingsOfProvider } = this.voidSettingsService.state;
		import('../electron-main/llmMessage/sendLLMMessage.impl.js').then((mod: any) => {
			const listFn = mod.sendLLMMessageToProviderImplementation?.['ollama']?.list;
			if (!listFn) { onError({ error: 'Ollama list not available', requestId: '' }); return; }
			listFn({ settingsOfProvider, providerName: 'ollama', onSuccess, onError });
		}).catch(e => onError({ error: String(e), requestId: '' }));
	}

	openAICompatibleList(params: ServiceModelListParams<OpenaiCompatibleModelResponse>): void {
		const { onSuccess, onError } = params;
		const { settingsOfProvider } = this.voidSettingsService.state;
		import('../electron-main/llmMessage/sendLLMMessage.impl.js').then((mod: any) => {
			const listFn = mod.sendLLMMessageToProviderImplementation?.['openAICompatible']?.list;
			if (!listFn) { onError({ error: 'OpenAI-compatible list not available', requestId: '' }); return; }
			listFn({ settingsOfProvider, providerName: 'openAICompatible', onSuccess, onError });
		}).catch(e => onError({ error: String(e), requestId: '' }));
	}

	private _clearHooks(requestId: string) {
		delete this.abortRefs[requestId];
		delete this.onAbortHooks[requestId];
	}
}

registerSingleton(ILLMMessageService, LLMMessageServiceWeb, InstantiationType.Eager);
