/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Non-Interactive Command Environment
 *
 * Instead of trying to predict which commands are interactive (impossible),
 * we set environment variables that universally signal "non-interactive mode"
 * to all well-behaved CLI tools. This is the same approach used by every
 * CI/CD system (GitHub Actions, GitLab CI, Jenkins, etc.).
 *
 * For the remaining commands that still hang, the terminal executor handles
 * it via inactivity timeout (no stdout for N seconds = kill).
 */

/**
 * Environment variables that signal non-interactive/CI mode.
 * These cause most CLI tools to:
 * - Skip interactive prompts and use defaults
 * - Disable color/spinner output
 * - Never open editors or pagers
 * - Auto-accept confirmations
 */
export const NON_INTERACTIVE_ENV: Record<string, string> = {
	// Universal CI detection (most tools check this)
	CI: 'true',
	// npm/npx: auto-yes for all prompts, skip update notifier
	NPM_CONFIG_YES: 'true',
	npm_config_yes: 'true',
	NO_UPDATE_NOTIFIER: '1',
	// yarn
	YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
	// pnpm
	PNPM_HOME: '',
	// Homebrew
	HOMEBREW_NO_AUTO_UPDATE: '1',
	// Debian/Ubuntu package managers
	DEBIAN_FRONTEND: 'noninteractive',
	// Git: don't open editor, don't prompt
	GIT_TERMINAL_PROMPT: '0',
	GIT_EDITOR: 'true',
	// General: disable pagers
	PAGER: 'cat',
	GIT_PAGER: 'cat',
	// Terraform/Ansible
	TF_INPUT: '0',
	ANSIBLE_NOCOLOR: '1',
	// Python: unbuffered output (so we see output immediately)
	PYTHONUNBUFFERED: '1',
	// Node: don't prompt for missing deps
	NODE_NO_WARNINGS: '1',
	// Cargo
	CARGO_TERM_COLOR: 'never',
	// .NET
	DOTNET_CLI_TELEMETRY_OPTOUT: '1',
	DOTNET_NOLOGO: '1',
};

/**
 * Builds the env prefix string to prepend to commands.
 * Format: `env VAR1=val1 VAR2=val2 command`
 */
export function buildEnvPrefix(): string {
	const pairs = Object.entries(NON_INTERACTIVE_ENV)
		.map(([k, v]) => `${k}=${v ? JSON.stringify(v) : '""'}`)
		.join(' ');
	return `env ${pairs}`;
}

/**
 * Wraps a command with the non-interactive environment.
 * This is the ONLY transformation we apply — no command rewriting,
 * no guessing, no regex matching.
 */
export function wrapNonInteractive(command: string): string {
	return `${buildEnvPrefix()} ${command}`;
}

/**
 * Inactivity timeout configuration.
 * If a command produces no stdout/stderr for this duration, it's considered hung.
 * The terminal executor should kill it and return whatever output was captured.
 */
export const INACTIVITY_TIMEOUT_MS = 15_000;

/**
 * Maximum time for any single command before forced kill.
 * Even "legitimate" long-running commands shouldn't block the agent forever.
 */
export const MAX_COMMAND_TIMEOUT_MS = 120_000;
