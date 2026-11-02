/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { EditorMarkdownCodeBlockRenderer } from '../../../browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js';
import { LanguageService } from '../../../common/services/languageService.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { MarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { NullOpenerService } from '../../../../platform/opener/test/common/nullOpenerService.js';

suite('Editor Markdown code-block element styling', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('marks wrappers, tokens and line breaks without changing subsequent default markup', async () => {
		const languageService = store.add(new LanguageService());
		const renderer = new EditorMarkdownCodeBlockRenderer(new TestConfigurationService({ editor: { fontFamily: 'monospace' } }), languageService);
		const original = await renderer.renderCodeBlock(undefined, '<code>\n&value', {});
		const marked = await renderer.renderCodeBlock(undefined, '<code>\n&value', { elementClassName: 'test-code-owner' });
		const elements = [marked, ...marked.querySelectorAll('*')];
		assert.ok(elements.length > 4);
		assert.ok(elements.every(element => element.classList.contains('test-code-owner')));
		assert.strictEqual(marked.querySelector('script'), null);
		assert.strictEqual(marked.textContent, original.textContent);
		for (const element of elements) {
			element.classList.remove('test-code-owner');
			if (!element.className) {
				element.removeAttribute('class');
			}
		}
		assert.strictEqual(marked.outerHTML, original.outerHTML);
		const subsequent = await renderer.renderCodeBlock(undefined, '<code>\n&value', {});
		assert.strictEqual(subsequent.outerHTML, original.outerHTML);
	});

	test('marks the empty code replacement when no default renderer is installed', async () => {
		const service = new MarkdownRendererService(NullOpenerService);
		let completed!: () => void;
		const completion = new Promise<void>(resolve => completed = resolve);
		const rendered = store.add(service.render({ value: '```text\ncode\n```' }, { elementClassName: 'test-code-owner', asyncRenderCallback: completed }));
		await completion;
		const elements = Array.from(rendered.element.querySelectorAll('*'));
		assert.strictEqual(elements.length, 2);
		assert.ok(elements.every(element => element.classList.contains('test-code-owner')));
	});
});
