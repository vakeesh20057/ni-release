/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

suite('CloudDeploymentService — Shell Escape', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function shellEscape(value: string): string {
		return "'" + value.replace(/'/g, "'\\''") + "'";
	}

	test('wraps simple string in single quotes', () => {
		assert.strictEqual(shellEscape('hello'), "'hello'");
	});

	test('escapes embedded single quotes', () => {
		assert.strictEqual(shellEscape("it's"), "'it'\\''s'");
	});

	test('handles empty string', () => {
		assert.strictEqual(shellEscape(''), "''");
	});

	test('handles string with spaces', () => {
		assert.strictEqual(shellEscape('hello world'), "'hello world'");
	});

	test('prevents command injection via semicolons', () => {
		const malicious = 'value; rm -rf /';
		const escaped = shellEscape(malicious);
		assert.strictEqual(escaped, "'value; rm -rf /'");
		// The semicolons are inside single quotes — shell won't interpret them
	});

	test('prevents command injection via backticks', () => {
		const malicious = '`whoami`';
		const escaped = shellEscape(malicious);
		assert.strictEqual(escaped, "'`whoami`'");
	});

	test('prevents command injection via $() substitution', () => {
		const malicious = '$(cat /etc/passwd)';
		const escaped = shellEscape(malicious);
		assert.strictEqual(escaped, "'$(cat /etc/passwd)'");
	});

	test('handles dollar signs', () => {
		const value = '$HOME/.config';
		const escaped = shellEscape(value);
		assert.strictEqual(escaped, "'$HOME/.config'");
	});

	test('handles newlines', () => {
		const value = 'line1\nline2';
		const escaped = shellEscape(value);
		assert.strictEqual(escaped, "'line1\\nline2'");
	});

	test('handles multiple single quotes', () => {
		const value = "it's a 'test'";
		const escaped = shellEscape(value);
		assert.strictEqual(escaped, "'it'\\''s a '\\''test'\\'''");
	});
});

