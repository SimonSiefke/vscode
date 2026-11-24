/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindow, isHTMLElement } from '../../browser/dom.js';
import { renderLabelWithIcons } from '../../browser/ui/iconLabel/iconLabels.js';
import { SimpleIconLabel } from '../../browser/ui/iconLabel/simpleIconLabel.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('renderLabelWithIcons', () => {

	test('no icons', () => {
		const result = renderLabelWithIcons(' hello World .');

		assert.strictEqual(elementsToString(result), ' hello World .');
	});

	test('icons only', () => {
		const result = renderLabelWithIcons('$(alert)');

		assert.strictEqual(elementsToString(result), '<span class="codicon codicon-alert"></span>');
	});

	test('icon and non-icon strings', () => {
		const result = renderLabelWithIcons(` $(alert) Unresponsive`);

		assert.strictEqual(elementsToString(result), ' <span class="codicon codicon-alert"></span> Unresponsive');
	});

	test('multiple icons', () => {
		const result = renderLabelWithIcons('$(check)$(error)');

		assert.strictEqual(elementsToString(result), '<span class="codicon codicon-check"></span><span class="codicon codicon-error"></span>');
	});

	test('escaped icons', () => {
		const result = renderLabelWithIcons('\\$(escaped)');

		assert.strictEqual(elementsToString(result), '$(escaped)');
	});

	test('icon with animation', () => {
		const result = renderLabelWithIcons('$(zip~anim)');

		assert.strictEqual(elementsToString(result), '<span class="codicon codicon-zip codicon-modifier-anim"></span>');
	});

	const elementsToString = (elements: Array<HTMLElement | string>): string => {
		return elements
			.map(elem => isHTMLElement(elem) ? elem.outerHTML : elem)
			.reduce((a, b) => a + b, '');
	};

	ensureNoDisposablesAreLeakedInTestSuite();
});


suite('SimpleIconLabel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('glyph styling follows label updates and stays local to its owner', () => {
		const container = document.createElement('div');
		container.className = 'test-simple-icon-label';
		document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		const style = container.appendChild(document.createElement('style'));
		style.textContent = '.test-simple-icon-label .test-simple-label-glyph { padding-left: 9px; }';
		const labelContainer = container.appendChild(document.createElement('div'));
		const otherContainer = container.appendChild(document.createElement('div'));
		const label = store.add(new SimpleIconLabel(labelContainer, 'test-simple-label-glyph'));
		const other = store.add(new SimpleIconLabel(otherContainer));
		const targetWindow = getWindow(container);
		const paddings: string[][] = [];
		const texts: (string | null)[] = [];
		for (const text of ['$(info) Opening', '$(warning) Waiting', 'Ready', '$(check) Complete']) {
			label.text = text;
			paddings.push([...labelContainer.children].map(child => targetWindow.getComputedStyle(child).paddingLeft));
			texts.push(labelContainer.textContent);
		}
		other.text = '$(info) Other';
		assert.deepStrictEqual({
			paddings,
			texts,
			otherKeepsOwnPadding: [...otherContainer.children].every(child => targetWindow.getComputedStyle(child).paddingLeft !== '9px'),
		}, { paddings: [['9px'], ['9px'], [], ['9px']], texts: [' Opening', ' Waiting', 'Ready', ' Complete'], otherKeepsOwnPadding: true });
	});
});
