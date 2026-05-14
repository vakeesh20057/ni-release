/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Tech Debt Analyzer
 *
 * Detects 17 categories of technical debt from source text without an AST.
 * Works universally across all supported languages — the heuristics are tuned
 * per category but do not require language-specific parsing.
 *
 * ## Debt Categories & Detection Strategy
 *
 * | Category                  | Detection Heuristic                                          |
 * |---------------------------|--------------------------------------------------------------|
 * | god-unit                  | CC > 20 AND logical lines > 300                              |
 * | dead-code                 | Unit never referenced in any rawImport or call expression    |
 * | code-clone                | Trigram fingerprint similarity > 0.75 among units            |
 * | magic-number              | Bare numeric literal not in named const / #define / final    |
 * | hardcoded-credential      | password= / secret= / api_key= followed by non-empty string  |
 * | hardcoded-url             | http:// / https:// literals in non-comment source             |
 * | deep-nesting              | Nesting depth > 5 (brace/indent)                             |
 * | long-parameter-list       | Function/method with > 7 parameters                          |
 * | missing-error-handling    | Has I/O ops (file/DB/network) but no error handling keywords  |
 * | commented-out-code        | Block of ≥ 3 consecutive comment lines that contain keywords  |
 * | todo-fixme                | TODO / FIXME / HACK / XXX / NOSONAR / BUG markers           |
 * | implicit-type-coercion    | == in JS/PHP, auto-widening cast patterns                    |
 * | unbounded-loop            | while(true) / loop / DO UNTIL without VARYING                |
 * | copy-paste-cobol          | Identical COBOL paragraph bodies                             |
 * | goto-usage                | GOTO / GOBACK / jump / computed-goto statements              |
 * | global-state              | Module-level mutable var / field outside class               |
 * | no-unit-tests             | Unit name not matched by any test file in the project        |
 */

import { ITechDebtItem, IUnitComplexity } from './discoveryTypes.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface IDebtAnalysisInput {
	unitId: string;
	unitName: string;
	content: string;
	lang: string;
	complexity: IUnitComplexity;
	/** All unit IDs in the project (for dead code detection). */
	allUnitIds: string[];
	/** All raw call expressions across the project (for dead code). */
	allCallExpressions: string[];
	/** All unit IDs from test files (for no-unit-test detection). */
	testUnitIds: string[];
}

/**
 * Analyse a single unit for technical debt.
 * Returns all debt items found (may be empty).
 */
