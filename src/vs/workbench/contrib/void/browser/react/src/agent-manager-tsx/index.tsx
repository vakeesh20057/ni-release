/*--------------------------------------------------------------------------------------
 *  Copyright (c) NeuralInverse. All rights reserved.
 *  Agent Manager — Mount entry point.
 *--------------------------------------------------------------------------------------*/

import '../styles.css'
import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { AgentManager } from './AgentManager.js'

export const mountAgentManager = mountFnGenerator(AgentManager)
