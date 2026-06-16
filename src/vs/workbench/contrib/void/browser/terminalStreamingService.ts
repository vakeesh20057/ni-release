/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Terminal Streaming Service — chunked output forwarding for long-running commands.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

export interface IStreamChunk {
	processId: string;
	terminalId: string;
	content: string;
	timestamp: number;
	isFinal: boolean;
}

export interface ITerminalStreamingService {
	readonly _serviceBrand: undefined;

	readonly onDidReceiveChunk: Event<IStreamChunk>;

	startStreaming(processId: string, terminalId: string): void;
	appendOutput(processId: string, data: string): void;
	flushAndStop(processId: string): void;

	getBufferedOutput(processId: string): string;
	getStreamingInterval(): number;
	setStreamingInterval(ms: number): void;
}

export const ITerminalStreamingService = createDecorator<ITerminalStreamingService>('terminalStreamingService');

interface StreamState {
	processId: string;
	terminalId: string;
	buffer: string;
	intervalHandle: ReturnType<typeof setInterval> | undefined;
}

class TerminalStreamingService extends Disposable implements ITerminalStreamingService {
	readonly _serviceBrand: undefined;

	private _streams = new Map<string, StreamState>();
	private _streamingIntervalMs = 2_000;

	private readonly _onDidReceiveChunk = this._register(new Emitter<IStreamChunk>());
	readonly onDidReceiveChunk = this._onDidReceiveChunk.event;

	startStreaming(processId: string, terminalId: string): void {
		if (this._streams.has(processId)) { return; }

		const state: StreamState = {
			processId,
			terminalId,
			buffer: '',
			intervalHandle: undefined,
		};

		state.intervalHandle = setInterval(() => {
			this._flush(state, false);
		}, this._streamingIntervalMs);

		this._streams.set(processId, state);
	}

	appendOutput(processId: string, data: string): void {
		const state = this._streams.get(processId);
		if (state) {
			state.buffer += data;
		}
	}

	flushAndStop(processId: string): void {
		const state = this._streams.get(processId);
		if (state) {
			this._flush(state, true);
			if (state.intervalHandle) {
				clearInterval(state.intervalHandle);
			}
			this._streams.delete(processId);
		}
	}

	getBufferedOutput(processId: string): string {
		return this._streams.get(processId)?.buffer ?? '';
	}

	getStreamingInterval(): number {
		return this._streamingIntervalMs;
	}

	setStreamingInterval(ms: number): void {
		this._streamingIntervalMs = Math.max(500, Math.min(ms, 30_000));
	}

	private _flush(state: StreamState, isFinal: boolean): void {
		if (state.buffer.length === 0 && !isFinal) { return; }

		this._onDidReceiveChunk.fire({
			processId: state.processId,
			terminalId: state.terminalId,
			content: state.buffer,
			timestamp: Date.now(),
			isFinal,
		});

		state.buffer = '';
	}

	override dispose(): void {
		for (const state of this._streams.values()) {
			if (state.intervalHandle) {
				clearInterval(state.intervalHandle);
			}
		}
		this._streams.clear();
		super.dispose();
	}
}

registerSingleton(ITerminalStreamingService, TerminalStreamingService, InstantiationType.Delayed);
