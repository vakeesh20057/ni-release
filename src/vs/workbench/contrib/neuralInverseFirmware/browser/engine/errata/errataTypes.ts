/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IErrata } from '../../../common/firmwareTypes.js';

export interface IErrataMatch {
	errata: IErrata;
	relevanceScore: number;
	matchReason: string;
}

export interface IErrataQuery {
	peripheral?: string;
	operation?: string;
	mcuFamily?: string;
	mcuVariant?: string;
	register?: string;
}
