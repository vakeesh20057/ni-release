/*---------------------------------------------------------------------------------------------
 *  Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Bash command security validation for Power Mode.
 *
 * Adapted from Claude Code's bashSecurity.ts and pathValidation.ts.
 * Uses regex-based detection (no tree-sitter) suitable for browser/renderer context.
 *
 * Checks 23+ distinct attack vectors including command substitution, injection patterns,
 * Zsh-specific bypasses, obfuscated flags, brace expansion attacks, unicode whitespace,
 * dangerous paths, and pipe-to-shell.
 */

export interface IBashSecurityResult {
	safe: boolean;
	issues: IBashSecurityIssue[];
}

export interface IBashSecurityIssue {
	severity: 'block' | 'warn';
	code: string;
	message: string;
}

export interface IPathValidationResult {
	valid: boolean;
	escapedPaths: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COMMAND_SUBSTITUTION_PATTERNS = [
	{ pattern: /<\(/, message: 'process substitution <()' },
	{ pattern: />\(/, message: 'process substitution >()' },
	{ pattern: /=\(/, message: 'Zsh process substitution =()' },
	// Zsh EQUALS expansion: =cmd at word start expands to $(which cmd), bypassing deny rules
	{ pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, message: 'Zsh equals expansion (=cmd)' },
	{ pattern: /\$\(/, message: '$() command substitution' },
	{ pattern: /\$\{/, message: '${} parameter substitution' },
	{ pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
	{ pattern: /~\[/, message: 'Zsh-style parameter expansion' },
	{ pattern: /\(e:/, message: 'Zsh glob qualifier with command execution' },
	{ pattern: /\(\+/, message: 'Zsh glob qualifier with command execution' },
	{ pattern: /\}\s*always\s*\{/, message: 'Zsh always block (try/always construct)' },
	{ pattern: /<#/, message: 'PowerShell comment syntax' },
];

const ZSH_DANGEROUS_COMMANDS = new Set([
	'zmodload', 'emulate',
	'sysopen', 'sysread', 'syswrite', 'sysseek',
	'zpty', 'ztcp', 'zsocket',
	'mapfile',
	'zf_rm', 'zf_mv', 'zf_ln', 'zf_chmod', 'zf_chown', 'zf_mkdir', 'zf_rmdir', 'zf_chgrp',
]);

const DANGEROUS_REMOVAL_PATHS = new Set([
	'/', '/bin', '/boot', '/dev', '/etc', '/home',
	'/lib', '/lib64', '/opt', '/proc', '/root',
	'/sbin', '/sys', '/usr', '/var',
]);

// Unicode whitespace that can trick parsers
const UNICODE_WS_RE = /[   -     　﻿]/;

// ─── Quote stripping helpers ──────────────────────────────────────────────────

/**
 * Returns the command with double-quoted and single-quoted strings removed.
 * Preserves structure for pattern matching on unquoted content.
 */
function stripQuotedStrings(cmd: string): string {
	// Remove single-quoted strings
	let result = cmd.replace(/'[^']*'/g, "''");
	// Remove double-quoted strings (simplified — doesn't handle \" inside)
	result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
	return result;
}

/** Extract the base command (first word) from a compound command. */
function getBaseCommand(command: string): string {
	const trimmed = command.trimStart();
	// Skip env var assignments (FOO=bar cmd)
	const parts = trimmed.split(/\s+/);
	for (const part of parts) {
		if (!/^[A-Z_][A-Z0-9_]*=/.test(part)) {
			return part.split('/').pop() ?? '';
		}
	}
	return '';
}

// ─── Individual validators ────────────────────────────────────────────────────

function checkEmpty(command: string): IBashSecurityIssue | null {
	if (!command.trim()) { return null; }
	return null;
}

function checkIncompleteCommands(command: string): IBashSecurityIssue | null {
	const trimmed = command.trim();
	// Pipe at end
	if (/\|\s*$/.test(trimmed)) {
		return { severity: 'warn', code: 'INCOMPLETE_PIPE', message: 'Command ends with a pipe — incomplete command' };
	}
	// Logical operator at end
	if (/(?:&&|\|\|)\s*$/.test(trimmed)) {
		return { severity: 'warn', code: 'INCOMPLETE_OPERATOR', message: 'Command ends with && or || — incomplete command' };
	}
	return null;
}

function checkGitCommit(command: string): IBashSecurityIssue | null {
	// git commit with -m is safe IF no backslashes (backslash can cause quote boundary confusion)
	const base = getBaseCommand(command);
	if (base === 'git' && /^git\s+commit\s+/.test(command)) {
		if (!command.includes('\\')) {
			// Safe git commit — allow through early
			return null;
		}
	}
	return null; // not a git commit, continue other checks
}

function checkCommandSubstitution(command: string): IBashSecurityIssue | null {
	// Allow git commit -m "..." with $() — that's the co-author injection we do ourselves
	const base = getBaseCommand(command);
	if (base === 'git' && /^git\s+commit\s+/.test(command) && !command.includes('\\')) {
		return null;
	}

	const unquoted = stripQuotedStrings(command);
	for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
		if (pattern.test(unquoted)) {
			return {
				severity: 'warn',
				code: 'COMMAND_SUBSTITUTION',
				message: `Command contains ${message} which may enable code injection`,
			};
		}
	}

	// Backticks (check separately — distinguish escaped vs unescaped)
	if (/(?<!\\)`/.test(unquoted)) {
		return {
			severity: 'warn',
			code: 'BACKTICK_SUBSTITUTION',
			message: 'Command contains unescaped backtick command substitution',
		};
	}

	return null;
}

function checkObfuscatedFlags(command: string): IBashSecurityIssue | null {
	const base = getBaseCommand(command);
	const hasOperators = /[|&;]/.test(command);

	// echo is safe for ANSI-C quoting unless compound
	if (base === 'echo' && !hasOperators) { return null; }

	// ANSI-C quoting: $'...' can encode any character
	if (/\$'[^']*'/.test(command)) {
		return {
			severity: 'warn',
			code: 'ANSI_C_QUOTING',
			message: "ANSI-C quoting ($'...') can hide dangerous characters via escape sequences",
		};
	}

	// Hex/octal escape sequences in command position
	if (/\\x[0-9a-fA-F]{2}|\\[0-7]{3}/.test(command)) {
		return {
			severity: 'warn',
			code: 'HEX_OCTAL_ESCAPE',
			message: 'Hex or octal escape sequences detected — may be used to obfuscate dangerous flags',
		};
	}

	return null;
}

function checkDangerousVariables(command: string): IBashSecurityIssue | null {
	const unquoted = stripQuotedStrings(command);
	if (
		/[<>|]\s*\$[A-Za-z_]/.test(unquoted) ||
		/\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(unquoted)
	) {
		return {
			severity: 'warn',
			code: 'DANGEROUS_VARIABLES',
			message: 'Command contains variables in dangerous contexts (redirections or pipes)',
		};
	}
	return null;
}

function checkIFSInjection(command: string): IBashSecurityIssue | null {
	if (/\$IFS|\$\{[^}]*IFS/.test(command)) {
		return { severity: 'block', code: 'IFS_INJECTION', message: 'IFS variable usage could bypass security validation' };
	}
	if (/\b(IFS|PATH)\s*=/.test(command)) {
		return { severity: 'block', code: 'ENV_MANIPULATION', message: 'Overriding IFS or PATH is blocked' };
	}
	return null;
}

function checkProcEnviron(command: string): IBashSecurityIssue | null {
	if (/\/proc\/[^/]*\/environ/.test(command)) {
		return { severity: 'block', code: 'PROC_ENVIRON', message: 'Access to /proc/*/environ could expose sensitive environment variables' };
	}
	return null;
}

function checkPipeToShell(command: string): IBashSecurityIssue | null {
	if (/\|\s*(bash|sh|zsh|ksh|csh|tcsh|dash)\b/.test(command)) {
		return { severity: 'block', code: 'PIPE_TO_SHELL', message: 'Piping directly to a shell interpreter is blocked' };
	}
	return null;
}

function checkForkBomb(command: string): IBashSecurityIssue | null {
	if (/:\(\)\s*\{[^}]*:[^}]*\}/.test(command) || /:\(\)\s*\{[^}]*&[^}]*\}/.test(command)) {
		return { severity: 'block', code: 'FORK_BOMB', message: 'Fork bomb pattern detected' };
	}
	return null;
}

function checkNewlines(command: string): IBashSecurityIssue | null {
	if (/[\n\r]/.test(command)) {
		// Allow backslash-newline line continuations
		if (!/\\\n/.test(command)) {
			return { severity: 'warn', code: 'NEWLINES', message: 'Embedded newlines could separate multiple commands or bypass validation' };
		}
	}
	return null;
}

function checkRedirections(command: string): IBashSecurityIssue | null {
	const unquoted = stripQuotedStrings(command);
	// Input redirection from a variable or subshell
	if (/[^<]<[^<(-]/.test(unquoted) && !/\/dev\/null/.test(unquoted)) {
		return { severity: 'warn', code: 'INPUT_REDIRECTION', message: 'Input redirection detected — could read from sensitive files' };
	}
	return null;
}

function checkBackslashEscapedOperators(command: string): IBashSecurityIssue | null {
	// Backslash before shell operators can confuse parsers
	if (/\\[|&;<>]/.test(command)) {
		return { severity: 'warn', code: 'BACKSLASH_OPERATOR', message: 'Backslash-escaped shell operators detected — may cause parsing inconsistencies' };
	}
	return null;
}

function checkUnicodeWhitespace(command: string): IBashSecurityIssue | null {
	if (UNICODE_WS_RE.test(command)) {
		return { severity: 'warn', code: 'UNICODE_WHITESPACE', message: 'Unicode whitespace characters detected — can cause parsing inconsistencies' };
	}
	return null;
}

function checkControlCharacters(command: string): IBashSecurityIssue | null {
	// Control chars (except tab/newline) — rare in legitimate commands
	if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) {
		return { severity: 'block', code: 'CONTROL_CHARS', message: 'Control characters detected — likely obfuscation attempt' };
	}
	return null;
}

function checkZshDangerousCommands(command: string): IBashSecurityIssue | null {
	// Check each subcommand (split on |, &&, ||, ;)
	const segments = command.split(/[|;&]/);
	for (const seg of segments) {
		const base = getBaseCommand(seg.trim());
		if (base && ZSH_DANGEROUS_COMMANDS.has(base)) {
			return {
				severity: 'block',
				code: 'ZSH_DANGEROUS_CMD',
				message: `Command '${base}' is blocked — Zsh module/socket command that can bypass security`,
			};
		}
	}
	return null;
}

function checkBraceExpansion(command: string): IBashSecurityIssue | null {
	const unquoted = stripQuotedStrings(command);
	// Brace expansion with commas can hide dangerous flags: cmd {flag1,flag2}
	const braceWithComma = /\{[^{}]*,[^{}]*\}/.exec(unquoted);
	if (braceWithComma) {
		// Allow common safe patterns like {js,ts} file extensions
		const inner = braceWithComma[0];
		if (/--/.test(inner) || /\//.test(inner)) {
			return {
				severity: 'warn',
				code: 'BRACE_EXPANSION',
				message: 'Brace expansion with flags or paths detected — could expand to dangerous arguments',
			};
		}
	}
	return null;
}

function checkMidWordHash(command: string): IBashSecurityIssue | null {
	// # in the middle of a word (not at line start or after whitespace) can cause comment injection
	if (/\S#[^!{]/.test(command) && !/^\s*#/.test(command)) {
		// Allow shebang and common patterns like hex colors
		if (!/#!\//.test(command) && !/#[0-9a-fA-F]{3,6}/.test(command)) {
			return {
				severity: 'warn',
				code: 'MID_WORD_HASH',
				message: 'Hash character in the middle of a word — may cause unexpected comment truncation',
			};
		}
	}
	return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run all security checks on a bash command.
 * Returns safe:false if any blocking issue is found.
 * Warnings are collected but don't block execution.
 */
export function checkBashSecurity(command: string, _cwd: string): IBashSecurityResult {
	if (!command.trim()) { return { safe: true, issues: [] }; }

	const issues: IBashSecurityIssue[] = [];

	const checks = [
		checkControlCharacters,      // Block first — control chars mean likely obfuscation
		checkForkBomb,
		checkPipeToShell,
		checkIFSInjection,
		checkProcEnviron,
		checkZshDangerousCommands,
		checkUnicodeWhitespace,
		checkIncompleteCommands,
		checkGitCommit,              // Early allow for clean git commits
		checkCommandSubstitution,    // warn
		checkObfuscatedFlags,        // warn
		checkDangerousVariables,     // warn
		checkNewlines,               // warn
		checkRedirections,           // warn
		checkBackslashEscapedOperators, // warn
		checkBraceExpansion,         // warn
		checkMidWordHash,            // warn
	];

	for (const check of checks) {
		const issue = check(command);
		if (issue) { issues.push(issue); }
	}

	return {
		safe: !issues.some(i => i.severity === 'block'),
		issues,
	};
}

/**
 * Check if command is destructive. Returns all matching warnings (not just first).
 * Purely informational — doesn't block execution.
 */
export function isDestructiveCommand(command: string): { isDestructive: boolean; warnings: string[] } {
	const warnings: string[] = [];

	const PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
		{ pattern: /\bgit\s+reset\s+--hard\b/, warning: 'may discard uncommitted changes' },
		{ pattern: /\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/, warning: 'may overwrite remote history' },
		{ pattern: /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/, warning: 'may permanently delete untracked files' },
		{ pattern: /\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/, warning: 'may discard all working tree changes' },
		{ pattern: /\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/, warning: 'may discard all working tree changes' },
		{ pattern: /\bgit\s+stash[ \t]+(drop|clear)\b/, warning: 'may permanently remove stashed changes' },
		{ pattern: /\bgit\s+branch\s+(-D[ \t]|--delete\s+--force)/, warning: 'may force-delete a branch' },
		{ pattern: /\bgit\s+(commit|push|merge)\b[^;&|\n]*--no-verify\b/, warning: 'may skip safety hooks' },
		{ pattern: /\bgit\s+commit\b[^;&|\n]*--amend\b/, warning: 'may rewrite the last commit' },
		{ pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/, warning: 'may recursively force-remove files' },
		{ pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR]/, warning: 'may recursively remove files' },
		{ pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f/, warning: 'may force-remove files' },
		{ pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, warning: 'may drop or truncate database objects' },
		{ pattern: /\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i, warning: 'may delete all rows from a table' },
		{ pattern: /\bkubectl\s+delete\b/, warning: 'may delete Kubernetes resources' },
		{ pattern: /\bterraform\s+destroy\b/, warning: 'may destroy infrastructure' },
		{ pattern: /\bdocker\s+(rm|rmi|system\s+prune)\b/, warning: 'may remove Docker containers or images' },
		{ pattern: /\bnpm\s+publish\b/, warning: 'will publish package to npm registry' },
	];

	for (const { pattern, warning } of PATTERNS) {
		if (pattern.test(command)) {
			warnings.push(warning);
		}
	}

	return { isDestructive: warnings.length > 0, warnings };
}

/**
 * Validate that paths in a command don't escape the workspace.
 */
export function validatePaths(command: string, _cwd: string, workspaceRoot: string): IPathValidationResult {
	const escapedPaths: string[] = [];

	// Check dangerous removal paths for rm/rmdir
	if (/\b(rm|rmdir)\b/.test(command)) {
		const pathArgs = command.match(/(?:^|\s)(\/[^\s'"]*|~[^\s'"]*)/g) ?? [];
		for (const arg of pathArgs) {
			const p = arg.trim();
			const normalized = p.replace(/\/+$/, '');
			if (normalized === '~' || normalized.startsWith('~/') || DANGEROUS_REMOVAL_PATHS.has(normalized)) {
				escapedPaths.push(p);
			}
		}
	}

	// Check for path traversal beyond workspace
	const traversalPattern = /(?:^|\s)(['"]?)([^\s'"]*\.\.\/[^\s'"]*)\1/g;
	let match;
	while ((match = traversalPattern.exec(command)) !== null) {
		const p = match[2];
		const upCount = (p.match(/\.\.\//g) ?? []).length;
		const downSegments = p.split('/').filter(s => s && s !== '..' && s !== '.').length;
		if (upCount > downSegments && workspaceRoot && !p.startsWith(workspaceRoot)) {
			escapedPaths.push(p);
		}
	}

	return { valid: escapedPaths.length === 0, escapedPaths };
}

/** Check if a path targets a dangerous system location for removal. */
export function isDangerousRemovalPath(path: string): boolean {
	const normalized = path.replace(/\/+$/, '');
	if (normalized === '~' || normalized.startsWith('~/')) { return true; }
	for (const dp of DANGEROUS_REMOVAL_PATHS) {
		if (normalized === dp || normalized.startsWith(dp + '/')) { return true; }
	}
	return false;
}
