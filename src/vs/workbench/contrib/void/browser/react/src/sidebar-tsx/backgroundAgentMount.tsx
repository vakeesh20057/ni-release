/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

import '../styles.css'
import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { BackgroundAgentConsole } from './BackgroundAgentConsole.js'

export const mountBackgroundAgents = mountFnGenerator(BackgroundAgentConsole)
