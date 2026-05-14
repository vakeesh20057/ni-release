/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * @deprecated Use IAgentStoreService from browser/agentStoreService.ts.
 *
 * IAgentDefinition has moved to common/workflowTypes.ts.
 * IAgentStoreService (JSON-based, full CRUD, withInverseWriteAccess) is in
 * browser/agentStoreService.ts.
 *
 * This file is kept only to avoid breaking any stale imports during migration.
 */

export type { IAgentDefinition } from './workflowTypes.js';
