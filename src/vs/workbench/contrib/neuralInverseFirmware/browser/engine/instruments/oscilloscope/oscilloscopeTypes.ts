/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IScopeInfo {
	host: string;
	port: number;
	model: string;
	serialNumber: string;
	firmware: string;
	manufacturer: string;
}

export type ScopeCoupling = 'DC' | 'AC' | 'GND';
export type ScopeTriggerEdge = 'POS' | 'NEG' | 'RFAL';
export type ScopeProbeAttenuation = 1 | 10 | 100;

export interface IScopeChannelConfig {
	channel: 1 | 2 | 3 | 4;
	vDiv: number;                   // volts per division
	coupling: ScopeCoupling;
	probe: ScopeProbeAttenuation;
	offset?: number;                // vertical offset in V
	enabled: boolean;
}

export interface IScopeTriggerConfig {
	source: string;                 // 'C1', 'C2', 'EXT', 'LINE'
	edge: ScopeTriggerEdge;
	level: number;                  // trigger level in V
	mode: 'AUTO' | 'NORM' | 'SING';
}

export interface IScopeWaveform {
	channel: number;
	voltages: number[];             // sampled voltage values in V
	timebase: number;               // seconds per division
	sampleRate: number;             // Hz
	triggerOffset: number;          // seconds from start to trigger point
	vDiv: number;
	vOffset: number;
}

export interface IScopeCapture {
	captureId: string;
	channels: IScopeWaveform[];
	timebase: number;
	triggerPoint: number;           // fractional position 0..1
	capturedAt: number;
	bmpPath?: string;               // screenshot BMP path
}

export interface IScopeMeasurement {
	parameter: string;              // 'FREQ', 'RISE', 'FALL', 'PKPK', 'MEAN', 'RMS', 'DUTY'
	channel: number;
	value: number;
	unit: string;
	min?: number;
	max?: number;
}

export interface IScopeStatus {
	connected: boolean;
	host?: string;
	model?: string;
	channelCount?: number;
	error?: string;
}
