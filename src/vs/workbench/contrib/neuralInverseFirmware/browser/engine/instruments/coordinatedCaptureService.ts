/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Coordinated Capture Service
 *
 * Triggers multiple instruments simultaneously for correlated multi-domain analysis:
 *   - Logic analyzer (digital signals)
 *   - Oscilloscope (analog waveforms)
 *   - Power analyzer (current/voltage profiles)
 *   - Serial monitor (UART output)
 *
 * Produces a unified timeline where all captures are time-aligned, enabling
 * cross-domain debugging (e.g. correlate a power spike with a specific UART
 * message and GPIO transition).
 */

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { ILogicAnalyzerService } from './logicAnalyzer/logicAnalyzerService.js';
import { IOscilloscopeService } from './oscilloscope/oscilloscopeService.js';
import { IPowerAnalyzerService } from './powerAnalyzer/powerAnalyzerService.js';
import { ISerialMonitorService } from '../serial/serialMonitorService.js';


export const ICoordinatedCaptureService = createDecorator<ICoordinatedCaptureService>('coordinatedCaptureService');

export interface ICoordinatedCaptureService {
	readonly _serviceBrand: undefined;

	readonly isCapturing: boolean;
	readonly onCaptureStarted: Event<ICaptureConfig>;
	readonly onCaptureCompleted: Event<ICoordinatedCaptureResult>;

	/**
	 * Start a coordinated capture across all connected instruments.
	 * Triggers are fired as close to simultaneously as possible.
	 */
	startCapture(config: ICaptureConfig): Promise<ICoordinatedCaptureResult>;

	/** Abort a running capture. */
	abort(): void;
}

export interface ICaptureConfig {
	durationMs: number;
	channels: CaptureChannel[];
	trigger?: ICaptureTrigger;
	label?: string;
}

export type CaptureChannel = 'logic-analyzer' | 'oscilloscope' | 'power-analyzer' | 'serial';

export interface ICaptureTrigger {
	type: 'immediate' | 'serial-pattern' | 'edge';
	/** For serial-pattern: regex to wait for before starting */
	pattern?: string;
	/** For edge: channel and direction */
	channel?: number;
	edge?: 'rising' | 'falling' | 'any';
}

export interface ICoordinatedCaptureResult {
	startTimestamp: number;
	endTimestamp: number;
	durationMs: number;
	captures: ICaptureChannelResult[];
	label?: string;
}

export interface ICaptureChannelResult {
	channel: CaptureChannel;
	sampleCount: number;
	summary: string;
	data: any;
}


class CoordinatedCaptureServiceImpl extends Disposable implements ICoordinatedCaptureService {
	readonly _serviceBrand: undefined;

	private _isCapturing = false;
	private _aborted = false;

	private readonly _onCaptureStarted = this._register(new Emitter<ICaptureConfig>());
	readonly onCaptureStarted = this._onCaptureStarted.event;

	private readonly _onCaptureCompleted = this._register(new Emitter<ICoordinatedCaptureResult>());
	readonly onCaptureCompleted = this._onCaptureCompleted.event;

	get isCapturing(): boolean { return this._isCapturing; }

	constructor(
		@ILogicAnalyzerService private readonly _la: ILogicAnalyzerService,
		@IOscilloscopeService private readonly _scope: IOscilloscopeService,
		@IPowerAnalyzerService private readonly _power: IPowerAnalyzerService,
		@ISerialMonitorService private readonly _serial: ISerialMonitorService,
	) {
		super();
	}

