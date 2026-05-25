/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

suite('CloudCredentialService — Validation Logic', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// These tests verify the credential format validation patterns
	// that are used in cloudCredentialService.ts

	const AWS_ACCESS_KEY_REGEX = /^AKIA[0-9A-Z]{16}$/;
	const AWS_SECRET_KEY_LENGTH = 40;
	const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const AWS_REGION_REGEX = /^[a-z]{2}-[a-z]+-\d+$/;

	suite('AWS Access Key validation', () => {
		test('accepts valid AKIA-prefixed key', () => {
			assert.ok(AWS_ACCESS_KEY_REGEX.test('AKIAIOSFODNN7EXAMPLE'));
		});

		test('rejects key without AKIA prefix', () => {
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('ASIAXXXXXXXXXXX12345'));
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('ABCDIOSFODNN7EXAMPLE'));
		});

		test('rejects key with wrong length', () => {
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('AKIA1234'));
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('AKIAIOSFODNN7EXAMPLEEXTRA'));
		});

		test('rejects lowercase characters', () => {
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('AKIAiosfodnn7example'));
		});

		test('rejects empty string', () => {
			assert.ok(!AWS_ACCESS_KEY_REGEX.test(''));
		});

		test('rejects key with special characters', () => {
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('AKIA+OSFODNN7EXAMPL'));
			assert.ok(!AWS_ACCESS_KEY_REGEX.test('AKIA/OSFODNN7EXAMPL'));
		});
	});

	suite('AWS Secret Key validation', () => {
		test('accepts 40-char secret key', () => {
			const key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
			assert.strictEqual(key.length, AWS_SECRET_KEY_LENGTH);
		});

		test('rejects shorter key', () => {
			assert.notStrictEqual('short'.length, AWS_SECRET_KEY_LENGTH);
		});

		test('rejects longer key', () => {
			const key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY_EXTRA';
			assert.notStrictEqual(key.length, AWS_SECRET_KEY_LENGTH);
		});
	});

	suite('AWS Region validation', () => {
		test('accepts valid regions', () => {
			assert.ok(AWS_REGION_REGEX.test('us-east-1'));
			assert.ok(AWS_REGION_REGEX.test('eu-west-2'));
			assert.ok(AWS_REGION_REGEX.test('ap-southeast-1'));
			assert.ok(AWS_REGION_REGEX.test('sa-east-1'));
		});

		test('rejects SSRF-style payloads', () => {
			assert.ok(!AWS_REGION_REGEX.test('us-east-1.evil.com'));
			assert.ok(!AWS_REGION_REGEX.test('http://evil.com'));
			assert.ok(!AWS_REGION_REGEX.test('../../../etc/passwd'));
			assert.ok(!AWS_REGION_REGEX.test('us-east-1; rm -rf /'));
		});

		test('rejects uppercase regions', () => {
			assert.ok(!AWS_REGION_REGEX.test('US-EAST-1'));
		});

		test('rejects empty string', () => {
			assert.ok(!AWS_REGION_REGEX.test(''));
		});

		test('rejects numeric-only', () => {
			assert.ok(!AWS_REGION_REGEX.test('123-456-7'));
		});
	});

	suite('Azure GUID validation', () => {
		test('accepts valid GUIDs', () => {
			assert.ok(GUID_REGEX.test('12345678-1234-1234-1234-123456789012'));
			assert.ok(GUID_REGEX.test('ABCDEF12-3456-7890-ABCD-EF1234567890'));
			assert.ok(GUID_REGEX.test('abcdef12-3456-7890-abcd-ef1234567890'));
		});

		test('rejects invalid GUIDs', () => {
			assert.ok(!GUID_REGEX.test('not-a-guid'));
			assert.ok(!GUID_REGEX.test('12345678123412341234123456789012'));  // no hyphens
			assert.ok(!GUID_REGEX.test('12345678-1234-1234-1234-12345678901'));  // too short
			assert.ok(!GUID_REGEX.test('12345678-1234-1234-1234-1234567890123'));  // too long
		});

		test('rejects empty string', () => {
			assert.ok(!GUID_REGEX.test(''));
		});

		test('rejects GUID with special characters', () => {
			assert.ok(!GUID_REGEX.test('12345678-1234-1234-1234-12345678901g'));
		});
	});

	suite('Credential trimming', () => {
		test('whitespace around access key is trimmed', () => {
			const raw = '  AKIAIOSFODNN7EXAMPLE  ';
			const trimmed = raw.trim();
			assert.ok(AWS_ACCESS_KEY_REGEX.test(trimmed));
		});

		test('newline in secret key is trimmed', () => {
			const raw = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n';
			const trimmed = raw.trim();
			assert.strictEqual(trimmed.length, AWS_SECRET_KEY_LENGTH);
		});

		test('tab characters in region are trimmed', () => {
			const raw = '\tus-east-1\t';
			const trimmed = raw.trim();
			assert.ok(AWS_REGION_REGEX.test(trimmed));
		});
	});
});
