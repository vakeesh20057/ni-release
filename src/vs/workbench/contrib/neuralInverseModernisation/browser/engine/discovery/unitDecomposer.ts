/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Unit Decomposer
 *
 * Breaks a source file into language-appropriate `IDecomposedUnit` records.
 * Each unit maps to one `IMigrationUnit` in the discovery result.
 *
 * ## Granularity per language
 *
 * | Language              | Granularity                                              |
 * |-----------------------|----------------------------------------------------------|
 * | COBOL                 | Paragraph, Section (in PROCEDURE DIVISION)               |
 * | Java / Kotlin / Scala | Top-level class, interface, object, enum, record         |
 * | C#                    | Top-level class, interface, struct, enum, record         |
 * | Python                | Top-level class, top-level function / async def          |
 * | TypeScript / JS       | Exported class, exported function, exported const arrow  |
 * | Go                    | Exported function, type struct/interface declaration     |
 * | Rust                  | pub fn, struct, enum, trait, impl block                  |
 * | PL/SQL                | PROCEDURE, FUNCTION, PACKAGE, TRIGGER                    |
 * | Everything else       | One unit per file (module granularity)                   |
 *
 * The decomposer is purely text-based — no AST / LSP is used — so it is fast,
 * language-server-free, and works on any folder the user selects.
 */

import { IDecomposedUnit, MigrationUnitType } from './discoveryTypes.js';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Decompose `content` into `IDecomposedUnit[]`.
 *
 * @param content  Full file text
 * @param lang     Normalised language key (from `detectLanguage`)
 * @param fileName Filename including extension (used for fallback unit naming)
 * @param lines    Pre-split lines array (avoids redundant split in the caller)
 */
export function decomposeFile(
	content: string,
	lang: string,
	fileName: string,
	lines: string[],
): IDecomposedUnit[] {
	void content; // available for future content-level heuristics
	switch (lang) {
		case 'cobol':      return decomposeCobol(lines, fileName);
		case 'java':       return decomposeJVM(lines, fileName, 'java');
		case 'kotlin':     return decomposeJVM(lines, fileName, 'kotlin');
		case 'scala':      return decomposeJVM(lines, fileName, 'scala');
		case 'csharp':     return decomposeCSharp(lines, fileName);
		case 'python':     return decomposePython(lines, fileName);
		case 'typescript':
		case 'javascript': return decomposeTypeScriptJS(lines, fileName);
		case 'go':         return decomposeGo(lines, fileName);
		case 'rust':       return decomposeRust(lines, fileName);
		case 'plsql':      return decomposePLSQL(lines, fileName);
		default:           return [fileUnit(fileName, lines.length)];
	}
}


// ─── COBOL ────────────────────────────────────────────────────────────────────

