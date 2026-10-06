/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, ModifierKeyEmitter } from '../../../../browser/dom.js';
import { unthemedMenuStyles } from '../../../../browser/ui/menu/menu.js';
import { MenuBar } from '../../../../browser/ui/menu/menubar.js';
import { mainWindow } from '../../../../browser/window.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

function getButtonElementByAriaLabel(menubarElement: HTMLElement, ariaLabel: string): HTMLElement | null {
	let i;
	for (i = 0; i < menubarElement.childElementCount; i++) {

		if (menubarElement.children[i].getAttribute('aria-label') === ariaLabel) {
			return menubarElement.children[i] as HTMLElement;
		}
	}

	return null;
}

function getTitleDivFromButtonDiv(menuButtonElement: HTMLElement): HTMLElement | null {
	let i;
	for (i = 0; i < menuButtonElement.childElementCount; i++) {
		if (menuButtonElement.children[i].classList.contains('menubar-menu-title')) {
			return menuButtonElement.children[i] as HTMLElement;
		}
	}

	return null;
}

function getMnemonicFromTitleDiv(menuTitleDiv: HTMLElement): string | null {
	let i;
	for (i = 0; i < menuTitleDiv.childElementCount; i++) {
		if (menuTitleDiv.children[i].tagName.toLocaleLowerCase() === 'mnemonic') {
			return menuTitleDiv.children[i].textContent;
		}
	}

	return null;
}

function validateMenuBarItem(menubar: MenuBar, menubarContainer: HTMLElement, label: string, readableLabel: string, mnemonic: string) {
	menubar.push([
		{
			actions: [],
			label: label
		}
	]);

	const buttonElement = getButtonElementByAriaLabel(menubarContainer, readableLabel);
	assert(buttonElement !== null, `Button element not found for ${readableLabel} button.`);

	const titleDiv = getTitleDivFromButtonDiv(buttonElement);
	assert(titleDiv !== null, `Title div not found for ${readableLabel} button.`);

	const mnem = getMnemonicFromTitleDiv(titleDiv);
	assert.strictEqual(mnem, mnemonic, 'Mnemonic not correct');
}

suite('Menubar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const container = $('.container');

	for (const resizedElement of ['container', 'sibling'] as const) {
		test(`expands automatically when its ${resizedElement} releases space`, async () => {
			const parent = document.createElement('div');
			parent.style.cssText = 'display: flex; width: 600px; height: 30px; font: 13px sans-serif;';
			const menuContainer = parent.appendChild(document.createElement('div'));
			menuContainer.style.cssText = 'display: flex; flex: 1; min-width: 0;';
			const sibling = parent.appendChild(document.createElement('div'));
			sibling.style.cssText = 'width: 0; flex-shrink: 0;';
			const element = menuContainer.appendChild($('.menubar'));
			document.body.appendChild(parent);
			disposables.add(toDisposable(() => parent.remove()));
			disposables.add(toDisposable(() => ModifierKeyEmitter.disposeInstance()));
			const menubar = disposables.add(new MenuBar(element, { visibility: 'visible' }, unthemedMenuStyles));
			const labels = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'];
			menubar.push(labels.map(label => ({ label, actions: [] })));
			const settle = async () => {
				for (let frame = 0; frame < 4; frame++) {
					await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
				}
			};
			const visibleMenus = () => labels.filter(label => getButtonElementByAriaLabel(element, label)?.style.visibility !== 'hidden');
			await settle();
			assert.deepStrictEqual(visibleMenus(), labels);

			if (resizedElement === 'container') {
				parent.style.width = '70px';
			} else {
				sibling.style.width = '530px';
			}
			await settle();
			assert.deepStrictEqual(visibleMenus(), []);

			if (resizedElement === 'container') {
				parent.style.width = '600px';
			} else {
				sibling.style.width = '0';
			}
			await settle();
			assert.deepStrictEqual(visibleMenus(), labels);
			assert.strictEqual(element.classList.contains('overflow-menu-only'), false);
		});
	}

	const withMenuMenubar = (callback: (menubar: MenuBar) => void) => {
		const menubar = new MenuBar(container, {
			enableMnemonics: true,
			visibility: 'visible'
		}, unthemedMenuStyles);

		callback(menubar);

		menubar.dispose();
		ModifierKeyEmitter.disposeInstance();
	};

	test('English File menu renders mnemonics', function () {
		withMenuMenubar(menubar => {
			validateMenuBarItem(menubar, container, '&File', 'File', 'F');
		});
	});

	test('Russian File menu renders mnemonics', function () {
		withMenuMenubar(menubar => {
			validateMenuBarItem(menubar, container, '&Файл', 'Файл', 'Ф');
		});
	});

	test('Chinese File menu renders mnemonics', function () {
		withMenuMenubar(menubar => {
			validateMenuBarItem(menubar, container, '文件(&F)', '文件', 'F');
		});
	});
});
