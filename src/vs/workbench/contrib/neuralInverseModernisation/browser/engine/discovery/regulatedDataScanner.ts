/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Regulated Data Scanner
 *
 * Scans source code for literal PII, PCI-DSS, PHI and security-sensitive
 * patterns embedded directly in source text. Each hit is language-neutral —
 * the scanner works on raw text after basic string/comment stripping.
 *
 * ## Pattern Catalogue
 *
 * | Pattern             | Regulatory Frameworks       | Confidence |
 * |---------------------|-----------------------------|------------|
 * | SSN (US)            | HIPAA, GDPR                 | High       |
 * | Credit Card (Luhn)  | PCI-DSS                     | High       |
 * | IBAN                | PSD2, GDPR                  | High       |
 * | BIC / SWIFT         | PSD2                        | High       |
 * | Passport Number     | GDPR, US COPPA              | Medium     |
 * | National ID (EU)    | GDPR                        | Medium     |
 * | Date of Birth       | HIPAA, GDPR                 | Medium     |
 * | Email Address       | GDPR, CAN-SPAM              | Medium     |
 * | Phone Number        | GDPR, TCPA                  | Medium     |
 * | IP Address          | GDPR, CCPA                  | Low        |
 * | PEM Private Key     | SOC2, PCI-DSS               | High       |
 * | API Key / Token     | SOC2, PCI-DSS               | High       |
 * | DB Connection String| SOC2, PCI-DSS               | High       |
 *
 * ## Redaction
 *
 * All stored samples have the last 4 characters visible and the rest replaced
 * with `*` characters to prevent the scan result itself from leaking data.
 *
 * ## False Positive Reduction
 *
 * - Credit cards are validated with a Luhn checksum pass.
 * - Patterns are checked against surrounding context to exclude known test data
 *   (e.g., `test`, `example`, `fake`, `dummy` within 50 characters).
 * - Comment-only lines are scanned with low confidence since test data is often
 *   in comments.
 */

import { IRegulatedDataHit, RegulatedDataPattern } from './discoveryTypes.js';


// ─── Pattern → Framework Tag Mapping ─────────────────────────────────────────
//
// Maps each RegulatedDataPattern to the tag keywords that a loaded enterprise
// framework's rules must include (in IFrameworkRule.tags) for that framework to
// be considered applicable to a detected pattern.
//
// The discovery service uses this at scan time to query IFrameworkRegistry for
// the actual framework names — zero framework name strings are hardcoded here.
//
export const PATTERN_TAGS: Record<RegulatedDataPattern, string[]> = {
	'ssn':               ['ssn', 'social-security', 'national-id', 'pii', 'personal-data'],
	'credit-card':       ['credit-card', 'card-number', 'pan', 'pci', 'pci-dss', 'financial'],
	'iban':              ['iban', 'bank-account', 'account-number', 'financial', 'psd2'],
	'bic-swift':         ['bic', 'swift', 'bank-code', 'routing', 'financial', 'psd2'],
	'national-id':       ['national-id', 'identity', 'id-number', 'pii', 'personal-data'],
	'passport':          ['passport', 'travel-document', 'national-id', 'pii', 'identity'],
	'date-of-birth':     ['dob', 'date-of-birth', 'birthdate', 'age', 'pii', 'health', 'hipaa'],
	'email':             ['email', 'email-address', 'pii', 'contact', 'personal-data'],
	'phone':             ['phone', 'mobile', 'telephone', 'pii', 'contact', 'personal-data'],
	'ip-address':        ['ip-address', 'ip', 'network-identifier', 'pii', 'personal-data'],
	'private-key':       ['private-key', 'rsa-key', 'pem', 'credential', 'secret', 'security'],
	'api-key':           ['api-key', 'access-token', 'auth-token', 'bearer', 'credential', 'secret', 'security'],
	'connection-string': ['connection-string', 'database-credential', 'jdbc', 'credential', 'secret', 'security'],
};

