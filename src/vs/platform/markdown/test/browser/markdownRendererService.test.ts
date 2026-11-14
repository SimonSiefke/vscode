/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IOpenerService } from '../../../opener/common/opener.js';
import { MarkdownRendererService } from '../../browser/markdownRenderer.js';

suite('MarkdownRendererService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('does not resolve lazy code block renderer for markdown without code blocks', () => {
		const service = new MarkdownRendererService({
			open() {
				return Promise.resolve(true);
			}
		} as unknown as IOpenerService);
		let factoryCalls = 0;

		service.setDefaultCodeBlockRenderer(async () => {
			factoryCalls++;
			return {
				renderCodeBlock() {
					throw new Error('unexpected code block render');
				}
			};
		});

		store.add(service.render({ value: 'hello' }));

		assert.strictEqual(factoryCalls, 0);
	});

	test('resolves lazy code block renderer once and reuses it', async () => {
		const service = new MarkdownRendererService({
			open() {
				return Promise.resolve(true);
			}
		} as unknown as IOpenerService);
		let factoryCalls = 0;
		let renderCalls = 0;

		service.setDefaultCodeBlockRenderer(async () => {
			factoryCalls++;
			return {
				renderCodeBlock(_languageAlias, value) {
					renderCalls++;
					const element = document.createElement('code');
					element.textContent = value;
					return Promise.resolve(element);
				}
			};
		});

		await new Promise<void>(resolve => {
			store.add(service.render({ value: '```ts\nconst x = 1;\n```' }, { asyncRenderCallback: resolve }));
		});
		await new Promise<void>(resolve => {
			store.add(service.render({ value: '```ts\nconst y = 2;\n```' }, { asyncRenderCallback: resolve }));
		});

		assert.strictEqual(factoryCalls, 1);
		assert.strictEqual(renderCalls, 2);
	});
});