export function analyzeUnitDebt(input: IDebtAnalysisInput): ITechDebtItem[] {
	const items: ITechDebtItem[] = [];
	const { unitId, unitName, content, lang, complexity } = input;
	const lines = content.split('\n');

	// ── god-unit ────────────────────────────────────────────────────────────
	if (complexity.cyclomaticComplexity > 20 && complexity.logicalLineCount > 300) {
		items.push({
			unitId, category: 'god-unit',
			description: `Unit has CC=${complexity.cyclomaticComplexity} and ${complexity.logicalLineCount} logical lines — likely doing too much.`,
			severity: 'error',
			migrationImpact: 'Must be decomposed before migration; direct translation will produce an unmaintainable target module.',
		});
	} else if (complexity.cyclomaticComplexity > 15 && complexity.logicalLineCount > 200) {
		items.push({
			unitId, category: 'god-unit',
			description: `Unit has CC=${complexity.cyclomaticComplexity} and ${complexity.logicalLineCount} logical lines — approaching god-unit territory.`,
			severity: 'warning',
			migrationImpact: 'Consider decomposing before or during migration to reduce translator complexity.',
		});
	}

	// ── deep-nesting ────────────────────────────────────────────────────────
	if (complexity.nestingDepth > 7) {
		items.push({
			unitId, category: 'deep-nesting',
			description: `Maximum nesting depth of ${complexity.nestingDepth} exceeds the critical threshold of 7.`,
			severity: 'error',
			lineNumber: undefined,
			migrationImpact: 'Deep nesting is language-specific and must be refactored using early returns, guard clauses, or extracted methods in the target.',
		});
	} else if (complexity.nestingDepth > 5) {
		items.push({
			unitId, category: 'deep-nesting',
			description: `Nesting depth of ${complexity.nestingDepth} exceeds the recommended maximum of 5.`,
			severity: 'warning',
			migrationImpact: 'May require structural refactoring in the target language.',
		});
	}

	// ── long-parameter-list ─────────────────────────────────────────────────
	if (complexity.paramCount > 10) {
		items.push({
			unitId, category: 'long-parameter-list',
			description: `Unit entry point has ${complexity.paramCount} parameters (threshold: 7).`,
			severity: 'error',
			migrationImpact: 'Introduce a parameter object / DTO in the target to reduce the signature width.',
		});
	} else if (complexity.paramCount > 7) {
		items.push({
			unitId, category: 'long-parameter-list',
			description: `Unit entry point has ${complexity.paramCount} parameters.`,
			severity: 'warning',
			migrationImpact: 'Consider consolidating parameters into a data structure.',
		});
	}

	// ── missing-error-handling ──────────────────────────────────────────────
	detectMissingErrorHandling(unitId, content, lang, complexity, items);

	// ── hardcoded-credential ────────────────────────────────────────────────
	detectHardcodedCredentials(unitId, lines, lang, items);

	// ── hardcoded-url ────────────────────────────────────────────────────────
	detectHardcodedURLs(unitId, lines, lang, items);

	// ── magic-number ─────────────────────────────────────────────────────────
	detectMagicNumbers(unitId, lines, lang, items);

	// ── commented-out-code ───────────────────────────────────────────────────
	detectCommentedOutCode(unitId, lines, lang, items);

	// ── todo-fixme ───────────────────────────────────────────────────────────
	detectTodoFixme(unitId, lines, items);

	// ── implicit-type-coercion ───────────────────────────────────────────────
	detectImplicitCoercion(unitId, lines, lang, items);

	// ── unbounded-loop ───────────────────────────────────────────────────────
	detectUnboundedLoop(unitId, lines, lang, items);

	// ── goto-usage ───────────────────────────────────────────────────────────
	detectGotoUsage(unitId, lines, lang, items);

	// ── global-state ─────────────────────────────────────────────────────────
	detectGlobalState(unitId, lines, lang, items);

	// ── dead-code ────────────────────────────────────────────────────────────
	detectDeadCode(unitId, unitName, lang, input.allCallExpressions, items);

	// ── no-unit-tests ────────────────────────────────────────────────────────
	detectNoUnitTests(unitId, unitName, input.testUnitIds, items);

	return items;
}

/**
 * Detect code-clone pairs across a set of units.
 * Returns debt items for each unit that appears to be a clone.
 */
export function detectCodeClones(
	units: Array<{ unitId: string; content: string; lang: string }>,
): ITechDebtItem[] {
	const items: ITechDebtItem[] = [];
	const fingerprints = units.map(u => ({
		unitId: u.unitId,
		trigrams: buildTrigrams(normaliseForClone(u.content, u.lang)),
	}));

	for (let i = 0; i < fingerprints.length; i++) {
		for (let j = i + 1; j < fingerprints.length; j++) {
			const sim = jaccardSimilarity(fingerprints[i].trigrams, fingerprints[j].trigrams);
			if (sim >= 0.80) {
				items.push({
					unitId: fingerprints[i].unitId,
					category: 'code-clone',
					description: `Near-duplicate of unit "${fingerprints[j].unitId}" (similarity: ${(sim * 100).toFixed(0)}%).`,
					severity: sim >= 0.95 ? 'error' : 'warning',
					migrationImpact: 'Clones should be extracted into a shared function/module before migration to avoid duplicating translator effort and introducing inconsistencies.',
				});
			}
		}
	}
	return items;
}

/**
 * Detect copy-paste COBOL paragraphs (identical trimmed body after normalisation).
 */
export function detectCopyPasteCobol(
	units: Array<{ unitId: string; content: string }>,
): ITechDebtItem[] {
	if (units.length === 0) { return []; }
	const items: ITechDebtItem[] = [];
	const normalized = units.map(u => ({ unitId: u.unitId, norm: normaliseCOBOL(u.content) }));
	const bodyCount = new Map<string, string[]>();

	for (const { unitId, norm } of normalized) {
		if (!norm) { continue; }
		const list = bodyCount.get(norm) ?? [];
		list.push(unitId);
		bodyCount.set(norm, list);
	}

	for (const [, dupes] of bodyCount) {
		if (dupes.length < 2) { continue; }
		for (const uid of dupes) {
			items.push({
				unitId: uid,
				category: 'copy-paste-cobol',
				description: `Paragraph body is identical to ${dupes.length - 1} other paragraph(s): ${dupes.filter(d => d !== uid).slice(0, 3).join(', ')}.`,
				severity: 'warning',
				migrationImpact: 'Consolidate into a shared paragraph/section before migration to avoid duplicating translated logic.',
			});
		}
	}
	return items;
}


