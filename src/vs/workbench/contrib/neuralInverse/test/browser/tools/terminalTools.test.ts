/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ALL_TERMINAL_TOOLS } from '../../../browser/tools/terminalTools.js';
import { IToolExecutionContext } from '../../../common/workflowTypes.js';
import { URI } from '../../../../../base/common/uri.js';

function makeCtx(): IToolExecutionContext {
	return {
		workspaceUri: URI.file('/tmp'),
		fileService: {} as any,
		log: () => {},
	};
}

const runCommandTool = ALL_TERMINAL_TOOLS.find(t => t.name === 'runCommand')!;
const runScriptTool = ALL_TERMINAL_TOOLS.find(t => t.name === 'runScript')!;

suite('RunCommandTool — tool metadata', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('runCommand tool exists', () => {
		assert.ok(runCommandTool, 'runCommand must be in ALL_TERMINAL_TOOLS');
	});

	test('command parameter is required', () => {
		assert.strictEqual(runCommandTool.parameters['command']?.required, true);
	});

	test('timeoutMs parameter is optional', () => {
		const p = runCommandTool.parameters['timeoutMs'];
		assert.ok(!p || p.required !== true, 'timeoutMs should be optional');
	});
});

suite('RunCommandTool — blocklist enforcement', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const blockedCommands = [
		'rm -rf /',
		'rm -rf /home',
		'mkfs.ext4 /dev/sda',
		'dd if=/dev/zero of=/dev/sda',
		':(){ :|:& };:',  // fork bomb
		'shutdown -h now',
		'reboot',
		'chmod -R 777 /',
		'sudo rm -rf /',
	];

	for (const cmd of blockedCommands) {
		test(`blocks destructive command: "${cmd.slice(0, 30)}"`, async () => {
			const result = await runCommandTool.execute({ command: cmd }, makeCtx());
			assert.strictEqual(result.success, false,
				`command "${cmd}" should be blocked`);
		});
	}
});

suite('RunCommandTool — safe commands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('echo command succeeds', async () => {
		const result = await runCommandTool.execute({ command: 'echo hello' }, makeCtx());
		assert.strictEqual(result.success, true);
		assert.ok(result.output.includes('hello'));
	});

	test('exit code captured in output for non-zero exit', async () => {
		const result = await runCommandTool.execute({ command: 'exit 1' }, makeCtx());
		// Non-zero exit: success may be false, but output should note exit code
		assert.ok(result.output.includes('1') || result.error);
	});
});

suite('RunScriptTool — tool metadata', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('runScript tool exists', () => {
		assert.ok(runScriptTool, 'runScript must be in ALL_TERMINAL_TOOLS');
	});

	test('script parameter is required', () => {
		assert.strictEqual(runScriptTool.parameters['script']?.required, true);
	});

	test('packageManager parameter is optional', () => {
		const p = runScriptTool.parameters['packageManager'];
		assert.ok(!p || p.required !== true, 'packageManager should be optional');
	});
});

suite('RunScriptTool — script name validation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const invalidScriptNames = [
		'test; rm -rf /',
		'../../../etc/passwd',
		'test && bad',
		'test | cat /etc/passwd',
		'test $(evil)',
		'script name with spaces',
	];

	for (const scriptName of invalidScriptNames) {
		test(`rejects invalid script name: "${scriptName.slice(0, 25)}"`, async () => {
			const result = await runScriptTool.execute({ script: scriptName }, makeCtx());
			assert.strictEqual(result.success, false,
				`script name "${scriptName}" should be rejected`);
		});
	}

	test('accepts valid script names', async () => {
		// We can't actually run npm, but the validation should pass before execution
		// The failure (if any) should be from npm not existing, not validation
		const validNames = ['test', 'build', 'lint:fix', 'test:unit', 'build-prod'];
		for (const name of validNames) {
			// We just check it doesn't fail with a "invalid script name" error
			// (it may fail because npm isn't configured in test env)
			const result = await runScriptTool.execute({ script: name }, makeCtx());
			const isValidationError = (result.error ?? result.output ?? '').toLowerCase().includes('invalid script');
			assert.ok(!isValidationError, `"${name}" is a valid script name and should not fail validation`);
		}
	});
});