function decomposeCobol(lines: string[], fileName: string): IDecomposedUnit[] {
	const units: IDecomposedUnit[] = [];
	const baseName = fileName.replace(/\.[^.]+$/, '').toUpperCase();

	// Fixed-format COBOL: area A = cols 8–11 (1-based, 0-indexed = 7–10).
	// Free-format COBOL: paragraph name at col 1+.
	// We handle both by stripping the optional sequence+indicator (cols 1–6).
	const SECTION_RE  = /^([A-Z][A-Z0-9-]*)\s+SECTION\s*\.\s*$/i;
	const PARA_RE     = /^([A-Z][A-Z0-9-]{2,})\s*\.\s*(.*)?$/i;
	const DIVISION_RE = /^(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i;
	const COPY_RE     = /\bCOPY\s+([A-Z0-9-]+)/ig;

	let inProcedure = false;
	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'paragraph';
	let currentImports: string[] = [];
	const fileLevelImports: string[] = [];

	const flush = (endLine: number) => {
		if (!currentName || endLine < currentStart) { return; }
		units.push({
			name: currentName,
			type: currentType,
			range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 },
			rawImports: [...currentImports],
		});
		currentName    = null;
		currentImports = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const raw     = lines[i];

		// Skip comment lines: col 7 (0-indexed 6) = '*' or '/'
		if (raw.length >= 7 && (raw[6] === '*' || raw[6] === '/')) { continue; }

		// Strip sequence + indicator area (first 6 chars + possibly the indicator at col 7)
		const areaStart = raw.length >= 7 ? 7 : 0;
		const trimmed   = raw.slice(areaStart).trim();
		if (!trimmed) { continue; }

		// Collect COPY statements everywhere (file-level for non-procedure sections)
		const copyMatches = [...trimmed.matchAll(COPY_RE)];
		for (const m of copyMatches) {
			const copyName = m[1].toUpperCase();
			if (inProcedure) {
				if (!currentImports.includes(`COPY ${copyName}`)) {
					currentImports.push(`COPY ${copyName}`);
				}
			} else if (!fileLevelImports.includes(`COPY ${copyName}`)) {
				fileLevelImports.push(`COPY ${copyName}`);
			}
		}

		// DIVISION transitions
		if (DIVISION_RE.test(trimmed)) {
			flush(lineNum - 1);
			if (/PROCEDURE/i.test(trimmed)) {
				inProcedure  = true;
				currentName  = `${baseName}$PROCEDURE_DIVISION`;
				currentStart = lineNum;
				currentType  = 'section';
			} else {
				inProcedure = false;
			}
			continue;
		}

		if (!inProcedure) { continue; }

		// SECTION declaration
		const secMatch = SECTION_RE.exec(trimmed);
		if (secMatch) {
			flush(lineNum - 1);
			currentName  = `${baseName}$${secMatch[1].toUpperCase()}`;
			currentStart = lineNum;
			currentType  = 'section';
			continue;
		}

		// Paragraph declaration (only if top of stack, not inside nested code)
		const paraMatch = PARA_RE.exec(trimmed);
		if (paraMatch) {
			const paraName = paraMatch[1];
			// Heuristic guard: skip things that look like COBOL verbs or reserved words
			if (!COBOL_VERB_RE.test(paraName) && paraName.length >= 3) {
				flush(lineNum - 1);
				currentName  = `${baseName}$${paraName.toUpperCase()}`;
				currentStart = lineNum;
				currentType  = 'paragraph';
			}
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{
			name:       baseName,
			type:       'program',
			range:      { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 },
			rawImports: fileLevelImports,
		}];
	}
	return units;
}

// Common COBOL verbs — heuristic to avoid mis-identifying them as paragraph names
const COBOL_VERB_RE = /^(ACCEPT|ADD|ALTER|CALL|CANCEL|CLOSE|COMPUTE|CONTINUE|DELETE|DISPLAY|DIVIDE|EVALUATE|EXEC|EXIT|GO|GOBACK|IF|INITIALIZE|INSPECT|MERGE|MOVE|MULTIPLY|OPEN|PERFORM|READ|RELEASE|RETURN|REWRITE|SEARCH|SET|SORT|START|STOP|STRING|SUBTRACT|UNSTRING|WRITE|THEN|ELSE|END|WHEN|WITH|DATA|FILE|WORKING-STORAGE|LINKAGE|LOCAL-STORAGE|REPORT|SCREEN|COMMUNICATION|OBJECT-COMPUTER|SOURCE-COMPUTER|SPECIAL-NAMES|INPUT-OUTPUT|SELECT|ASSIGN|ORGANIZATION|ACCESS|RECORD|KEY|RELATIVE|SEQUENTIAL|INDEXED|ALTERNATE)$/i;


// ─── JVM Languages (Java / Kotlin / Scala) ────────────────────────────────────

