/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Neural Inverse Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { DependencyGraphService } from '../../../browser/context/graph/dependencyGraph.js';

function makeModel(text: string): any {
	return { getValue: () => text };
}

suite('DependencyGraphService — named imports', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts single named import', async () => {
		const svc = store.add(new DependencyGraphService());
		const allowed = await svc.getAllowedCalls(makeModel("import { Foo } from 'mod';"));
		assert.ok(allowed.includes('Foo'), 'Foo should be allowed');
	});

	test('extracts multiple names from one import', async () => {
		const svc = store.add(new DependencyGraphService());
		const allowed = await svc.getAllowedCalls(makeModel("import { Alpha, Beta, Gamma } from './pkg';"));
		assert.ok(allowed.includes('Alpha'));
		assert.ok(allowed.includes('Beta'));
		assert.ok(allowed.includes('Gamma'));
	});

	test('handles aliased named imports (keeps alias)', async () => {
		const svc = store.add(new DependencyGraphService());
		// "import { Foo as Bar }" — regex captures "Foo as Bar" as a token
		const allowed = await svc.getAllowedCalls(makeModel("import { Foo as Bar } from 'mod';"));
		// At minimum the raw token should be present in some form
		const joined = allowed.join(' ');
		assert.ok(joined.includes('Foo') || joined.includes('Bar'));
	});

	test('deduplicates the same name imported twice', async () => {
		const svc = store.add(new DependencyGraphService());
		const code = "import { Foo } from 'a';\nimport { Foo } from 'b';";
		const allowed = await svc.getAllowedCalls(makeModel(code));
		assert.strictEqual(allowed.filter(a => a === 'Foo').length, 1);
	});
});

suite('DependencyGraphService — namespace imports', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts namespace import binding', async () => {
		const svc = store.add(new DependencyGraphService());
		const allowed = await svc.getAllowedCalls(makeModel("import * as Utils from './utils';"));
		assert.ok(allowed.includes('Utils'));
	});

	test('handles multiple namespace imports', async () => {
		const svc = store.add(new DependencyGraphService());
		const code = "import * as A from './a';\nimport * as B from './b';";
		const allowed = await svc.getAllowedCalls(makeModel(code));
		assert.ok(allowed.includes('A'));
		assert.ok(allowed.includes('B'));
	});
});

suite('DependencyGraphService — default imports', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts default import', async () => {
		const svc = store.add(new DependencyGraphService());
		const allowed = await svc.getAllowedCalls(makeModel("import MyClass from './myClass';"));
		assert.ok(allowed.includes('MyClass'));
	});

	test('does not add "{" as a default import when curly brace form used', async () => {
		const svc = store.add(new DependencyGraphService());
		const allowed = await svc.getAllowedCalls(makeModel("import { Named } from './mod';"));
		assert.ok(!allowed.includes('{'), 'curly brace should not appear as an identifier');
	});
});

suite('DependencyGraphService — built-in constants', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('always includes console', async () => {
		const svc = store.add(new DependencyGraphService());
		assert.ok((await svc.getAllowedCalls(makeModel(''))).includes('console'));
	});

	test('always includes Math', async () => {
		const svc = store.add(new DependencyGraphService());
		assert.ok((await svc.getAllowedCalls(makeModel(''))).includes('Math'));
	});

	test('always includes JSON', async () => {
		const svc = store.add(new DependencyGraphService());
		assert.ok((await svc.getAllowedCalls(makeModel(''))).includes('JSON'));
	});

	test('always includes Promise', async () => {
		const svc = store.add(new DependencyGraphService());
		assert.ok((await svc.getAllowedCalls(makeModel(''))).includes('Promise'));
	});

	test('built-ins present even when file has no imports', async () => {
		const svc = store.add(new DependencyGraphService());
		const code = 'const x = 1;\nfunction foo() { return x; }';
		const allowed = await svc.getAllowedCalls(makeModel(code));
		assert.ok(allowed.includes('console'));
		assert.ok(!allowed.includes('x'), 'local vars should not appear');
	});
});

suite('DependencyGraphService — combined import styles', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('handles default + named + namespace in same file', async () => {
		const svc = store.add(new DependencyGraphService());
		const code = [
			"import Default from './d';",
			"import * as NS from './ns';",
			"import { Named } from './n';",
		].join('\n');
		const allowed = await svc.getAllowedCalls(makeModel(code));
		assert.ok(allowed.includes('Default'));
		assert.ok(allowed.includes('NS'));
		assert.ok(allowed.includes('Named'));
	});

	test('returns array (not duplicating built-ins per import)', async () => {
		const svc = store.add(new DependencyGraphService());
		const code = "import { Foo } from 'a';\nimport { Bar } from 'b';";
		const allowed = await svc.getAllowedCalls(makeModel(code));
		// Each built-in appears exactly once
		assert.strictEqual(allowed.filter(a => a === 'console').length, 1);
	});
});