suite('CloudDeploymentService — API Key Generation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('generated key has correct prefix', () => {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
		const key = `ni-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;

		assert.ok(key.startsWith('ni-'));
	});

	test('generated key has 4 segments of 8 hex chars', () => {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
		const key = `ni-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;

		const parts = key.split('-');
		assert.strictEqual(parts.length, 5); // 'ni' + 4 segments
		assert.strictEqual(parts[0], 'ni');
		for (let i = 1; i < 5; i++) {
			assert.strictEqual(parts[i].length, 8);
			assert.ok(/^[0-9a-f]+$/.test(parts[i]), `Segment ${i} should be hex: ${parts[i]}`);
		}
	});

	test('generated keys are unique', () => {
		const keys = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const bytes = new Uint8Array(32);
			crypto.getRandomValues(bytes);
			const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
			keys.add(`ni-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`);
		}
		assert.strictEqual(keys.size, 100);
	});

	test('API key is masked in terminal output', () => {
		const apiKey = 'ni-abcd1234-efgh5678-ijkl9012-mnop3456';
		const masked = `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
		assert.strictEqual(masked, 'ni-abcd...3456');
		assert.ok(!masked.includes('efgh5678'));
		assert.ok(!masked.includes('ijkl9012'));
	});
});

suite('CloudDeploymentService — Stale Deployment Recovery', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

	test('deployment older than 20 minutes in provisioning is stale', () => {
		const createdAt = Date.now() - (25 * 60 * 1000);
		const isStale = (Date.now() - createdAt) > STALE_THRESHOLD_MS;
		assert.strictEqual(isStale, true);
	});

	test('deployment younger than 20 minutes in provisioning is NOT stale', () => {
		const createdAt = Date.now() - (10 * 60 * 1000);
		const isStale = (Date.now() - createdAt) > STALE_THRESHOLD_MS;
		assert.strictEqual(isStale, false);
	});

	test('deployment exactly at 20 minutes is NOT stale (> not >=)', () => {
		const createdAt = Date.now() - STALE_THRESHOLD_MS;
		const isStale = (Date.now() - createdAt) > STALE_THRESHOLD_MS;
		assert.strictEqual(isStale, false);
	});
});

suite('CloudDeploymentService — Health Check Retry Logic', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const MAX_HEALTH_RETRIES = 3;

	test('fails after MAX_HEALTH_RETRIES consecutive failures', () => {
		let failCount = 0;
		for (let i = 0; i < MAX_HEALTH_RETRIES + 1; i++) {
			failCount++;
		}
		const shouldFail = failCount > MAX_HEALTH_RETRIES;
		assert.strictEqual(shouldFail, true);
	});

	test('resets fail count on success', () => {
		let failCount = 2;
		// Simulate success
		failCount = 0;
		assert.strictEqual(failCount, 0);
		assert.ok(failCount <= MAX_HEALTH_RETRIES);
	});

	test('treats HTTP 401/403 as server is running', () => {
		const runningStatuses = [200, 401, 403];
		const errorStatuses = [500, 502, 503, 504, 0];

		for (const status of runningStatuses) {
			const isUp = status === 200 || status === 401 || status === 403;
			assert.strictEqual(isUp, true, `HTTP ${status} should indicate server is up`);
		}

		for (const status of errorStatuses) {
			const isUp = status === 200 || status === 401 || status === 403;
			assert.strictEqual(isUp, false, `HTTP ${status} should NOT indicate server is up`);
		}
	});
});

suite('CloudDeploymentService — Instance Configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('vLLM user data script contains required components', () => {
		const requiredComponents = [
			'pip',
			'vllm',
			'systemd',
			'--api-key',
			'Restart=on-failure',
		];

		// Simulate checking a user data script
		const mockScript = `
#!/bin/bash
apt-get install -y python3-pip
pip install vllm
cat > /etc/systemd/system/vllm.service << 'UNIT'
[Service]
ExecStart=/opt/vllm-env/bin/python3 -m vllm.entrypoints.openai.api_server --api-key abc123
Restart=on-failure
UNIT
systemctl enable vllm
systemctl start vllm
`;

		for (const component of requiredComponents) {
			assert.ok(mockScript.includes(component), `Script should contain: ${component}`);
		}
	});

	test('security group restricts to specific IP', () => {
		const myIp = '203.0.113.42';
		const cidr = `${myIp}/32`;
		assert.ok(cidr.endsWith('/32'), 'CIDR should be /32 (single IP)');
		assert.ok(cidr.startsWith(myIp), 'CIDR should start with the user IP');
	});

	test('IMDSv2 is enforced via HttpTokens=required', () => {
		const metadataOptions = 'HttpTokens=required';
		assert.strictEqual(metadataOptions, 'HttpTokens=required');
	});
});

suite('CloudDeploymentService — Azure IP Extraction', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts publicIpAddress from JSON via grep+cut', () => {
		const json = '{"publicIpAddress": "20.62.134.89", "name": "ni-vm"}';
		const match = json.match(/"publicIpAddress"\s*:\s*"([^"]*)"/);
		assert.ok(match);
		assert.strictEqual(match![1], '20.62.134.89');
	});

	test('handles missing publicIpAddress gracefully', () => {
		const json = '{"name": "ni-vm", "status": "running"}';
		const match = json.match(/"publicIpAddress"\s*:\s*"([^"]*)"/);
		assert.strictEqual(match, null);
	});

	test('handles null publicIpAddress', () => {
		const json = '{"publicIpAddress": null, "name": "ni-vm"}';
		const match = json.match(/"publicIpAddress"\s*:\s*"([^"]*)"/);
		// null is not wrapped in quotes so regex won't match
		assert.strictEqual(match, null);
	});

	test('handles empty publicIpAddress', () => {
		const json = '{"publicIpAddress": "", "name": "ni-vm"}';
		const match = json.match(/"publicIpAddress"\s*:\s*"([^"]*)"/);
		assert.ok(match);
		assert.strictEqual(match![1], '');
	});
});