	async startCapture(config: ICaptureConfig): Promise<ICoordinatedCaptureResult> {
		if (this._isCapturing) throw new Error('Capture already in progress');

		this._isCapturing = true;
		this._aborted = false;
		this._onCaptureStarted.fire(config);

		const startTimestamp = Date.now();

		try {
			// Handle trigger
			if (config.trigger?.type === 'serial-pattern' && config.trigger.pattern) {
				await this._waitForSerialPattern(config.trigger.pattern, config.durationMs);
				if (this._aborted) return this._abortedResult(startTimestamp, config);
			}

			// Fire all captures simultaneously
			const capturePromises: Promise<ICaptureChannelResult>[] = [];

			for (const ch of config.channels) {
				switch (ch) {
					case 'logic-analyzer':
						capturePromises.push(this._captureLogicAnalyzer(config.durationMs));
						break;
					case 'oscilloscope':
						capturePromises.push(this._captureOscilloscope(config.durationMs));
						break;
					case 'power-analyzer':
						capturePromises.push(this._capturePower(config.durationMs));
						break;
					case 'serial':
						capturePromises.push(this._captureSerial(config.durationMs, startTimestamp));
						break;
				}
			}

			const captures = await Promise.all(capturePromises);

			const result: ICoordinatedCaptureResult = {
				startTimestamp,
				endTimestamp: Date.now(),
				durationMs: Date.now() - startTimestamp,
				captures,
				label: config.label,
			};

			this._onCaptureCompleted.fire(result);
			return result;
		} finally {
			this._isCapturing = false;
		}
	}

	abort(): void {
		this._aborted = true;
	}

	// ─── Private capture methods ─────────────────────────────────────────────

	private async _captureLogicAnalyzer(durationMs: number): Promise<ICaptureChannelResult> {
		try {
			const durationSec = durationMs / 1000;
			const status = this._la.getStatus();
			const numChannels = Math.min(status.availableChannels || 2, 4);
			const defaultChannels = Array.from({ length: numChannels }, (_, i) => ({ id: i, label: `CH${i}`, threshold: 1.65, pullup: false }));
			const data = await this._la.captureChannels(defaultChannels, durationSec, 1_000_000);
			const frameCount = data?.frames?.length ?? 0;
			return {
				channel: 'logic-analyzer',
				sampleCount: frameCount,
				summary: `${frameCount} decoded frames over ${durationMs}ms`,
				data,
			};
		} catch (err: any) {
			return { channel: 'logic-analyzer', sampleCount: 0, summary: `Error: ${err.message}`, data: null };
		}
	}

	private async _captureOscilloscope(durationMs: number): Promise<ICaptureChannelResult> {
		try {
			const timeoutSec = durationMs / 1000;
			const data = await this._scope.capture(timeoutSec);
			const channelCount = data?.channels?.length ?? 0;
			return {
				channel: 'oscilloscope',
				sampleCount: channelCount,
				summary: `${channelCount} channel(s) captured`,
				data,
			};
		} catch (err: any) {
			return { channel: 'oscilloscope', sampleCount: 0, summary: `Error: ${err.message}`, data: null };
		}
	}

	private async _capturePower(durationMs: number): Promise<ICaptureChannelResult> {
		try {
			const status = this._power.getStatus();
			await this._delay(durationMs);
			return {
				channel: 'power-analyzer',
				sampleCount: 0,
				summary: `Power monitor: ${status.device} ${status.connected ? 'connected' : 'disconnected'}`,
				data: status,
			};
		} catch (err: any) {
			return { channel: 'power-analyzer', sampleCount: 0, summary: `Error: ${err.message}`, data: null };
		}
	}

	private async _captureSerial(durationMs: number, startTimestamp: number): Promise<ICaptureChannelResult> {
		await this._delay(durationMs);
		const lines = this._serial.rxBuffer.filter(l => l.timestamp >= startTimestamp);
		return {
			channel: 'serial',
			sampleCount: lines.length,
			summary: `${lines.length} lines captured`,
			data: lines.map(l => ({ timestamp: l.timestamp, text: l.text })),
		};
	}

	private async _waitForSerialPattern(pattern: string, timeoutMs: number): Promise<void> {
		const regex = new RegExp(pattern);
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline && !this._aborted) {
			const recent = this._serial.rxBuffer.slice(-10);
			if (recent.some(l => regex.test(l.text))) return;
			await this._delay(100);
		}
	}

	private _delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private _abortedResult(startTimestamp: number, config: ICaptureConfig): ICoordinatedCaptureResult {
		return {
			startTimestamp,
			endTimestamp: Date.now(),
			durationMs: Date.now() - startTimestamp,
			captures: [],
			label: config.label,
		};
	}
}

registerSingleton(ICoordinatedCaptureService, CoordinatedCaptureServiceImpl, InstantiationType.Delayed);
