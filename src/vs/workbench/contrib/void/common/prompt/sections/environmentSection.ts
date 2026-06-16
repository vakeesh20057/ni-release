/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatMode } from '../../voidSettingsTypes.js'
import { os } from '../../helpers/systemInfo.js'

export type EnvironmentSectionParams = {
	workspaceFolders: string[]
	openedURIs: string[]
	activeURI: string | undefined
	persistentTerminalIDs: string[]
	directoryStr: string
	mode: ChatMode
}

export function getEnvironmentSection(params: EnvironmentSectionParams): string {
	const { workspaceFolders, openedURIs, activeURI, persistentTerminalIDs, directoryStr, mode } = params

	const sysInfo = `Here is the user's system information:
<system_info>
- ${os}

- The user's workspace contains these folders:
${workspaceFolders.join('\n') || 'NO FOLDERS OPEN'}

- Active file:
${activeURI}

- Open files:
${openedURIs.join('\n') || 'NO OPENED FILES'}${(mode === 'copilot' || mode === 'validate' || mode === 'reason' || mode === 'ask') && persistentTerminalIDs.length !== 0 ? `

- Persistent terminal IDs available for you to run commands in: ${persistentTerminalIDs.join(', ')}` : ''}
</system_info>`

	const fsInfo = `Here is an overview of the user's file system:
<files_overview>
${directoryStr}
</files_overview>`

	return [sysInfo, fsInfo].join('\n\n')
}
