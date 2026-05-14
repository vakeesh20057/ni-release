/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neural Inverse, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css'
import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { Sidebar } from './Sidebar.js'

export const mountSidebar = mountFnGenerator(Sidebar)
