/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PowerAnalyzerDevice = 'ppk2' | 'js110' | 'js220' | 'none';
export type PowerMeasurementMode = 'source' | 'ampere';

export interface IPowerConfig {
	device: PowerAnalyzerDevice;
	mode: PowerMeasurementMode;
	voltageV?: number;           // DUT supply voltage (source mode); 0.8-5.0 V
	sampleRateKHz?: number;      // default: 100 kHz for PPK2, 1000 kHz for JS220
}

export interface IPowerSample {
	timestamp: number;           // milliseconds from session start
	currentUa: number;           // microamps
	voltageV: number;            // volts (measured, not set)
}

export interface IPowerResult {
	sessionId: string;
	avgUa: number;
	minUa: number;
	maxUa: number;
	peakUa: number;              // instantaneous maximum
	chargeUC: number;            // microcoulombs
	energyUJ: number;            // microjoules
	voltageV: number;            // average measured voltage
	durationMs: number;
	sampleCount: number;
	samples?: IPowerSample[];    // included for captures < 10 seconds
	jlsPath?: string;            // .jls file path for long captures
}

export interface IPowerTrigger {
	gpiPin: 0 | 1 | 2 | 3;      // Joulescope GPI0-3
	edge: 'rising' | 'falling';
	timeoutSec?: number;         // default 30
}

export interface IPowerAnalyzerStatus {
	device: PowerAnalyzerDevice;
	connected: boolean;
	firmwareVersion?: string;
	calibrated?: boolean;
	error?: string;
}

export interface IPowerSession {
	sessionId: string;
	config: IPowerConfig;
	startedAt: number;
	running: boolean;
}
