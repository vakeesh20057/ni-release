/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMetricsService } from './metricsService.js';

// Web stub — no Electron main process available in serve-web mode.
class MetricsServiceWeb implements IMetricsService {
	readonly _serviceBrand: undefined;
	capture(_event: string, _params: Record<string, any>): void { /* no-op */ }
	setOptOut(_val: boolean): void { /* no-op */ }
	async getDebuggingProperties(): Promise<object> { return { env: 'web' }; }
}

registerSingleton(IMetricsService, MetricsServiceWeb, InstantiationType.Eager);
