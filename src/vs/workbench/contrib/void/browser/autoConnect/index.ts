/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export { IAutoConnectService } from './autoConnectService.js';
export type { IDetectedCredential, CredentialSource } from './autoConnectTypes.js';
export { ENV_VAR_MAP, AWS_ENV_VARS, AZURE_ENV_VARS, GCP_ENV_VARS } from './autoConnectTypes.js';
export { detectAllCredentials, detectEnvVarCredentials, detectAwsCredentials, detectAzureCredentials, detectGcpCredentials } from './envVarDetector.js';