// ─── Detection Helpers ────────────────────────────────────────────────────────

function detectMissingErrorHandling(
	unitId: string, content: string, lang: string,
	complexity: IUnitComplexity, items: ITechDebtItem[],
): void {
	if (!complexity.hasFileOps && !complexity.hasDatabaseOps && !complexity.hasExternalCalls) { return; }

	const hasErrorHandling = (() => {
		switch (lang) {
			case 'java': case 'kotlin': case 'scala': case 'groovy':
				return /\btry\b|\bcatch\b|\bfinally\b/.test(content);
			case 'csharp':
				return /\btry\b|\bcatch\b|\bfinally\b/.test(content);
			case 'python':
				return /\btry\b|\bexcept\b/.test(content);
			case 'javascript': case 'typescript':
				return /\btry\b|\bcatch\b|\b\.catch\s*\(|\b\.then\s*\([^)]*,/.test(content);
			case 'go':
				return /\bif\s+err\b|\berr\s*!=\s*nil\b/.test(content);
			case 'rust':
				return /\bResult\b|\bOption\b|\bunwrap_or\b|\bmatch\b/.test(content);
			case 'ruby':
				return /\brescue\b|\bbegin\b/.test(content);
			case 'php':
				return /\btry\b|\bcatch\b/.test(content);
			case 'swift':
				return /\btry\b|\bcatch\b|\bdo\b/.test(content);
			case 'cobol':
				return /\bON\s+EXCEPTION\b|\bINVALID\s+KEY\b|\bNOT\s+ON\s+EXCEPTION\b/.test(content.toUpperCase());
			case 'plsql':
				return /\bEXCEPTION\b|\bWHEN\s+OTHERS\b/.test(content.toUpperCase());
			default:
				return true; // assume handled for unknown languages
		}
	})();

	if (!hasErrorHandling) {
		const ops = [
			complexity.hasFileOps      && 'file I/O',
			complexity.hasDatabaseOps  && 'database operations',
			complexity.hasExternalCalls && 'external calls',
		].filter(Boolean).join(', ');

		items.push({
			unitId,
			category: 'missing-error-handling',
			description: `Unit performs ${ops} but has no visible error handling.`,
			severity: 'warning',
			migrationImpact: 'Target language translation must add appropriate error handling — the translator cannot infer intent from missing handlers.',
		});
	}
}

function detectHardcodedCredentials(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	const credentialPatterns: RegExp[] = [
		/(?:password|passwd|pwd|pass)\s*[=:]\s*["'`][^"'`\s]{4,}["'`]/i,
		/(?:secret|api[_-]?key|auth[_-]?token|access[_-]?token|bearer[_-]?token)\s*[=:]\s*["'`][^"'`\s]{8,}["'`]/i,
		/(?:private[_-]?key|rsa[_-]?key)\s*[=:]\s*["'`][^"'`\s]{8,}/i,
		/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
		/(?:jdbc|mongodb|postgresql|mysql|redis|amqp):\/\/[^:@\s]+:[^@\s]{4,}@/i,
	];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip comment lines
		if (isCommentLine(line, lang)) { continue; }
		for (const re of credentialPatterns) {
			if (re.test(line)) {
				items.push({
					unitId, category: 'hardcoded-credential',
					description: `Possible hardcoded credential at line ${i + 1}.`,
					severity: 'error',
					lineNumber: i + 1,
					migrationImpact: 'Credentials must be externalised to environment variables or a secrets manager before migration — never carry forward into target.',
				});
				break;
			}
		}
	}
}

function detectHardcodedURLs(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	const urlRe = /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s"'`>]{10,}/gi;
	for (let i = 0; i < lines.length; i++) {
		if (isCommentLine(lines[i], lang)) { continue; }
		if (urlRe.test(lines[i])) {
			items.push({
				unitId, category: 'hardcoded-url',
				description: `Hardcoded URL detected at line ${i + 1}: "${lines[i].trim().slice(0, 80)}".`,
				severity: 'warning',
				lineNumber: i + 1,
				migrationImpact: 'Externalise to configuration before migration; target environment endpoints will differ.',
			});
			urlRe.lastIndex = 0;
		}
	}
}

function detectMagicNumbers(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	// Skip these languages where numeric literals have specific syntax context
	if (['cobol', 'plsql', 'sql', 'rpg', 'pl1', 'jcl'].includes(lang)) { return; }

	// Numbers that are NOT magic: 0, 1, -1, 2, 100 (common), numbers in array literals
	const ALLOWED = new Set(['0', '1', '-1', '2', '100', '1000', '1024', '255', '256', '360', '365', '24', '60']);

	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		if (isCommentLine(lines[i], lang)) { continue; }
		// Strip strings first
		const stripped = lines[i]
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''");

		// Look for bare numeric literals not preceded by const/final/static/val/let/define
		const magicRe = /(?<![a-zA-Z_$\w.])(-?\d+\.?\d*)(?![a-zA-Z_$\w.])/g;
		let m: RegExpExecArray | null;
		while ((m = magicRe.exec(stripped)) !== null) {
			const num = m[1];
			if (ALLOWED.has(num)) { continue; }
			// Check if it's in a const/final assignment context
			const linePrefix = stripped.slice(0, m.index);
			if (/\b(?:const|final|static\s+final|val\s|#define\s|CONSTANT|VALUE\s*=)\b/.test(linePrefix)) { continue; }
			count++;
		}
	}

	if (count > 5) {
		items.push({
			unitId, category: 'magic-number',
			description: `Found ${count} potential magic numeric literals. Name them as constants.`,
			severity: count > 15 ? 'error' : 'warning',
			migrationImpact: 'Magic numbers obscure business meaning and make target code fragile if values must differ per environment.',
		});
	}
}

function detectCommentedOutCode(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	const CODE_KEYWORDS = /\b(if|for|while|return|function|def|class|import|var|let|const|void|int|String|public|private|PERFORM|MOVE|ADD|COMPUTE)\b/;
	let consecutiveCommentCodeLines = 0;
	let firstLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (isCommentContent(line, lang) && CODE_KEYWORDS.test(line)) {
			if (consecutiveCommentCodeLines === 0) { firstLine = i + 1; }
			consecutiveCommentCodeLines++;
		} else {
			if (consecutiveCommentCodeLines >= 3) {
				items.push({
					unitId, category: 'commented-out-code',
					description: `${consecutiveCommentCodeLines} consecutive lines of commented-out code starting at line ${firstLine}.`,
					severity: 'info',
					lineNumber: firstLine,
					migrationImpact: 'Commented-out code increases cognitive load for the translator and should be removed or tracked in version control.',
				});
			}
			consecutiveCommentCodeLines = 0;
		}
	}
}

function detectTodoFixme(
	unitId: string, lines: string[], items: ITechDebtItem[],
): void {
	const TODO_RE = /\b(TODO|FIXME|HACK|XXX|NOSONAR|BUG|WORKAROUND|KLUDGE|SMELL)\b/i;
	for (let i = 0; i < lines.length; i++) {
		const m = TODO_RE.exec(lines[i]);
		if (m) {
			items.push({
				unitId, category: 'todo-fixme',
				description: `${m[1].toUpperCase()} marker at line ${i + 1}: "${lines[i].trim().slice(0, 100)}"`,
				severity: 'info',
				lineNumber: i + 1,
				migrationImpact: 'Unresolved TODOs/FIXMEs represent deferred work that must be addressed during or before migration.',
			});
		}
	}
}

function detectImplicitCoercion(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	if (!['javascript', 'typescript', 'php', 'perl', 'ruby', 'python'].includes(lang)) { return; }

	let count = 0;
	for (const line of lines) {
		if (isCommentLine(line, lang)) { continue; }
		// Loose equality in JS/PHP
		if ((lang === 'javascript' || lang === 'typescript') && /[^=!]==[^=]/.test(line) && !/===/.test(line)) { count++; }
		if (lang === 'php' && /==[^=]/.test(line) && !/===[^=]/.test(line)) { count++; }
		// Python 2 compat division
		if (lang === 'python' && /\/\//.test(line) && !/^\s*#/.test(line)) { count++; }
	}
	if (count > 3) {
		items.push({
			unitId, category: 'implicit-type-coercion',
			description: `${count} potential implicit type coercion / loose equality patterns detected.`,
			severity: 'warning',
			migrationImpact: 'Loose equality semantics often differ in target languages — explicit type checks must be added during migration.',
		});
	}
}

function detectUnboundedLoop(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	const patterns: Partial<Record<string, RegExp[]>> = {
		javascript: [/\bwhile\s*\(\s*true\s*\)/, /\bfor\s*\(\s*;;\s*\)/],
		typescript: [/\bwhile\s*\(\s*true\s*\)/, /\bfor\s*\(\s*;;\s*\)/],
		java:       [/\bwhile\s*\(\s*true\s*\)/, /\bfor\s*\(\s*;;\s*\)/],
		kotlin:     [/\bwhile\s*\(\s*true\s*\)/],
		csharp:     [/\bwhile\s*\(\s*true\s*\)/, /\bfor\s*\(\s*;;\s*\)/],
		python:     [/\bwhile\s+True\s*:/, /\bwhile\s+1\s*:/],
		go:         [/\bfor\s*\{/, /\bfor\s+true\b/],
		rust:       [/\bloop\s*\{/],
		ruby:       [/\bloop\s+do\b/, /\bwhile\s+true\b/],
		php:        [/\bwhile\s*\(\s*true\s*\)/],
		cobol:      [/\bPERFORM\b(?!.*\bUNTIL\b)/],
	};

	const langPatterns = patterns[lang] ?? [];
	for (let i = 0; i < lines.length; i++) {
		if (isCommentLine(lines[i], lang)) { continue; }
		for (const re of langPatterns) {
			if (re.test(lines[i])) {
				items.push({
					unitId, category: 'unbounded-loop',
					description: `Potentially unbounded loop at line ${i + 1}.`,
					severity: 'warning',
					lineNumber: i + 1,
					migrationImpact: 'Unbounded loops require explicit termination conditions in the target — translator cannot infer the intent from `while(true)` alone.',
				});
				break;
			}
		}
	}
}

function detectGotoUsage(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	const gotoPatterns: Partial<Record<string, RegExp>> = {
		cobol:      /\bGO\s+TO\b|\bGOBACK\b/i,
		java:       /\bgoto\b/,     // reserved but unused — just flag if present
		c:          /\bgoto\b/,
		cpp:        /\bgoto\b/,
		csharp:     /\bgoto\b/,
		php:        /\bgoto\b/,
		python:     /\bgoto\b/,     // third-party goto lib
		javascript: /\blabel\s*:/,
		typescript: /\blabel\s*:/,
		fortran:    /\bGOTO\b|\bGO\s+TO\b/i,
		rpg:        /\bGOTO\b/i,
		pl1:        /\bGOTO\b|\bGO\s+TO\b/i,
	};

	const re = gotoPatterns[lang];
	if (!re) { return; }

	for (let i = 0; i < lines.length; i++) {
		if (isCommentLine(lines[i], lang)) { continue; }
		if (re.test(lines[i])) {
			items.push({
				unitId, category: 'goto-usage',
				description: `GOTO/jump statement at line ${i + 1}.`,
				severity: 'warning',
				lineNumber: i + 1,
				migrationImpact: 'GOTO-based control flow must be replaced with structured control flow (loops, early returns, exceptions) in the target language.',
			});
		}
	}
}

function detectGlobalState(
	unitId: string, lines: string[], lang: string, items: ITechDebtItem[],
): void {
	// Look for module-level mutable state patterns
	const patterns: Partial<Record<string, RegExp>> = {
		javascript: /^(?:var|let)\s+\w+\s*=/,
		typescript: /^(?:let|var)\s+\w+\s*(?::\s*\w+)?\s*=/,
		python:     /^[A-Z_][A-Z0-9_]{2,}\s*=/,  // Module-level ALLCAPS mutable globals
		go:         /^var\s+\w+\s+(?!func)[\w*\[\]]+\s*=/,
		rust:       /^(?:static\s+mut|lazy_static!)\b/,
		java:       /\bpublic\s+static\s+(?!final)\w/,
		kotlin:     /\bobject\s+\w+.*\bvar\b/,
		csharp:     /\bpublic\s+static\s+(?!readonly)\w/,
		php:        /\bstatic\s+\$\w+\s*=/,
		ruby:       /^\$\w+\s*=/,  // Global variables
	};

	const re = patterns[lang];
	if (!re) { return; }

	let count = 0;
	for (const line of lines) {
		if (isCommentLine(line, lang)) { continue; }
		if (re.test(line.trim())) { count++; }
	}
	if (count > 0) {
		items.push({
			unitId, category: 'global-state',
			description: `${count} potential mutable global/module-level variable(s) detected.`,
			severity: count > 5 ? 'error' : 'warning',
			migrationImpact: 'Global mutable state causes thread-safety issues and testing difficulties; must be encapsulated or injected in the target.',
		});
	}
}

function detectDeadCode(
	unitId: string, unitName: string, lang: string,
	allCallExpressions: string[], items: ITechDebtItem[],
): void {
	// Only meaningful for named units (not file-level units)
	if (unitName.includes('$module') || unitName.includes('$file')) { return; }
	// Very common utility patterns — skip
	if (/^(?:main|Main|Program|App|index|Index|init|Init|constructor|Constructor)$/.test(unitName)) { return; }

	const normalised = unitName.replace(/[-_$]/g, '').toLowerCase();
	const isReferenced = allCallExpressions.some(expr => {
		const exprNorm = expr.replace(/[-_$]/g, '').toLowerCase();
		return exprNorm.includes(normalised) || exprNorm.includes(unitName);
	});

	if (!isReferenced && allCallExpressions.length > 0) {
		items.push({
			unitId, category: 'dead-code',
			description: `Unit "${unitName}" does not appear to be called from any other unit in this project.`,
			severity: 'info',
			migrationImpact: 'Verify whether this unit is called externally (e.g., as a CICS program, JCL step, or API endpoint) before removing. If unused, skip migration.',
		});
	}
}

function detectNoUnitTests(
	unitId: string, unitName: string, testUnitIds: string[], items: ITechDebtItem[],
): void {
	if (testUnitIds.length === 0) { return; } // No test files detected at all — skip
	const norm = unitName.toLowerCase().replace(/[-_$]/g, '');
	const hasTest = testUnitIds.some(tid => {
		const tnorm = tid.toLowerCase().replace(/[-_$]/g, '');
		return tnorm.includes(norm) || tnorm.includes(`test${norm}`) || tnorm.includes(`${norm}test`) ||
		       tnorm.includes(`spec${norm}`) || tnorm.includes(`${norm}spec`);
	});

	if (!hasTest) {
		items.push({
			unitId, category: 'no-unit-tests',
			description: `No test file found that corresponds to unit "${unitName}".`,
			severity: 'info',
			migrationImpact: 'Untested units carry higher migration risk — write characterisation tests before translating to catch regressions.',
		});
	}
}


// ─── Comment Detection Helpers ────────────────────────────────────────────────

function isCommentLine(line: string, lang: string): boolean {
	const t = line.trim();
	if (!t) { return false; }
	if (['java', 'kotlin', 'scala', 'csharp', 'typescript', 'javascript', 'go', 'rust', 'swift', 'dart', 'php', 'groovy', 'c', 'cpp'].includes(lang)) {
		return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
	}
	if (lang === 'python' || lang === 'ruby' || lang === 'shell' || lang === 'elixir') { return t.startsWith('#'); }
	if (lang === 'cobol') { return line.length >= 7 && (line[6] === '*' || line[6] === '/'); }
	if (lang === 'sql' || lang === 'plsql') { return t.startsWith('--'); }
	if (lang === 'haskell' || lang === 'lua') { return t.startsWith('--'); }
	return false;
}

function isCommentContent(line: string, lang: string): boolean {
	const t = line.trim();
	if (t.startsWith('//') || t.startsWith('#') || t.startsWith('--') || t.startsWith('*')) { return true; }
	if (lang === 'cobol' && line.length >= 7 && (line[6] === '*' || line[6] === '/')) { return true; }
	return false;
}


// ─── Clone Detection Helpers ──────────────────────────────────────────────────

function normaliseForClone(content: string, lang: string): string {
	let s = content
		.replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
		.replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
		.replace(/\d+/g, 'N')
		.replace(/\s+/g, ' ')
		.trim();
	// Remove identifiers (leave keywords for structure comparison)
	return s.slice(0, 2000); // cap at 2KB for performance
}

function buildTrigrams(text: string): Set<string> {
	const result = new Set<string>();
	for (let i = 0; i + 3 <= text.length; i++) {
		result.add(text.slice(i, i + 3));
	}
	return result;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) { return 1; }
	if (a.size === 0 || b.size === 0) { return 0; }
	let intersection = 0;
	for (const t of a) { if (b.has(t)) { intersection++; } }
	return intersection / (a.size + b.size - intersection);
}

function normaliseCOBOL(content: string): string {
	return content
		.split('\n')
		.map(l => l.length >= 7 ? l.slice(6) : l)
		.map(l => l.trim())
		.filter(l => l && !l.startsWith('*'))
		.join(' ')
		.replace(/\s+/g, ' ')
		.toUpperCase();
}
