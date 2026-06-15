/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js'
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'

export interface IUserInputRequest {
	id: string
	question: string
	resolve: (answer: string) => void
	reject: () => void
}

export interface IUserInputRequestService {
	readonly _serviceBrand: undefined
	readonly onDidChangeRequests: Event<void>
	readonly pendingRequests: ReadonlyMap<string, IUserInputRequest>
	/**
	 * Called by chatThreadService right before running ask_user so the tool call ID
	 * is used as the request key (making it accessible to the UI via toolMessage.id).
	 */
	setNextToolCallId(toolCallId: string): void
	request(question: string): Promise<string>
	respond(id: string, answer: string): void
	cancel(id: string): void
}

export const IUserInputRequestService = createDecorator<IUserInputRequestService>('userInputRequestService')

class UserInputRequestService implements IUserInputRequestService {
	readonly _serviceBrand: undefined

	private readonly _onDidChangeRequests = new Emitter<void>()
	readonly onDidChangeRequests = this._onDidChangeRequests.event

	private readonly _pending = new Map<string, IUserInputRequest>()
	get pendingRequests(): ReadonlyMap<string, IUserInputRequest> { return this._pending }

	private _nextToolCallId: string | null = null

	setNextToolCallId(toolCallId: string): void {
		this._nextToolCallId = toolCallId
	}

	request(question: string): Promise<string> {
		const id = this._nextToolCallId ?? question
		this._nextToolCallId = null
		return new Promise<string>((resolve, reject) => {
			const entry: IUserInputRequest = { id, question, resolve, reject }
			this._pending.set(id, entry)
			this._onDidChangeRequests.fire()
		})
	}

	respond(id: string, answer: string): void {
		const entry = this._pending.get(id)
		if (!entry) return
		this._pending.delete(id)
		this._onDidChangeRequests.fire()
		entry.resolve(answer)
	}

	cancel(id: string): void {
		const entry = this._pending.get(id)
		if (!entry) return
		this._pending.delete(id)
		this._onDidChangeRequests.fire()
		entry.reject()
	}
}

registerSingleton(IUserInputRequestService, UserInputRequestService, InstantiationType.Delayed)