const JVM_CLASS_RE: Record<string, RegExp> = {
	java:   /(?:^|[\s{])(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)/,
	kotlin: /(?:^|[\s{])(?:(?:abstract|open|sealed|data|inner|inline|value|external|enum|annotation|fun)\s+)*(?:class|interface|object)\s+(\w+)/,
	scala:  /(?:^|[\s{])(?:(?:abstract|sealed|final|case|implicit|lazy|override)\s+)*(?:class|object|trait)\s+(\w+)/,
};
const JVM_IMPORT_RE: Record<string, RegExp> = {
	java:   /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/,
	kotlin: /^\s*import\s+([\w.]+(?:\.\*)?)/,
	scala:  /^\s*import\s+([\w.]+(?:\.(?:_|\{[^}]+\}))?)/,
};

function decomposeJVM(lines: string[], fileName: string, lang: 'java' | 'kotlin' | 'scala'): IDecomposedUnit[] {
	const CLASS_RE  = JVM_CLASS_RE[lang];
	const IMPORT_RE = JVM_IMPORT_RE[lang];
	const baseName  = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];

	for (const line of lines) {
		const m = IMPORT_RE.exec(line);
		if (m) { fileImports.push(m[1]); }
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let braceDepth = 0;
	let unitEntryDepth = -1;

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		// Strip line comments and string literals for brace counting
		const stripped = lines[i]
			.replace(/\/\/.*$/, '')
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''");

		for (const ch of stripped) {
			if (ch === '{') { braceDepth++; }
			if (ch === '}') {
				braceDepth--;
				// End of a top-level type declaration
				if (currentName && braceDepth === unitEntryDepth - 1) {
					units.push({
						name:       currentName,
						type:       'class',
						range:      { startLine: currentStart, startColumn: 1, endLine: lineNum, endColumn: 1 },
						rawImports: fileImports,
					});
					currentName      = null;
					unitEntryDepth   = -1;
				}
			}
		}

		// Detect a new top-level type at brace depth 0 (or 1 if inside a package block for Scala)
		if (braceDepth <= 1) {
			const m = CLASS_RE.exec(lines[i]);
			if (m && !currentName) {
				currentName      = m[1];
				currentStart     = lineNum;
				unitEntryDepth   = braceDepth + 1;
			}
		}
	}

	// Handle file ending without closing brace (truncated / bad source)
	if (currentName) {
		units.push({
			name:       currentName,
			type:       'class',
			range:      { startLine: currentStart, startColumn: 1, endLine: lines.length, endColumn: 1 },
			rawImports: fileImports,
		});
	}

	if (units.length === 0) {
		return [{ name: baseName, type: 'class', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── C# ───────────────────────────────────────────────────────────────────────

function decomposeCSharp(lines: string[], fileName: string): IDecomposedUnit[] {
	const CLASS_RE  = /(?:^|[\s{])(?:(?:public|private|protected|internal|abstract|sealed|static|partial|override|new)\s+)*(?:class|interface|struct|enum|record)\s+(\w+)/;
	const USING_RE  = /^\s*using\s+([\w.]+)\s*;/;
	const baseName  = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];

	for (const line of lines) {
		const u = USING_RE.exec(line);
		if (u) { fileImports.push(u[1]); }
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let braceDepth = 0;
	let unitEntryDepth = -1;

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const stripped = lines[i].replace(/\/\/.*$/, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');

		for (const ch of stripped) {
			if (ch === '{') { braceDepth++; }
			if (ch === '}') {
				braceDepth--;
				if (currentName && braceDepth === unitEntryDepth - 1) {
					units.push({ name: currentName, type: 'class', range: { startLine: currentStart, startColumn: 1, endLine: lineNum, endColumn: 1 }, rawImports: fileImports });
					currentName    = null;
					unitEntryDepth = -1;
				}
			}
		}

		if (braceDepth <= 1 && !currentName) {
			const m = CLASS_RE.exec(lines[i]);
			if (m) {
				currentName    = m[1];
				currentStart   = lineNum;
				unitEntryDepth = braceDepth + 1;
			}
		}
	}
	if (currentName) {
		units.push({ name: currentName, type: 'class', range: { startLine: currentStart, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports });
	}
	if (units.length === 0) {
		return [{ name: baseName, type: 'class', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── Python ───────────────────────────────────────────────────────────────────

function decomposePython(lines: string[], fileName: string): IDecomposedUnit[] {
	const CLASS_RE   = /^class\s+(\w+)/;
	const FUNC_RE    = /^(?:async\s+)?def\s+(\w+)/;
	const IMPORT_RE1 = /^\s*import\s+([\w.]+)/;
	const IMPORT_RE2 = /^\s*from\s+([\w.]+)\s+import/;
	const baseName   = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];

	for (const line of lines) {
		const m1 = IMPORT_RE1.exec(line);
		const m2 = IMPORT_RE2.exec(line);
		if (m1) { fileImports.push(m1[1]); }
		else if (m2) { fileImports.push(m2[1]); }
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'class';

	const flush = (endLine: number) => {
		if (!currentName) { return; }
		units.push({ name: currentName, type: currentType, range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 }, rawImports: fileImports });
		currentName = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const line    = lines[i];
		// Top-level declarations have no leading whitespace
		if (/^\S/.test(line)) {
			const cm = CLASS_RE.exec(line);
			if (cm) { flush(lineNum - 1); currentName = cm[1]; currentStart = lineNum; currentType = 'class'; continue; }
			const fm = FUNC_RE.exec(line);
			if (fm) { flush(lineNum - 1); currentName = fm[1]; currentStart = lineNum; currentType = 'function'; continue; }
			// Non-declaration top-level line (e.g. assignment, call) — flush ongoing unit
			if (currentName && !/^(#|'''|"""|@)/.test(line)) { flush(lineNum - 1); }
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{ name: baseName, type: 'module', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── TypeScript / JavaScript ──────────────────────────────────────────────────

function decomposeTypeScriptJS(lines: string[], fileName: string): IDecomposedUnit[] {
	// Patterns for declarations worth making into units
	const CLASS_RE  = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/;
	const FUNC_RE   = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)/;
	const ARROW_RE  = /^(?:export\s+)?const\s+(\w+)\s*(?::\s*[\w<>[\],\s|&]+)?\s*=\s*(?:async\s+)?\(/;
	const INTERFACE_RE = /^(?:export\s+)?interface\s+(\w+)/;
	const ENUM_RE      = /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/;
	const IMPORT_FROM_RE = /(?:^|\s)import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/;
	const REQUIRE_RE     = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
	const baseName = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];

	for (const line of lines) {
		const fm = IMPORT_FROM_RE.exec(line);
		if (fm) { fileImports.push(fm[1]); }
		const rm = REQUIRE_RE.exec(line);
		if (rm) { fileImports.push(rm[1]); }
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'class';
	let braceDepth = 0;
	let unitEntryDepth = -1;

	const flush = (endLine: number) => {
		if (!currentName) { return; }
		units.push({ name: currentName, type: currentType, range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 }, rawImports: fileImports });
		currentName    = null;
		unitEntryDepth = -1;
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const stripped = lines[i]
			.replace(/\/\/.*$/, '')
			.replace(/`[^`]*`/g, '``')
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''");

		for (const ch of stripped) {
			if (ch === '{') { braceDepth++; }
			if (ch === '}') {
				braceDepth--;
				if (currentName && braceDepth === unitEntryDepth - 1) {
					flush(lineNum);
				}
			}
		}

		if (braceDepth <= 1) {
			const cm = CLASS_RE.exec(lines[i]);
			if (cm && !currentName) { currentName = cm[1]; currentStart = lineNum; currentType = 'class'; unitEntryDepth = braceDepth + 1; continue; }
			const im = INTERFACE_RE.exec(lines[i]);
			if (im && !currentName) { currentName = im[1]; currentStart = lineNum; currentType = 'class'; unitEntryDepth = braceDepth + 1; continue; }
			const em = ENUM_RE.exec(lines[i]);
			if (em && !currentName) { currentName = em[1]; currentStart = lineNum; currentType = 'class'; unitEntryDepth = braceDepth + 1; continue; }
			const fm = FUNC_RE.exec(lines[i]);
			if (fm && !currentName) { currentName = fm[1]; currentStart = lineNum; currentType = 'function'; unitEntryDepth = braceDepth + 1; continue; }
			const am = ARROW_RE.exec(lines[i]);
			if (am && !currentName) { currentName = am[1]; currentStart = lineNum; currentType = 'function'; unitEntryDepth = braceDepth + 1; continue; }
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{ name: baseName, type: 'module', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── Go ───────────────────────────────────────────────────────────────────────

function decomposeGo(lines: string[], fileName: string): IDecomposedUnit[] {
	const FUNC_RE   = /^func(?:\s+\([^)]+\))?\s+(\w+)\s*\(/;
	const TYPE_RE   = /^type\s+(\w+)\s+(?:struct|interface)/;
	const IMP1_RE   = /^\s+"([\w./]+)"/;        // inside import block
	const IMP2_RE   = /^import\s+"([\w./]+)"/;  // single-line import
	const baseName  = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];
	let inImportBlock = false;

	for (const line of lines) {
		if (/^import\s+\(/.test(line))                  { inImportBlock = true; continue; }
		if (inImportBlock && /^\)/.test(line.trim()))   { inImportBlock = false; continue; }
		if (inImportBlock) {
			const m = IMP1_RE.exec(line);
			if (m) { fileImports.push(m[1]); }
		} else {
			const m = IMP2_RE.exec(line);
			if (m) { fileImports.push(m[1]); }
		}
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'function';
	let braceDepth = 0;

	const flush = (endLine: number) => {
		if (!currentName) { return; }
		units.push({ name: currentName, type: currentType, range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 }, rawImports: fileImports });
		currentName = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const stripped = lines[i].replace(/\/\/.*$/, '');
		let prevDepth = braceDepth;
		for (const ch of stripped) {
			if (ch === '{') { braceDepth++; }
			if (ch === '}') { braceDepth--; }
		}
		if (prevDepth > 0 && braceDepth === 0 && currentName) {
			flush(lineNum);
		}
		if (braceDepth === 0) {
			const fm = FUNC_RE.exec(lines[i]);
			if (fm) { flush(lineNum - 1); currentName = fm[1]; currentStart = lineNum; currentType = 'function'; continue; }
			const tm = TYPE_RE.exec(lines[i]);
			if (tm) { flush(lineNum - 1); currentName = tm[1]; currentStart = lineNum; currentType = 'class'; continue; }
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{ name: baseName, type: 'module', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── Rust ─────────────────────────────────────────────────────────────────────

function decomposeRust(lines: string[], fileName: string): IDecomposedUnit[] {
	const FN_RE    = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/;
	const TYPE_RE  = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+(\w+)/;
	const IMPL_RE  = /^(?:pub\s+)?impl\s+(?:<[^>]+>\s+)?(?:\w+\s+for\s+)?(\w+)/;
	const USE_RE   = /^\s*use\s+([\w:]+)/;
	const baseName = fileName.replace(/\.[^.]+$/, '');

	const fileImports: string[] = [];
	const units: IDecomposedUnit[] = [];

	for (const line of lines) {
		const u = USE_RE.exec(line);
		if (u) { fileImports.push(u[1]); }
	}

	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'function';
	let braceDepth = 0;

	const flush = (endLine: number) => {
		if (!currentName) { return; }
		units.push({ name: currentName, type: currentType, range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 }, rawImports: fileImports });
		currentName = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const stripped = lines[i].replace(/\/\/.*$/, '');
		const prevDepth = braceDepth;
		for (const ch of stripped) {
			if (ch === '{') { braceDepth++; }
			if (ch === '}') { braceDepth--; }
		}
		if (prevDepth > 0 && braceDepth === 0 && currentName) {
			flush(lineNum);
		}
		if (braceDepth === 0) {
			const fm = FN_RE.exec(lines[i]);
			if (fm) { flush(lineNum - 1); currentName = fm[1]; currentStart = lineNum; currentType = 'function'; continue; }
			const tm = TYPE_RE.exec(lines[i]);
			if (tm) { flush(lineNum - 1); currentName = tm[1]; currentStart = lineNum; currentType = 'class'; continue; }
			const im = IMPL_RE.exec(lines[i]);
			if (im) { flush(lineNum - 1); currentName = `impl_${im[1]}`; currentStart = lineNum; currentType = 'class'; continue; }
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{ name: baseName, type: 'module', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: fileImports }];
	}
	return units;
}


// ─── PL/SQL ───────────────────────────────────────────────────────────────────

function decomposePLSQL(lines: string[], fileName: string): IDecomposedUnit[] {
	const DECL_RE  = /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:PROCEDURE|FUNCTION|PACKAGE(?:\s+BODY)?|TRIGGER|TYPE(?:\s+BODY)?)\s+(\w+)/i;
	const baseName = fileName.replace(/\.[^.]+$/, '').toUpperCase();

	const units: IDecomposedUnit[] = [];
	let currentName: string | null = null;
	let currentStart = 1;
	let currentType: MigrationUnitType = 'section';

	const flush = (endLine: number) => {
		if (!currentName) { return; }
		units.push({ name: currentName, type: currentType, range: { startLine: currentStart, startColumn: 1, endLine: endLine, endColumn: 1 }, rawImports: [] });
		currentName = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const m = DECL_RE.exec(lines[i]);
		if (m) {
			flush(lineNum - 1);
			currentName  = m[1].toUpperCase();
			currentStart = lineNum;
			const kw = lines[i].toUpperCase();
			currentType = /PACKAGE/i.test(kw)  ? 'module'
			            : /TRIGGER/i.test(kw)   ? 'section'
			            : /FUNCTION/i.test(kw)  ? 'function'
			            :                         'function';
		}
	}
	flush(lines.length);

	if (units.length === 0) {
		return [{ name: baseName, type: 'module', range: { startLine: 1, startColumn: 1, endLine: lines.length, endColumn: 1 }, rawImports: [] }];
	}
	return units;
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Represent the whole file as a single module-level unit. */
export function fileUnit(fileName: string, lineCount: number): IDecomposedUnit {
	const name = fileName.replace(/\.[^.]+$/, '');
	return {
		name,
		type:       'module',
		range:      { startLine: 1, startColumn: 1, endLine: lineCount, endColumn: 1 },
		rawImports: [],
	};
}
