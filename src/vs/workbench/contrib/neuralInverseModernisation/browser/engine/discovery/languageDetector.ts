/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Language Detector
 *
 * Determines the programming language of a source file using:
 *  1. File extension lookup (primary signal — fast, deterministic)
 *  2. Shebang detection on the first line (e.g. `#!/usr/bin/env python3`)
 *  3. Content heuristics for extensionless / ambiguous files (COBOL structure, etc.)
 *
 * Returns a normalised language key (e.g. `'cobol'`, `'typescript'`, `'java'`) that
 * is used throughout the discovery pipeline for routing to the correct decomposer,
 * fingerprinter, and dependency extractor.
 */

// ─── Extension → Language map ─────────────────────────────────────────────────

export const EXT_TO_LANG: Readonly<Record<string, string>> = {
	// ── Mainframe / Legacy ──────────────────────────────────────────────────
	cbl:     'cobol',
	cob:     'cobol',
	cpy:     'cobol',
	cobol:   'cobol',
	rpg:     'rpg',
	rpgle:   'rpg',
	sqlrpgle:'rpg',
	clp:     'rpg',
	clle:    'rpg',
	nat:     'natural',
	nsp:     'natural',
	pl1:     'pl1',
	pli:     'pl1',
	jcl:     'jcl',
	rexx:    'rexx',
	rex:     'rexx',
	cmd:     'rexx',
	asm:     'assembler',
	macro:   'assembler',
	mac:     'assembler',
	mlc:     'assembler',
	// ── Database ────────────────────────────────────────────────────────────
	sql:     'plsql',
	pls:     'plsql',
	pkb:     'plsql',
	pks:     'plsql',
	ddl:     'plsql',
	dml:     'plsql',
	trg:     'plsql',
	fnc:     'plsql',
	prc:     'plsql',
	vw:      'plsql',
	// ── JVM ─────────────────────────────────────────────────────────────────
	java:    'java',
	kt:      'kotlin',
	kts:     'kotlin',
	scala:   'scala',
	groovy:  'groovy',
	gradle:  'groovy',
	// ── .NET ────────────────────────────────────────────────────────────────
	cs:      'csharp',
	vb:      'vb',
	fs:      'fsharp',
	fsx:     'fsharp',
	// ── Web ─────────────────────────────────────────────────────────────────
	ts:      'typescript',
	tsx:     'typescript',
	mts:     'typescript',
	cts:     'typescript',
	js:      'javascript',
	jsx:     'javascript',
	mjs:     'javascript',
	cjs:     'javascript',
	// ── Python / Scripting ──────────────────────────────────────────────────
	py:      'python',
	pyw:     'python',
	rb:      'ruby',
	rake:    'ruby',
	pl:      'perl',
	pm:      'perl',
	lua:     'lua',
	// ── Systems ─────────────────────────────────────────────────────────────
	go:      'go',
	rs:      'rust',
	c:       'c',
	h:       'c',
	cpp:     'cpp',
	cc:      'cpp',
	cxx:     'cpp',
	hpp:     'cpp',
	hxx:     'cpp',
	// ── Other ───────────────────────────────────────────────────────────────
	php:     'php',
	swift:   'swift',
	dart:    'dart',
	r:       'r',
	jl:      'julia',
	clj:     'clojure',
	cljs:    'clojurescript',
	ex:      'elixir',
	exs:     'elixir',
	erl:     'erlang',
	hrl:     'erlang',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the programming language of a file.
 *
 * @param ext      Lowercase file extension without the dot (e.g. `'ts'`, `'cbl'`)
 * @param content  Optional file content for shebang / heuristic detection fallback
 */
export function detectLanguage(ext: string, content?: string): string {
	// Primary: extension lookup
	const byExt = EXT_TO_LANG[ext];
	if (byExt) { return byExt; }

	// Secondary: shebang / first-line analysis
	if (content) {
		const firstLine = content.trimStart().slice(0, 120);

		if (/^#!.*\bpython/.test(firstLine))       { return 'python'; }
		if (/^#!.*\bruby/.test(firstLine))          { return 'ruby'; }
		if (/^#!.*\bnode/.test(firstLine))          { return 'javascript'; }
		if (/^#!.*\bperl/.test(firstLine))          { return 'perl'; }
		if (/^#!.*\b(bash|sh|zsh|ksh)/.test(firstLine)) { return 'shell'; }
		if (/^#!.*\blua/.test(firstLine))           { return 'lua'; }
		if (/^#!.*\bgroovy/.test(firstLine))        { return 'groovy'; }

		// COBOL structural heuristics — recognisable even without standard extension
		const sample = content.slice(0, 500).toUpperCase();
		if (
			/IDENTIFICATION DIVISION/.test(sample) ||
			/PROCEDURE DIVISION/.test(sample) ||
			/WORKING-STORAGE SECTION/.test(sample)
		) {
			return 'cobol';
		}

		// JCL heuristic
		if (/^\/\/\S+\s+JOB\s/.test(content.trimStart().slice(0, 80))) {
			return 'jcl';
		}

		// RPG heuristic (fixed-format: column 6 = H/F/D/I/C/O)
		if (/^.{5}[HFDICOhfdicoh]/.test(firstLine)) {
			return 'rpg';
		}
	}

	return 'unknown';
}

/**
 * Whether the given language key maps to a mainframe / legacy language.
 * Used by the risk scorer and planner prompt builder.
 */
export function isLegacyLanguage(lang: string): boolean {
	return ['cobol', 'rpg', 'natural', 'pl1', 'jcl', 'rexx', 'assembler'].includes(lang);
}

/**
 * Whether the given language key supports sub-file unit decomposition.
 * For unsupported languages the decomposer falls back to one unit per file.
 */
export function supportsDecomposition(lang: string): boolean {
	return [
		'cobol', 'java', 'kotlin', 'scala', 'csharp', 'python',
		'typescript', 'javascript', 'go', 'rust', 'plsql',
	].includes(lang);
}
