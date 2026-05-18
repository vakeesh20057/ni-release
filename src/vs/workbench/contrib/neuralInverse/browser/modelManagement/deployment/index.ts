/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../../platform/instantiation/common/extensions.js';
import { IDeploymentRegistryService, DeploymentRegistryService } from './deploymentRegistryService.js';
import { IDeploymentAutoConfigService, DeploymentAutoConfigService } from './autoConfigService.js';

registerSingleton(IDeploymentRegistryService, DeploymentRegistryService, InstantiationType.Delayed);
registerSingleton(IDeploymentAutoConfigService, DeploymentAutoConfigService, InstantiationType.Delayed);

export { IDeploymentRegistryService } from './deploymentRegistryService.js';
export { IDeploymentAutoConfigService } from './autoConfigService.js';
export {
	type IUnifiedDeployment,
	type ILocalDeployment,
	type ICloudDeploymentEntry,
	type IDeploymentEndpoint,
	type IAutoConfigRule,
	type DeploymentKind,
	type UnifiedDeploymentStatus,
	isLocalDeployment,
	isCloudDeployment,
	isDeploymentActive,
	getDeploymentEndpoint,
} from './deploymentTypes.js';
