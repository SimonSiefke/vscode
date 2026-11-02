/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../browser/window.js';
import { HighlightedLabel } from '../../browser/ui/highlightedlabel/highlightedLabel.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('HighlightedLabel', () => {
	let label: HighlightedLabel;

	setup(() => {
		label = new HighlightedLabel(document.createElement('div'));
	});

	test('empty label', function () {
		assert.strictEqual(label.element.innerHTML, '');
	});

	test('no decorations', function () {
		label.set('hello');
		assert.strictEqual(label.element.innerHTML, 'hello');
	});

	test('colored symbol icon', function () {
		label.set('$(symbol-class) hello', undefined, undefined, undefined, true);
		assert.strictEqual(label.element.innerHTML, '<span class="codicon codicon-symbol-class codicon-colored monaco-highlighted-label-part"></span> hello');
	});

	test('part styling reaches highlights and icons across label updates', function () {
		const container = document.createElement('div');
		container.style.cssText = 'position: fixed; top: 0; left: 0; width: 300px;';
		const style = document.createElement('style');
		style.textContent = '.monaco-highlighted-label > span:where(.monaco-highlighted-label-part) { padding-left: 6px; }';
		container.appendChild(label.element);
		document.body.append(container, style);
		try {
			const states = [
				{ text: 'plain', highlights: [{ start: 0, end: 5 }] },
				{ text: '$(add) item', highlights: [{ start: 7, end: 11 }] },
				{ text: 'item $(add)', highlights: [{ start: 0, end: 4 }] },
				{ text: '$(add) item', highlights: [{ start: 0, end: 6 }] },
				{ text: 'plain', highlights: [] },
			];
			const padding = states.map(state => {
				label.set(state.text, state.highlights, undefined, undefined, true);
				return Array.from(label.element.children, part => mainWindow.getComputedStyle(part).paddingLeft);
			});
			assert.deepStrictEqual(padding, [['6px'], ['6px', '6px'], ['6px', '6px'], ['6px'], []]);
		} finally {
			container.remove();
			style.remove();
		}
	});

	test('escape html', function () {
		label.set('hel<lo');
		assert.strictEqual(label.element.innerHTML, 'hel&lt;lo');
	});

	test('everything highlighted', function () {
		label.set('hello', [{ start: 0, end: 5 }]);
		assert.strictEqual(label.element.innerHTML, '<span class="highlight monaco-highlighted-label-part">hello</span>');
	});

	test('beginning highlighted', function () {
		label.set('hellothere', [{ start: 0, end: 5 }]);
		assert.strictEqual(label.element.innerHTML, '<span class="highlight monaco-highlighted-label-part">hello</span>there');
	});

	test('ending highlighted', function () {
		label.set('goodbye', [{ start: 4, end: 7 }]);
		assert.strictEqual(label.element.innerHTML, 'good<span class="highlight monaco-highlighted-label-part">bye</span>');
	});

	test('middle highlighted', function () {
		label.set('foobarfoo', [{ start: 3, end: 6 }]);
		assert.strictEqual(label.element.innerHTML, 'foo<span class="highlight monaco-highlighted-label-part">bar</span>foo');
	});

	test('escapeNewLines', () => {

		let highlights = [{ start: 0, end: 5 }, { start: 7, end: 9 }, { start: 11, end: 12 }];// before,after,after
		let escaped = HighlightedLabel.escapeNewLines('ACTION\r\n_TYPE2', highlights);
		assert.strictEqual(escaped, 'ACTION\u23CE_TYPE2');
		assert.deepStrictEqual(highlights, [{ start: 0, end: 5 }, { start: 6, end: 8 }, { start: 10, end: 11 }]);

		highlights = [{ start: 5, end: 9 }, { start: 11, end: 12 }];//overlap,after
		escaped = HighlightedLabel.escapeNewLines('ACTION\r\n_TYPE2', highlights);
		assert.strictEqual(escaped, 'ACTION\u23CE_TYPE2');
		assert.deepStrictEqual(highlights, [{ start: 5, end: 8 }, { start: 10, end: 11 }]);
	});

	teardown(() => {
		label.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
