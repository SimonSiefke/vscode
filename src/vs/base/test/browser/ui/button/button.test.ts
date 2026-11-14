/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindow } from '../../../../browser/dom.js';
import { Button, ButtonWithDropdown, ButtonWithIcon, unthemedButtonStyles } from '../../../../browser/ui/button/button.js';
import { Codicon } from '../../../../common/codicons.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('Button', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('leading icon styling survives icon replacement and stays local to its button', () => {
		const container = document.body.appendChild(document.createElement('div'));
		store.add({ dispose: () => container.remove() });
		const style = container.appendChild(document.createElement('style'));
		style.textContent = '.monaco-button .test-leading-glyph { padding-top: 7px; }';
		const button = store.add(new ButtonWithIcon(container, { ...unthemedButtonStyles, iconClassName: 'test-leading-glyph' }));
		const other = store.add(new ButtonWithIcon(container, unthemedButtonStyles));
		const targetWindow = getWindow(container);
		assert.strictEqual(targetWindow.getComputedStyle(button.iconElement).paddingTop, '7px');
		for (const icon of [Codicon.check, Codicon.sync, Codicon.error]) {
			button.icon = icon;
			button.label = icon.id;
			assert.ok(button.iconElement.classList.contains(`codicon-${icon.id}`));
			assert.strictEqual(targetWindow.getComputedStyle(button.iconElement).paddingTop, '7px');
		}
		other.icon = Codicon.check;
		assert.notStrictEqual(targetWindow.getComputedStyle(other.iconElement).paddingTop, '7px');
	});

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

	test('creation styling reaches both dropdown buttons and survives label and icon updates', () => {
		const container = document.createElement('div');
		container.style.cssText = 'position: fixed; top: 0; left: 0;';
		document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		const style = container.appendChild(document.createElement('style'));
		style.textContent = '.test-owned-button { min-width: 31px; }';
		const button = store.add(new ButtonWithDropdown(container, {
			...unthemedButtonStyles,
			buttonClassName: 'test-owned-button',
			actions: [],
			contextMenuProvider: { showContextMenu() { } }
		}));
		const widths = () => [button.primaryButton, button.dropdownButton].map(part => getWindow(part.element).getComputedStyle(part.element).minWidth);
		assert.deepStrictEqual(widths(), ['31px', '31px']);
		for (const icon of [Codicon.check, Codicon.sync]) {
			button.label = icon.id;
			button.icon = icon;
			button.enabled = false;
			button.enabled = true;
			assert.deepStrictEqual(widths(), ['31px', '31px']);
		}
		const other = store.add(new Button(container, unthemedButtonStyles));
		assert.notStrictEqual(getWindow(other.element).getComputedStyle(other.element).minWidth, '31px');
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