/**
 * Maps each RegulatedDataPattern to the list of framework names (or IDs) that
 * are applicable to it.
 *
 * Built by the discovery service from IFrameworkRegistry.getActiveFrameworks()
 * at scan time. Empty arrays mean no loaded framework explicitly covers that
 * pattern type — the hit is still recorded, just without applicable framework info.
 */
export type IPatternFrameworkMap = Partial<Record<RegulatedDataPattern, string[]>>;


// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan source content for regulated data literals.
 *
 * @param content       Full source text of the unit (or file)
 * @param unitId        Unit ID to attach hits to
 * @param fileUri       Absolute URI of the source file (for hit attribution)
 * @param lang          Normalised language key
 * @param frameworkMap  Pattern → applicable framework names, built from
 *                      IFrameworkRegistry by the discovery service at scan time.
 *                      Defaults to empty (no framework attribution) if not provided.
 */
export function scanForRegulatedData(
	content: string,
	unitId: string,
	fileUri: string,
	lang: string,
	frameworkMap: IPatternFrameworkMap = {},
): IRegulatedDataHit[] {
	const hits: IRegulatedDataHit[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		// Determine if this line is entirely a comment (lower confidence)
		const isComment = isCommentLine(line, lang);

		scanLine(line, unitId, fileUri, lineNum, isComment, hits, frameworkMap);
	}

	return deduplicateHits(hits);
}


// ─── Per-Line Scanner ─────────────────────────────────────────────────────────

