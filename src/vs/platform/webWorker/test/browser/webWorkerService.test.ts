/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { WebWorkerDescriptor } from '../../browser/webWorkerDescriptor.js';
import { WebWorkerService } from '../../browser/webWorkerServiceImpl.js';
import type { IWorkerNlsProbe } from './workerNlsProbe.js';

suite('WebWorkerService localization', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let previousMessages: PropertyDescriptor | undefined;
	let previousLanguage: PropertyDescriptor | undefined;

	setup(() => {
		previousMessages = Object.getOwnPropertyDescriptor(globalThis, '_VSCODE_NLS_MESSAGES');
		previousLanguage = Object.getOwnPropertyDescriptor(globalThis, '_VSCODE_NLS_LANGUAGE');
	});

	teardown(() => {
		for (const [name, descriptor] of [['_VSCODE_NLS_MESSAGES', previousMessages], ['_VSCODE_NLS_LANGUAGE', previousLanguage]] as const) {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor);
			} else {
				Reflect.deleteProperty(globalThis, name);
			}
		}
	});

	function createClient() {
		const service = new WebWorkerService();
		return store.add(service.createWorkerClient<IWorkerNlsProbe>(new WebWorkerDescriptor({
			esmModuleLocation: URI.parse(new URL('./workerNlsProbe.js', import.meta.url).href),
			label: 'localization-test'
		})));
	}

	test('initializes localization before module loading and queued RPC calls', async () => {
		const messages = ['double " and single \'', 'line\nbreak', 'separator \u2028 \u2029', 'null \0', 'emoji 😀', '</script>'];
		const expected = messages.slice();
		globalThis._VSCODE_NLS_MESSAGES = messages;
		globalThis._VSCODE_NLS_LANGUAGE = 'test-language';
		const client = createClient();
		const inspection = client.proxy.$inspect();
		const echo = client.proxy.$echo('queued immediately');
		messages[0] = 'changed after creation';
		globalThis._VSCODE_NLS_LANGUAGE = 'changed-language';

		assert.deepStrictEqual(await Promise.all([inspection, echo]), [
			{ messages: expected, language: 'test-language' },
			'queued immediately'
		]);
	});

	test('keeps localization snapshots independent between workers', async () => {
		globalThis._VSCODE_NLS_MESSAGES = ['first'];
		globalThis._VSCODE_NLS_LANGUAGE = 'first-language';
		const first = createClient();
		globalThis._VSCODE_NLS_MESSAGES = ['second'];
		globalThis._VSCODE_NLS_LANGUAGE = 'second-language';
		const second = createClient();

		assert.deepStrictEqual(await Promise.all([first.proxy.$inspect(), second.proxy.$inspect()]), [
			{ messages: ['first'], language: 'first-language' },
			{ messages: ['second'], language: 'second-language' }
		]);
	});

	test('supports development without a bundled localization array', async () => {
		Object.defineProperty(globalThis, '_VSCODE_NLS_MESSAGES', { value: undefined, writable: true, configurable: true });
		globalThis._VSCODE_NLS_LANGUAGE = undefined;
		const client = createClient();

		assert.deepStrictEqual(await client.proxy.$inspect(), { messages: undefined, language: undefined });
	});
});
