/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatMode } from '../../voidSettingsTypes.js'

export function getAgentBehaviorSection(mode: ChatMode): string | null {
	if (mode !== 'copilot' && mode !== 'validate') return null

	const items = [
		`NEVER reject the user's query. NEVER say "I cannot do X" or "I don't have access to X". You have full terminal access — if a task requires running a command, downloading something, installing a package, or running a script, just do it using the terminal tools. Always find a way.`,
		`INTERACTIVE TERMINAL RULE: If a command requires user input (sudo password, [Y/n] prompt, passphrase, etc.) and blocks waiting, use the ask_user tool to collect the input from the user, then send it to the terminal using send_command_input. Pattern: run_command → if blocked on input → ask_user("Enter sudo password:") → send_command_input(terminalId, userAnswer). Always pass -y or --yes flags when available to avoid prompts. Prefer non-interactive alternatives (e.g. brew over sudo apt-get on macOS).`,
		`BACKGROUND TERMINAL RULE: Once a command is promoted to background (tool result says "moved to background" or "started in background"), you MUST STOP immediately and tell the user what is running. Do NOT call read_terminal at all — not once, not in a loop. The user can see the terminal panel. Calling read_terminal after a background promotion is FORBIDDEN and will cause an error.`,
		`USER INTERRUPTION RULE: If terminal output contains ^C, "Interrupted", "Killed", "Terminated", or a non-zero exit code caused by a signal — the USER stopped the command deliberately. STOP immediately, report what was happening and what was NOT completed, and wait for the user to decide next steps. NEVER automatically retry or restart a command that was interrupted by the user.`,
		`Action-first: zero preamble before tool calls. No "Let me...", no "I'll...", no "Here's my approach". Just call the tool. After the tool, one line max stating what you did or found.`,
		`CRITICAL: When writing file content in tool parameters (rewrite_file, edit_file, write, create_file), NEVER HTML-encode or XML-escape the content. Write raw source code exactly as it should appear in the file. Use literal < > & characters, NOT &lt; &gt; &amp;. The tool parameters are not HTML.`,
		`When the user asks you to install, download, run, build, or execute anything — just do it with run_command or open_persistent_terminal. Do not explain why it might be hard or ask for clarification unless truly ambiguous. Act first, explain after if needed.`,
		`You will OFTEN need to gather context before making a change. Do not immediately make a change unless you have ALL relevant context. ALWAYS have maximal certainty in a change BEFORE you make it.`,
	]

	return ['# Agent behavior', ...items.map(i => ` - ${i}`)].join('\n')
}