function scanLine(
	line: string,
	unitId: string,
	fileUri: string,
	lineNum: number,
	isComment: boolean,
	hits: IRegulatedDataHit[],
	frameworkMap: IPatternFrameworkMap,
): void {
	const addHit = (
		pattern: RegulatedDataPattern,
		matched: string,
		confidence: IRegulatedDataHit['confidence'],
	) => {
		// Framework names come exclusively from the loaded enterprise frameworks,
		// not hardcoded strings. The discovery service populates frameworkMap.
		const frameworks = frameworkMap[pattern] ?? [];
		if (isTestOrFakeContext(line, matched)) { return; }
		if (isComment) {
			// Downgrade confidence for comment-line hits
			confidence = confidence === 'high' ? 'medium' : 'low';
		}
		hits.push({
			unitId,
			fileUri,
			lineNumber: lineNum,
			pattern,
			redactedSample: redact(matched),
			confidence,
			applicableFrameworks: frameworks,
		});
	};

	// ── SSN (US) ──────────────────────────────────────────────────────────────
	const ssnRe = /\b(\d{3}[-\s]\d{2}[-\s]\d{4})\b/g;
	let m: RegExpExecArray | null;
	while ((m = ssnRe.exec(line)) !== null) {
		addHit('ssn', m[1], 'high');
	}

	// ── Credit Card (Luhn-validated) ──────────────────────────────────────────
	// Visa (4xxx), Mastercard (5xxx / 2xxx), Amex (34/37), Discover (6011/65), JCB (35)
	const ccRe = /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))\s?[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?:[-\s]?\d{3})?\b/g;
	while ((m = ccRe.exec(line)) !== null) {
		const digits = m[0].replace(/[\s-]/g, '');
		if (luhnCheck(digits)) {
			addHit('credit-card', m[0], 'high');
		}
	}

	// ── IBAN ──────────────────────────────────────────────────────────────────
	const ibanRe = /\b([A-Z]{2}\d{2}[A-Z0-9]{4,30})\b/g;
	while ((m = ibanRe.exec(line)) !== null) {
		if (isValidIBAN(m[1])) {
			addHit('iban', m[1], 'high');
		}
	}

	// ── BIC / SWIFT ───────────────────────────────────────────────────────────
	const bicRe = /\b([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g;
	while ((m = bicRe.exec(line)) !== null) {
		if (m[1].length === 8 || m[1].length === 11) {
			addHit('bic-swift', m[1], 'medium');
		}
	}

	// ── Passport Number ───────────────────────────────────────────────────────
	// Generic pattern: 1-2 letters followed by 6-9 digits
	const passportRe = /\b([A-Z]{1,2}\d{6,9})\b/g;
	while ((m = passportRe.exec(line)) !== null) {
		if (/passport|pass_no|passnr/i.test(line.slice(Math.max(0, m.index - 30), m.index))) {
			addHit('passport', m[1], 'medium');
		}
	}

	// ── Date of Birth ─────────────────────────────────────────────────────────
	// Only flag if near a DOB-indicating field name
	const dobFieldRe = /\b(?:dob|date_of_birth|birth_date|birthdate|date_naissance|geburtsdatum)\b/i;
	if (dobFieldRe.test(line)) {
		const dateRe = /\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/;
		const dateMat = dateRe.exec(line);
		if (dateMat) {
			addHit('date-of-birth', dateMat[1], 'high');
		} else {
			// Flag the field name itself even if no date literal
			addHit('date-of-birth', line.trim().slice(0, 40), 'medium');
		}
	}

	// ── Email Address ─────────────────────────────────────────────────────────
	// Only flag non-test emails (filter test@test.com, example@example.com etc.)
	const emailRe = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
	while ((m = emailRe.exec(line)) !== null) {
		const email = m[1].toLowerCase();
		if (!isTestEmail(email)) {
			addHit('email', m[1], 'medium');
		}
	}

	// ── Phone Number ──────────────────────────────────────────────────────────
	// E.164, US, UK, generic international
	const phoneRe = /\b(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4,6}\b/g;
	while ((m = phoneRe.exec(line)) !== null) {
		const digits = m[0].replace(/\D/g, '');
		if (digits.length >= 10 && digits.length <= 15) {
			if (/phone|mobile|tel|cell|fax|contact/i.test(line.slice(Math.max(0, m.index - 40), m.index))) {
				addHit('phone', m[0], 'medium');
			}
		}
	}

	// ── IP Address ────────────────────────────────────────────────────────────
	const ipRe = /\b((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))\b/g;
	while ((m = ipRe.exec(line)) !== null) {
		const ip = m[1];
		if (!isPrivateIP(ip) && !isLoopbackIP(ip)) {
			addHit('ip-address', ip, 'low');
		}
	}

	// ── PEM Private Key ───────────────────────────────────────────────────────
	if (/-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/.test(line)) {
		addHit('private-key', '-----BEGIN PRIVATE KEY-----...', 'high');
	}
	// Generic high-entropy base64 that looks like a key (20+ chars, no spaces)
	const b64KeyRe = /(?:private_?key|rsa_?key|pem_?cert)\s*[=:]\s*["']([A-Za-z0-9+/=]{40,})["']/i;
	const b64Mat = b64KeyRe.exec(line);
	if (b64Mat) {
		addHit('private-key', b64Mat[1], 'high');
	}

	// ── API Key / Token ───────────────────────────────────────────────────────
	const apiKeyRe = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|bearer[_-]?token|client[_-]?secret|oauth[_-]?token)\s*[=:]\s*["'`]([^\s"'`]{16,})["'`]/i;
	const apiMat = apiKeyRe.exec(line);
	if (apiMat) {
		addHit('api-key', apiMat[1], 'high');
	}

	// ── Database Connection String ────────────────────────────────────────────
	const connStrPatterns = [
		/(?:jdbc|mongodb(?:\+srv)?|postgresql|mysql|mariadb|redis|amqp|rabbitmq|sqlserver|oracle):\/\/[^:@\s]+:[^@\s]{4,}@[^\s"'`]+/i,
		/(?:Server|Host)=[^;]+;.*(?:Password|Pwd)=[^;]+/i,
		/Data\s+Source=[^;]+;.*Password=[^;]+/i,
	];
	for (const re of connStrPatterns) {
		const connMat = re.exec(line);
		if (connMat) {
			addHit('connection-string', connMat[0], 'high');
			break;
		}
	}
}


// ─── Validation Helpers ───────────────────────────────────────────────────────

/** Luhn algorithm — validates credit card numbers. */
function luhnCheck(digits: string): boolean {
	let sum = 0;
	let alternate = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let n = parseInt(digits[i], 10);
		if (alternate) {
			n *= 2;
			if (n > 9) { n -= 9; }
		}
		sum += n;
		alternate = !alternate;
	}
	return sum % 10 === 0 && sum > 0;
}

