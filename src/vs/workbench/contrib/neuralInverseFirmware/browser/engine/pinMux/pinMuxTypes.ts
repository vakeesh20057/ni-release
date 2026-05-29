/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPinIdentifier {
	port: string;   // 'A', 'B', 'C', ...
	pin: number;    // 0-15
}

export interface IPinAllocation {
	pin: IPinIdentifier;
	peripheral: string;       // e.g. "USART1"
	signal: string;           // e.g. "USART1_TX"
	af: number;               // AF0-AF15
	source: PinAllocationSource;
	fileUri?: string;
	lineNumber?: number;
}

export type PinAllocationSource = 'codegen' | 'source-scan' | 'user-declared' | 'ioc-file';

export interface IPinConflict {
	pin: IPinIdentifier;
	allocations: IPinAllocation[];
	severity: 'error' | 'warning';
	message: string;
}

export interface IPinSuggestion {
	pin: IPinIdentifier;
	af: number;
	signal: string;
	reason: string;
}

export interface IPinAvailability {
	pin: IPinIdentifier;
	allocated: boolean;
	currentAllocation?: IPinAllocation;
	availableAFs: { af: number; signal: string }[];
}

export function pinId(port: string, pin: number): IPinIdentifier {
	return { port: port.toUpperCase(), pin };
}

export function pinKey(p: IPinIdentifier): string {
	return `P${p.port}${p.pin}`;
}

export function parsePinKey(key: string): IPinIdentifier | null {
	const m = key.match(/^P([A-K])(\d+)$/);
	if (!m) { return null; }
	return { port: m[1], pin: parseInt(m[2]) };
}
