/*---------------------------------------------------------------------------------------------
 *  Neural Inverse Corporation
 *--------------------------------------------------------------------------------------------*/

/**
 * Bash command security validation for Power Mode.
 *
 * Adapted from Claude Code's bashSecurity.ts and pathValidation.ts.
 * Uses regex-based detection (no tree-sitter) suitable for browser/renderer context.
 *
 * Covers 23+ distinct attack vectors:
 *   control characters, fork bomb, pipe-to-shell, IFS/PATH injection, /proc/environ,
 *   Zsh dangerous commands, unicode whitespace, carriage return differentials,
 *   command substitution (backtick parity-correct, $(), process substitution),
 *   obfuscated flags (ANSI-C $'...', hex/octal), dangerous variable contexts,
 *   heredoc-safe substitution exemption, jq system() / dangerous flags,
 *   comment-quote desync, quoted newline + hash, brace expansion with flags/paths,
 *   mid-word hash injection, backslash-escaped operators, newlines, input redirection.
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

const COMMAND_SUBSTITUTION_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
	{ pattern: /<\(/, message: 'process substitution <()' },
	{ pattern: />[(]/, message: 'process substitution >()' },
	{ pattern: /=\(/, message: 'Zsh process substitution =()' },
	// Zsh EQUALS expansion: =cmd at word-start expands to $(which cmd), bypassing deny rules
	{ pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, message: 'Zsh equals expansion (=cmd)' },
	{ pattern: /\$\(/, message: '$() command substitution' },
	{ pattern: /\$\{/, message: '${} parameter expansion' },
	{ pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
	{ pattern: /~\[/, message: 'Zsh-style parameter expansion ~[' },
	{ pattern: /\(e:/, message: 'Zsh glob qualifier with command execution (e:)' },
	{ pattern: /\(\+/, message: 'Zsh glob qualifier with command execution (+)' },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip single- and double-quoted strings, preserving structure. */
function stripQuotedStrings(cmd: string): string {
	let result = cmd.replace(/'[^']*'/g, "''");
	result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
	return result;
}

/** Return the base command word (skips leading env-var assignments). */
function getBaseCommand(command: string): string {
	const parts = command.trimStart().split(/\s+/);
	for (const part of parts) {
		if (!/^[A-Z_a-z][A-Z0-9_a-z]*=/.test(part)) {
			return part.split('/').pop() ?? '';
		}
	}
	return '';
}

/**
 * Count unescaped backticks with proper backslash-parity accounting.
 * A backtick preceded by an odd number of backslashes is escaped.
 */
function countUnescapedBackticks(s: string): number {
	let count = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '`') {
			let backslashes = 0;
			let j = i - 1;
			while (j >= 0 && s[j] === '\\') { backslashes++; j--; }
			if (backslashes % 2 === 0) { count++; }
		}
	}
	return count;
}

/**
 * Returns true if the command contains a safe heredoc substitution like:
 *   $(cat <<'EOF'\n...\nEOF\n)
 * These are common in git commit messages and should not be flagged.
 */
function hasSafeHeredocSubstitution(cmd: string): boolean {
	return /\$\(\s*cat\s+<<['"]?EOF['"]?[\s\S]*?EOF\s*\)/.test(cmd);
}

// ─── Individual validators ────────────────────────────────────────────────────

function checkControlCharacters(command: string): IBashSecurityIssue | null {
	if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) {
		return { severity: 'block', code: 'CONTROL_CHARS', message: 'Control characters detected — likely obfuscation attempt' };
	}
	return null;
}

function checkForkBomb(command: string): IBashSecurityIssue | null {
	if (/:\(\)\s*\{[^}]*:[^}]*\}/.test(command) || /:\(\)\s*\{[^}]*&[^}]*\}/.test(command)) {
		return { severity: 'block', code: 'FORK_BOMB', message: 'Fork bomb pattern detected' };
	}
	return null;
}

