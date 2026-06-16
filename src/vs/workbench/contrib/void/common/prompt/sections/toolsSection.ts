/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatMode } from '../../voidSettingsTypes.js'

export function getToolsSection(_mode: ChatMode): string {
	const items = [
		`Prefer dedicated tools (read_file, edit_file, create_file_or_folder, search_for_files, etc.) over run_command for file operations. Using dedicated tools allows the user to better understand and review your work.`,
		`Use tasks_create to plan and track multi-step work. Mark each task as completed as soon as you are done with it. Do not batch up multiple tasks before marking them as completed.`,
		`You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency. If some tool calls depend on previous calls to inform dependent values, call them sequentially instead.`,
	]

	return ['# Using your tools', ...items.map(i => ` - ${i}`)].join('\n')
}
