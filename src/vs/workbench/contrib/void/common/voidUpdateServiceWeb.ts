/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IVoidUpdateService } from './voidUpdateService.js';

// Web stub — auto-update is not applicable in serve-web/cloud workspace mode.
class VoidUpdateServiceWeb implements IVoidUpdateService {
	readonly _serviceBrand: undefined;
	async check(_explicit: boolean) { return null; }
	async applyAutoUpdate() { /* no-op */ }
}

registerSingleton(IVoidUpdateService, VoidUpdateServiceWeb, InstantiationType.Eager);