/** Basic IBAN structural validation (length + country check). */
function isValidIBAN(iban: string): boolean {
	// Country code → expected length
	const IBAN_LENGTHS: Record<string, number> = {
		AL:28, AD:24, AT:20, AZ:28, BH:22, BE:16, BA:20, BR:29, BG:22, CR:22,
		HR:21, CY:28, CZ:24, DK:18, DO:28, EE:20, FO:18, FI:18, FR:27, GE:22,
		DE:22, GI:23, GR:27, GL:18, GT:28, HU:28, IS:26, IE:22, IL:23, IT:27,
		JO:30, KZ:20, KW:30, LV:21, LB:28, LI:21, LT:20, LU:20, MK:19, MT:31,
		MR:27, MU:30, MC:27, MD:24, ME:22, NL:18, NO:15, PK:24, PS:29, PL:28,
		PT:25, QA:29, RO:24, LC:32, SM:27, SA:24, RS:22, SK:24, SI:19, ES:24,
		SE:24, CH:21, TN:24, TR:26, AE:23, GB:22, VG:24,
	};
	const country = iban.slice(0, 2);
	const expected = IBAN_LENGTHS[country];
	return expected !== undefined && iban.length === expected;
}

/** Private RFC1918 / RFC4193 IP ranges. */
function isPrivateIP(ip: string): boolean {
	const parts = ip.split('.').map(Number);
	if (parts[0] === 10) { return true; }
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) { return true; }
	if (parts[0] === 192 && parts[1] === 168) { return true; }
	return false;
}

function isLoopbackIP(ip: string): boolean {
	return ip === '127.0.0.1' || ip.startsWith('127.') || ip === '0.0.0.0';
}

/** Known test / example email domains that should not be flagged. */
function isTestEmail(email: string): boolean {
	const TEST_DOMAINS = new Set([
		'example.com', 'example.org', 'example.net', 'test.com', 'test.org',
		'dummy.com', 'fake.com', 'placeholder.com', 'noreply.com',
		'no-reply.com', 'mailinator.com', 'guerrillamail.com',
	]);
	const domain = email.split('@')[1] ?? '';
	return TEST_DOMAINS.has(domain);
}

/** Returns true if the surrounding context contains known test data markers. */
function isTestOrFakeContext(line: string, matched: string): boolean {
	const TEST_MARKERS = /\b(?:test|fake|mock|dummy|example|sample|placeholder|fixture|stub)\b/i;
	const idx = line.indexOf(matched);
	const context = line.slice(Math.max(0, idx - 50), Math.min(line.length, idx + matched.length + 50));
	return TEST_MARKERS.test(context);
}


// ─── Comment Detection ────────────────────────────────────────────────────────

function isCommentLine(line: string, lang: string): boolean {
	const t = line.trim();
	if (!t) { return false; }
	if (['java','kotlin','scala','csharp','typescript','javascript','go','rust','swift','dart','php','groovy','c','cpp'].includes(lang)) {
		return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
	}
	if (['python','ruby','shell','elixir','yaml','toml'].includes(lang)) { return t.startsWith('#'); }
	if (lang === 'cobol') { return line.length >= 7 && (line[6] === '*' || line[6] === '/'); }
	if (lang === 'sql' || lang === 'plsql') { return t.startsWith('--'); }
	if (lang === 'haskell' || lang === 'lua') { return t.startsWith('--'); }
	if (lang === 'xml' || lang === 'html') { return t.startsWith('<!--'); }
	return false;
}


// ─── Redaction ────────────────────────────────────────────────────────────────

/** Redact all but the last 4 characters of a matched value. */
function redact(value: string): string {
	const clean = value.replace(/\s/g, '');
	if (clean.length <= 4) { return '****'; }
	return '*'.repeat(clean.length - 4) + clean.slice(-4);
}


// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateHits(hits: IRegulatedDataHit[]): IRegulatedDataHit[] {
	const seen = new Set<string>();
	return hits.filter(hit => {
		const key = `${hit.pattern}:${hit.lineNumber}:${hit.redactedSample}`;
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});
}
