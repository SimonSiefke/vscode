/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from '../../common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('Node compile cache', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let testDirectory: string;
	setup(() => {
		testDirectory = fs.mkdtempSync(join(tmpdir(), 'vscode-compile-cache-'));
	});
	teardown(() => {
		fs.rmSync(testDirectory, { recursive: true, force: true });
	});

	function run(environment: NodeJS.ProcessEnv = {}, separateHelper = false): { generating: boolean; enabled: boolean; runtimeCache: boolean; status: string } {
		const env = { ...process.env };
		for (const name of Object.keys(env)) {
			if (name.startsWith('NODE_COMPILE_CACHE') || name.startsWith('VSCODE_NODE_COMPILE_CACHE') || name === 'NODE_DISABLE_COMPILE_CACHE' || name === 'VSCODE_DEV' || name === 'VSCODE_GENERATE_NODE_COMPILE_CACHE') {
				delete env[name];
			}
		}
		const moduleUrl = new URL('../../node/nodeCompileCache.js', import.meta.url).href;
		const script = `
			import { enableNodeCompileCache } from ${JSON.stringify(moduleUrl)};
			import { getCompileCacheDir } from 'node:module';
			import { readFileSync } from 'node:fs';
			const generating = enableNodeCompileCache('main');
			const helper = await import(${JSON.stringify(moduleUrl + (separateHelper ? '?readiness' : ''))});
			helper.markNodeCompileCacheReady(() => {});
			const status = JSON.parse(readFileSync(process.env.VSCODE_NODE_COMPILE_CACHE_MEASUREMENTS + '/main.json', 'utf8')).nodeCompileCache;
			console.log(JSON.stringify({ generating, enabled: !!getCompileCacheDir(), runtimeCache: !!status.isRuntimeCacheEnabled, status: status.status }));
		`;
		return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
			encoding: 'utf8',
			env: { ...env, ELECTRON_RUN_AS_NODE: '1', TMPDIR: testDirectory, VSCODE_NODE_COMPILE_CACHE_MEASUREMENTS: join(testDirectory, 'measurements'), ...environment }
		}));
	}

	const posixTest = process.platform === 'win32' ? test.skip : test;

	posixTest('enables a writable cache without entering packaged-cache generation', () => {
		assert.deepStrictEqual(run(), { generating: false, enabled: true, runtimeCache: true, status: 'enabled' });
	});

	posixTest('does not generate a packaged cache on POSIX', () => {
		const root = join(testDirectory, 'packaged');
		assert.deepStrictEqual(run({ VSCODE_GENERATE_NODE_COMPILE_CACHE: '1', VSCODE_NODE_COMPILE_CACHE_ROOT: root }), { generating: false, enabled: false, runtimeCache: false, status: 'disabled' });
		assert.strictEqual(fs.existsSync(join(root, 'main', '.ready')), false);
	});

	test('records readiness from another helper module instance', () => {
		const environment = {
			VSCODE_NODE_COMPILE_CACHE_KIND: 'extension-host',
			VSCODE_NODE_COMPILE_CACHE_ROOT: join(testDirectory, 'packaged')
		};
		const expected = process.platform === 'win32'
			? { generating: false, enabled: false, runtimeCache: false, status: 'missing' }
			: { generating: false, enabled: true, runtimeCache: true, status: 'enabled' };
		assert.deepStrictEqual(run(environment, true), expected);
	});

	posixTest('respects the Node compile cache opt-out', () => {
		assert.deepStrictEqual(run({ NODE_DISABLE_COMPILE_CACHE: '1' }), { generating: false, enabled: false, runtimeCache: false, status: 'disabled' });
	});

	posixTest('does not activate a runtime cache in development', () => {
		assert.deepStrictEqual(run({ VSCODE_DEV: '1' }), { generating: false, enabled: false, runtimeCache: false, status: 'development' });
	});

	posixTest('preserves an already enabled cache', () => {
		assert.deepStrictEqual(run({ NODE_COMPILE_CACHE: join(testDirectory, 'existing') }), { generating: false, enabled: true, runtimeCache: true, status: 'already-enabled' });
	});

	posixTest('continues when the default cache directory cannot be created', () => {
		const file = join(testDirectory, 'file');
		fs.writeFileSync(file, '');
		assert.deepStrictEqual(run({ TMPDIR: file }), { generating: false, enabled: false, runtimeCache: false, status: 'failed' });
	});
});
