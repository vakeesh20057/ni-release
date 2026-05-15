/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ModernisationSyncService -- Community Edition stub
 * ---------------------------------------------------
 * This is a no-op stub. Backend sync (persisting sessions and KB snapshots to
 * the NeuralInverse backend) is available in NeuralInverse Enterprise. In the
 * community edition this service exists only so that DI consumers of
 * IModernisationSyncService compile and bind without errors. All methods return
 * Promise.resolve() immediately and no network requests are made.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';

// --- Service Interface --------------------------------------------------------

export interface IModernisationSyncService {
	readonly _serviceBrand: undefined;
	/** Always false in the community edition -- no backend connection. */
	readonly isConnected: boolean;
	/** No-op in the community edition. */
	syncKBSnapshot(): Promise<void>;
}

export const IModernisationSyncService = createDecorator<IModernisationSyncService>('modernisationSyncService');

// --- Stub Implementation ------------------------------------------------------

class ModernisationSyncServiceStub extends Disposable implements IModernisationSyncService {
	declare readonly _serviceBrand: undefined;

	/** Always false -- backend sync is not available in the community edition. */
	readonly isConnected = false;

	constructor(
		@ILogService private readonly _log: ILogService,
	) {
		super();
		this._log.trace('[ModernisationSync] Community edition -- backend sync is not active.');
	}

	/** No-op. Backend sync and compliance dashboard are available in NeuralInverse Enterprise. */
	async syncKBSnapshot(): Promise<void> {
		// Intentional no-op in the community edition.
	}
}

registerSingleton(IModernisationSyncService, ModernisationSyncServiceStub, InstantiationType.Eager);
