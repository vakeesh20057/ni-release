/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IRegisterComposition {
	peripheral: string;
	register: string;
	value: number;
	fields: IFieldComposition[];
	hexString: string;
	binaryString: string;
}

export interface IFieldComposition {
	name: string;
	bitOffset: number;
	bitWidth: number;
	value: number;
	valueName?: string;     // Enumerated value label, e.g. "8-bit word length"
	description?: string;
}

export interface IDecodedRegister {
	peripheral: string;
	register: string;
	rawValue: number;
	hexString: string;
	binaryString: string;
	fields: IDecodedField[];
	unknownBits: number;   // Bits set that don't map to any known field
}

export interface IDecodedField {
	name: string;
	bitOffset: number;
	bitWidth: number;
	rawValue: number;
	meaning: string;        // Human-readable: "Baud rate = 115200" or "Word length = 8 bits"
	access: string;         // "rw", "r", "w"
}

export interface IRegisterDiff {
	peripheral: string;
	register: string;
	before: number;
	after: number;
	changedFields: IFieldDiff[];
}

export interface IFieldDiff {
	name: string;
	bitOffset: number;
	bitWidth: number;
	before: number;
	beforeMeaning: string;
	after: number;
	afterMeaning: string;
}
