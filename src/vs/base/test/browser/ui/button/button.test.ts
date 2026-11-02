/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindow } from '../../../../browser/dom.js';
import { Button, unthemedButtonStyles } from '../../../../browser/ui/button/button.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('Button', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('label-part styling follows icon labels, countdown text and content replacement', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		const style = container.appendChild(document.createElement('style'));
		style.textContent = '.monaco-button .test-button-label-part { padding-top: 7px; }';
		const button = store.add(new Button(container, { ...unthemedButtonStyles, supportIcons: true, contentClassName: 'test-button-label-part' }));
		const other = store.add(new Button(container, { ...unthemedButtonStyles, supportIcons: true }));
		const targetWindow = getWindow(container);
		const paddings: string[] = [];
		for (const label of ['$(device-camera) Screenshot', '3...', '$(device-camera) Screenshot', '$(chevron-down)']) {
			button.label = label;
			for (const child of button.element.children) {
				paddings.push(targetWindow.getComputedStyle(child).paddingTop);
			}
		}
		other.label = '$(device-camera) Other';
		assert.deepStrictEqual({
			paddings,
			otherKeepsOwnPadding: [...other.element.children].every(child => targetWindow.getComputedStyle(child).paddingTop !== '7px'),
		}, { paddings: Array(6).fill('7px'), otherKeepsOwnPadding: true });
	});

	test('disabling a hovered button clears its hover background', () => {
		const container = document.createElement('div');
		const button = store.add(new Button(container, {
			...unthemedButtonStyles,
			buttonBackground: 'red',
			buttonHoverBackground: 'blue',
		}));

		const backgrounds: string[] = [button.element.style.backgroundColor];
		button.element.dispatchEvent(new MouseEvent('mouseover'));
		backgrounds.push(button.element.style.backgroundColor);
		button.enabled = false;
		backgrounds.push(button.element.style.backgroundColor);
		button.element.dispatchEvent(new MouseEvent('mouseout'));
		button.element.dispatchEvent(new MouseEvent('mouseover'));
		backgrounds.push(button.element.style.backgroundColor);

		assert.deepStrictEqual(backgrounds, ['red', 'blue', 'red', 'red']);
	});
});