function checkPipeToShell(command: string): IBashSecurityIssue | null {
	if (/\|\s*(bash|sh|zsh|ksh|csh|tcsh|dash)\b/.test(command)) {
		return { severity: 'block', code: 'PIPE_TO_SHELL', message: 'Piping to a shell interpreter is blocked' };
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

function checkZshDangerousCommands(command: string): IBashSecurityIssue | null {
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

function checkUnicodeWhitespace(command: string): IBashSecurityIssue | null {
	// Check for non-ASCII whitespace that can confuse parsers
	// Using codepoints for unicode categories: Ogham space, En/Em quad, thin space,
	// hair space, narrow no-break space, ideographic space, zero-width no-break space
	for (let i = 0; i < command.length; i++) {
		const cp = command.codePointAt(i)!;
		if (
			cp === 0x1680 || // Ogham space mark
			(cp >= 0x2000 && cp <= 0x200A) || // En quad ... Hair space
			cp === 0x202F || // Narrow no-break space
			cp === 0x205F || // Medium mathematical space
			cp === 0x3000 || // Ideographic space
			cp === 0xFEFF    // Zero-width no-break space (BOM)
		) {
			return { severity: 'warn', code: 'UNICODE_WHITESPACE', message: 'Unicode whitespace characters detected — can cause parsing inconsistencies' };
		}
	}
	return null;
}

function checkCarriageReturn(command: string): IBashSecurityIssue | null {
	// Carriage return outside double-quotes causes tokenization differentials between shells.
	// Attack: "mv ./safe '<\r># ~/.ssh/id_rsa'" — CR hides path from validators.
	const stripped = stripQuotedStrings(command);
	if (/\r/.test(stripped)) {
		return { severity: 'warn', code: 'CARRIAGE_RETURN', message: 'Carriage return (\\r) outside quotes — can cause shell tokenization differentials' };
	}
	return null;
}

function checkIncompleteCommands(command: string): IBashSecurityIssue | null {
	const trimmed = command.trim();
	if (/\|\s*$/.test(trimmed)) {
		return { severity: 'warn', code: 'INCOMPLETE_PIPE', message: 'Command ends with a pipe — incomplete command' };
	}
	if (/(?:&&|\|\|)\s*$/.test(trimmed)) {
		return { severity: 'warn', code: 'INCOMPLETE_OPERATOR', message: 'Command ends with && or || — incomplete command' };
	}
	return null;
}

function checkCommandSubstitution(command: string): IBashSecurityIssue | null {
	// Allow git commit -m "..." with $() — that's the co-author injection we do ourselves.
	// Also allow safe heredoc substitutions like $(cat <<'EOF'\n...\nEOF\n).
	const base = getBaseCommand(command);
	const isCleanGitCommit = base === 'git' && /^git\s+commit\s+/.test(command) && !command.includes('\\');
	if (isCleanGitCommit || hasSafeHeredocSubstitution(command)) {
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

	// Backticks — use parity-correct counting (naive lookbehind fails on even backslash counts)
	const unescapedBackticks = countUnescapedBackticks(unquoted);
	if (unescapedBackticks > 0) {
		return {
			severity: 'warn',
			code: 'BACKTICK_SUBSTITUTION',
			message: 'Command contains unescaped backtick command substitution',
		};
	}

	return null;
}

function checkJqCommand(command: string): IBashSecurityIssue | null {
	// jq's system() function executes arbitrary shell commands.
	// Also block dangerous flags: -f/--from-file (execute jq program from file),
	// --slurpfile (read data from file), -L (load library from path).
	if (!/\bjq\b/.test(command)) { return null; }

	if (/\bsystem\s*\(/.test(command)) {
		return { severity: 'block', code: 'JQ_SYSTEM_FUNCTION', message: "jq's system() function executes arbitrary shell commands — blocked" };
	}
	if (/\bjq\b[^;&|\n]*(?:\s-f|\s--from-file|\s--slurpfile|\s-L\s)/.test(command)) {
		return { severity: 'warn', code: 'JQ_FILE_ARGUMENTS', message: 'jq -f/--from-file/--slurpfile/-L can execute code from files — verify the source' };
	}

	return null;
}

function checkObfuscatedFlags(command: string): IBashSecurityIssue | null {
	const base = getBaseCommand(command);
	const hasOperators = /[|&;]/.test(command);
	// echo is safe for ANSI-C quoting unless compound
	if (base === 'echo' && !hasOperators) { return null; }

	if (/\$'[^']*'/.test(command)) {
		return {
			severity: 'warn',
			code: 'ANSI_C_QUOTING',
			message: "ANSI-C quoting ($'...') can hide dangerous characters via escape sequences",
		};
	}
	if (/\\x[0-9a-fA-F]{2}|\\[0-7]{3}/.test(command)) {
		return {
			severity: 'warn',
			code: 'HEX_OCTAL_ESCAPE',
			message: 'Hex or octal escape sequences detected — may obfuscate dangerous flags',
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
			message: 'Variables used directly in redirections or pipes — could redirect to sensitive paths',
		};
	}
	return null;
}

function checkCommentQuoteDesync(command: string): IBashSecurityIssue | null {
	// A quote character inside a # comment can desync quote-tracking in downstream parsers.
	// Attack: `cmd # comment"xyz" && evil` — the quote inside the comment closes nothing
	// in bash but confuses regex-based validators that strip comments first.
	const commentIdx = command.indexOf('#');
	if (commentIdx === -1) { return null; }
	// Only flag if # is at word-start position (not mid-word like #!/ or hex colors)
	const before = command[commentIdx - 1];
	if (before === undefined || /\s/.test(before)) {
		const commentPart = command.slice(commentIdx);
		if (/["'`]/.test(commentPart)) {
			return {
				severity: 'warn',
				code: 'COMMENT_QUOTE_DESYNC',
				message: 'Quote character inside a # comment — can desync quote-tracking in security validators',
			};
		}
	}
	return null;
}

function checkQuotedNewline(command: string): IBashSecurityIssue | null {
	// Quoted newlines followed by a # line can hide dangerous paths.
	// Attack: "mv ./safe '\n># ~/.ssh/id_rsa'" — the #-line looks like a comment to validators
	// that strip comments but is a literal string argument to the shell.
	if (/(['"])[^'"]*\n\s*#[^'"]*\1/.test(command)) {
		return {
			severity: 'warn',
			code: 'QUOTED_NEWLINE',
			message: 'Quoted string contains a newline followed by #-line — can hide paths from comment-stripping validators',
		};
	}
	return null;
}

function checkNewlines(command: string): IBashSecurityIssue | null {
	if (/[\n\r]/.test(command)) {
		if (!/\\\n/.test(command)) {
			return { severity: 'warn', code: 'NEWLINES', message: 'Embedded newlines could separate multiple commands or bypass validation' };
		}
	}
	return null;
}

function checkRedirections(command: string): IBashSecurityIssue | null {
	const unquoted = stripQuotedStrings(command);
	if (/[^<]<[^<(-]/.test(unquoted) && !/\/dev\/null/.test(unquoted)) {
		return { severity: 'warn', code: 'INPUT_REDIRECTION', message: 'Input redirection detected — could read from sensitive files' };
	}
	return null;
}

function checkBackslashEscapedOperators(command: string): IBashSecurityIssue | null {
	// Backslash before shell operators can confuse parsers.
	// Exception: find -exec cmd {} \; is the standard find terminator (safe).
	if (/\\[|&;<>]/.test(command)) {
		if (/\bfind\b/.test(command) && /\\\s*;/.test(command)) {
			return null; // find -exec ... \; is legitimate
		}
		return { severity: 'warn', code: 'BACKSLASH_OPERATOR', message: 'Backslash-escaped shell operators — may cause parsing inconsistencies' };
	}
	return null;
}

function checkBraceExpansion(command: string): IBashSecurityIssue | null {
	const unquoted = stripQuotedStrings(command);
	const braceWithComma = /\{[^{}]*,[^{}]*\}/.exec(unquoted);
	if (braceWithComma) {
		const inner = braceWithComma[0];
		if (/--/.test(inner) || /\//.test(inner)) {
			return {
				severity: 'warn',
				code: 'BRACE_EXPANSION',
				message: 'Brace expansion containing flags (--) or paths — could expand to dangerous arguments',
			};
		}
	}
	return null;
}

function checkMidWordHash(command: string): IBashSecurityIssue | null {
	if (/\S#[^!{]/.test(command) && !/^\s*#/.test(command)) {
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
 * Warnings are accumulated and returned for the caller to surface to the user.
 */
export function checkBashSecurity(command: string, _cwd: string): IBashSecurityResult {
	if (!command.trim()) { return { safe: true, issues: [] }; }

	const issues: IBashSecurityIssue[] = [];

	const checks: Array<(cmd: string) => IBashSecurityIssue | null> = [
		// --- Blockers first ---
		checkControlCharacters,
		checkForkBomb,
		checkPipeToShell,
		checkIFSInjection,
		checkProcEnviron,
		checkZshDangerousCommands,
		checkJqCommand,             // block on system(), warn on file flags
		// --- Warnings ---
		checkUnicodeWhitespace,
		checkCarriageReturn,
		checkIncompleteCommands,
		checkCommandSubstitution,   // has git-commit + heredoc exemptions
		checkObfuscatedFlags,
		checkDangerousVariables,
		checkCommentQuoteDesync,
		checkQuotedNewline,
		checkNewlines,
		checkRedirections,
		checkBackslashEscapedOperators,
		checkBraceExpansion,
		checkMidWordHash,
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
 * Check if command is destructive. Returns ALL matching warnings (not just the first).
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
		if (pattern.test(command)) { warnings.push(warning); }
	}

	return { isDestructive: warnings.length > 0, warnings };
}

/**
 * Validate that paths in a command don't escape the workspace or target dangerous system directories.
 */
export function validatePaths(command: string, _cwd: string, workspaceRoot: string): IPathValidationResult {
	const escapedPaths: string[] = [];

	if (/\b(rm|rmdir)\b/.test(command)) {
		const pathArgs = command.match(/(?:^|\s)(\/[^\s'"]*|~[^\s'"]*)/g) ?? [];
		for (const arg of pathArgs) {
			const p = arg.trim();
			const normalized = p.replace(/\/+$/, '');
			if (normalized === '~' || DANGEROUS_REMOVAL_PATHS.has(normalized)) {
				escapedPaths.push(p);
			}
		}
	}

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
	if (normalized === '~') { return true; }
	for (const dp of DANGEROUS_REMOVAL_PATHS) {
		if (normalized === dp || normalized.startsWith(dp + '/')) { return true; }
	}
	return false;
}
