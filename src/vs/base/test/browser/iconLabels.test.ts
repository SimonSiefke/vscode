/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isHTMLElement } from '../../browser/dom.js';
import { renderIcon, renderLabelWithIcons } from '../../browser/ui/iconLabel/iconLabels.js';
import { ThemeIcon } from '../../common/themables.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('renderLabelWithIcons', () => {

	test('default color does not change cached icon classes', () => {
		const icon = { id: 'symbol-class' };
		const classes = ThemeIcon.asClassNameArray(icon);
		for (let i = 0; i < 1000; i++) {
			renderIcon(icon, true);
		}
		assert.deepStrictEqual({
			colored: renderIcon(icon, true).className,
			ordinary: renderIcon(icon).className,
			selector: ThemeIcon.asCSSSelector(icon),
			classes: [...classes],
			shared: classes === ThemeIcon.asClassNameArray(icon),
			frozen: Object.isFrozen(classes)
		}, {
			colored: 'codicon codicon-symbol-class codicon-colored',
			ordinary: 'codicon codicon-symbol-class',
			selector: '.codicon.codicon-symbol-class',
			classes: ['codicon', 'codicon-symbol-class'],
			shared: true,
			frozen: true
		});
	});

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
