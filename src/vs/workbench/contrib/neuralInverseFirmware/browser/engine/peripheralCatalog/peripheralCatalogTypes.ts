/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PeripheralCategory =
	| 'imu'
	| 'barometer'
	| 'temperature'
	| 'humidity'
	| 'gas'
	| 'distance'
	| 'light'
	| 'color'
	| 'gesture'
	| 'heartrate'
	| 'display'
	| 'flash'
	| 'eeprom'
	| 'adc'
	| 'dac'
	| 'motor-driver'
	| 'stepper'
	| 'transceiver'
	| 'rtc'
	| 'current-sense'
	| 'power-management'
	| 'audio'
	| 'touch'
	| 'gps'
	| 'camera'
	| 'ethernet'
	| 'can-transceiver'
	| 'io-expander'
	| 'other';

export type PeripheralInterface = 'i2c' | 'spi' | 'uart' | 'i2s' | 'usb' | 'one-wire' | 'can' | 'pwm' | 'analog' | 'gpio';

export interface IPeripheralCatalogEntry {
	partNumber: string;
	aliases?: string[];              // alternative part numbers
	manufacturer: string;
	description: string;
	category: PeripheralCategory;
	interfaces: PeripheralInterface[];
	datasheetUrl?: string;
	vddMin?: number;                 // minimum supply voltage V
	vddMax?: number;                 // maximum supply voltage V
	i2cAddress?: number[];           // possible I2C addresses (7-bit)
	spiMode?: 0 | 1 | 2 | 3;       // SPI clock polarity/phase mode
	spiMaxMHz?: number;              // max SPI clock frequency
	uart?: { baudRate: number; format: string };
	packageTypes?: string[];         // physical packages: SOT-23, TSSOP, etc.
	agentHints: string[];            // hints for AI code generation
	driverExamples?: string[];       // code snippet examples
}
