/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type LogicAnalyzerBackend = 'saleae' | 'digilent' | 'none';

export type LogicProtocol =
	| 'uart' | 'spi' | 'i2c' | 'can' | 'lin' | 'i2s'
	| 'jtag' | 'swd' | 'manchester' | 'modbus' | '1-wire';

export interface ILogicChannel {
	id: number;
	label: string;
	threshold: number;      // voltage threshold in V (e.g. 1.65 for 3.3V logic)
	pullup: boolean;
}

export interface IProtocolConfig {
	protocol: LogicProtocol;
	baudRate?: number;          // UART, CAN, LIN
	clockChannel?: number;      // SPI SCK, I2C SCL, JTAG TCK
	dataChannel?: number;       // SPI MOSI/MISO, I2C SDA, JTAG TDI
	csChannel?: number;         // SPI CS
	bitOrder?: 'msb' | 'lsb';  // SPI
	dataBits?: number;          // UART word length
	stopBits?: number;          // UART
	parity?: 'none' | 'even' | 'odd';
}

export interface IDecodedFrame {
	timestamp: number;           // seconds from capture start
	protocol: LogicProtocol;
	address?: number;            // I2C 7-bit address, SPI CS index
	data: number[];              // raw byte values
	dataHex: string;             // hex string, e.g. "0x48 0x65 0x6C"
	dataAscii: string;           // printable ASCII, non-printable as '.'
	direction?: 'read' | 'write' | 'unknown';
	error?: string;              // framing error, NAK, etc.
}

export interface ILogicCapture {
	captureId: string;
	backend: LogicAnalyzerBackend;
	channels: ILogicChannel[];
	durationSec: number;
	sampleRate: number;          // Hz
	frames: IDecodedFrame[];
	rawSamples?: Record<number, number[]>;  // channelId -> array of 0/1 bit values at sampleRate
	csvPath?: string;            // exported CSV file path
	nativePath?: string;         // .sal (Saleae) or .dwf capture file
	capturedAt: number;          // Date.now()
}

export interface ILogicTrigger {
	channel: number;
	edge: 'rising' | 'falling' | 'either';
	level?: number;              // voltage threshold override
}

export interface ILogicAnalyzerStatus {
	backend: LogicAnalyzerBackend;
	connected: boolean;
	availableChannels: number;
	maxSampleRateMHz: number;
	supportedProtocols: LogicProtocol[];
	error?: string;
}
