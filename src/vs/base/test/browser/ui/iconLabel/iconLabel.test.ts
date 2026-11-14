/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../browser/dom.js';
import '../../../../browser/ui/codicons/codiconStyles.js';
import { IconLabel } from '../../../../browser/ui/iconLabel/iconLabel.js';
import { mainWindow } from '../../../../browser/window.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { Codicon } from '../../../../common/codicons.js';
import { ThemeIcon } from '../../../../common/themables.js';
import { URI } from '../../../../common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('IconLabel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();


	test('creation styling survives value updates and clearing', () => {
		const container = $('.icon-label-test');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const style = mainWindow.document.createElement('style');
		style.textContent = '.icon-label-creation-class { min-height: 31px; } .icon-label-creation-class > .icon-label-creation-container { padding-right: 7px; } .icon-label-creation-name { padding-left: 9px; } .icon-label-creation-description { padding-bottom: 5px; }';
		container.appendChild(style);
		const label = disposables.add(new IconLabel(container, { extraClasses: ['icon-label-creation-class'], labelContainerClassName: 'icon-label-creation-container', descriptionContainerClassName: 'icon-label-creation-description', nameContainerClassName: 'icon-label-creation-name' }));
		const heights = [mainWindow.getComputedStyle(label.element).minHeight];
		const labelContainer = label.element.querySelector('.monaco-icon-label-container')!;
		const paddings = [mainWindow.getComputedStyle(labelContainer).paddingRight];
		const descriptionPaddings: string[] = [];
		const namePaddings = [mainWindow.getComputedStyle(label.element.querySelector('.monaco-icon-name-container')!).paddingLeft];
		for (const options of [{ extraClasses: ['value-class'], italic: true }, {}, undefined]) {
			label.setLabel('label', 'description', options);
			heights.push(mainWindow.getComputedStyle(label.element).minHeight);
			paddings.push(mainWindow.getComputedStyle(labelContainer).paddingRight);
			descriptionPaddings.push(mainWindow.getComputedStyle(label.element.querySelector('.monaco-icon-description-container')!).paddingBottom);
			namePaddings.push(mainWindow.getComputedStyle(label.element.querySelector('.monaco-icon-name-container')!).paddingLeft);
		}
		label.setLabel('');
		heights.push(mainWindow.getComputedStyle(label.element).minHeight);
		paddings.push(mainWindow.getComputedStyle(labelContainer).paddingRight);
		descriptionPaddings.push(mainWindow.getComputedStyle(label.element.querySelector('.monaco-icon-description-container')!).paddingBottom);
		namePaddings.push(mainWindow.getComputedStyle(label.element.querySelector('.monaco-icon-name-container')!).paddingLeft);
		assert.deepStrictEqual({ heights, paddings, namePaddings, descriptionPaddings }, { heights: Array(5).fill('31px'), paddings: Array(5).fill('7px'), namePaddings: Array(5).fill('9px'), descriptionPaddings: Array(4).fill('5px') });
	});

	test('highlighted creation styling survives scalar, multipart and lazy description updates', () => {
		const container = $('.icon-label-test');
		container.style.cssText = 'position: fixed; top: 0; left: 0;';
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const style = mainWindow.document.createElement('style');
		style.textContent = '.icon-label-created-highlight { padding-left: 6px; }';
		container.appendChild(style);
		const label = disposables.add(new IconLabel(container, { supportHighlights: true, supportDescriptionHighlights: true, highlightedLabelClassName: 'icon-label-created-highlight' }));
		const read = () => {
			const description = label.element.querySelector('.monaco-icon-description-container .monaco-highlighted-label');
			return {
				names: Array.from(label.element.querySelectorAll('.monaco-icon-name-container .monaco-highlighted-label'), element => mainWindow.getComputedStyle(element).paddingLeft),
				description: description ? mainWindow.getComputedStyle(description).paddingLeft : null,
			};
		};
		label.setLabel('one', undefined, { matches: [{ start: 0, end: 1 }] });
		const states = [read()];
		label.setLabel(['one', 'two'], undefined, { matches: [{ start: 0, end: 7 }] });
		states.push(read());
		label.setLabel('three', 'detail', { matches: [{ start: 1, end: 2 }], descriptionMatches: [{ start: 0, end: 2 }] });
		states.push(read());
		label.setLabel(['four', 'five'], 'more', { matches: [{ start: 0, end: 9 }], descriptionMatches: [{ start: 0, end: 2 }] });
		states.push(read());
		label.setLabel('final', 'last');
		states.push(read());
		assert.deepStrictEqual(states, [
			{ names: ['6px'], description: null },
			{ names: ['6px', '6px'], description: null },
			{ names: ['6px'], description: '6px' },
			{ names: ['6px', '6px'], description: '6px' },
			{ names: ['6px'], description: '6px' },
		]);
	});

	for (const supportHighlights of [false, true]) {
		test(`name, suffix and description share state styles (highlights: ${supportHighlights})`, () => {
			const container = $('.icon-label-test');
			mainWindow.document.body.appendChild(container);
			disposables.add(toDisposable(() => container.remove()));
			const label = disposables.add(new IconLabel(container, { supportHighlights, supportDescriptionHighlights: supportHighlights }));
			const states = [];
			for (const options of [{ italic: true }, { strikethrough: true }, { bold: true }, {}]) {
				label.setLabel('filename', 'description', { ...options, suffix: '.ts' });
				states.push(['.label-name', '.label-suffix', '.label-description'].map(selector => {
					const style = mainWindow.getComputedStyle(container.querySelector<HTMLElement>(selector)!);
					return {
						italic: style.fontStyle === 'italic',
						strikethrough: style.textDecorationLine === 'line-through',
						bold: Number(style.fontWeight) >= 600,
					};
				}));
			}
			assert.deepStrictEqual(states, [
				Array(3).fill({ italic: true, strikethrough: false, bold: false }),
				Array(3).fill({ italic: false, strikethrough: true, bold: false }),
				Array(3).fill({ italic: false, strikethrough: false, bold: true }),
				Array(3).fill({ italic: false, strikethrough: false, bold: false }),
			]);
		});
	}

	test('its icon takes the color given for it; without one, the icon keeps the color of the label', () => {
		const container = $('.icon-label-test');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		container.style.color = 'rgb(0, 0, 255)';
		const label = disposables.add(new IconLabel(container));
		const iconColor = () => mainWindow.getComputedStyle(label.element, '::before').color;

		label.setLabel('name', undefined, { iconColor: 'rgb(255, 0, 0)' });
		const colored = iconColor();
		label.setLabel('name', undefined, {});
		const uncolored = iconColor();

		assert.deepStrictEqual({ colored, uncolored }, { colored: 'rgb(255, 0, 0)', uncolored: 'rgb(0, 0, 255)' });
	});

	test('a theme icon of its own, such as a spinning one, spins alone, not the label, and takes the color given for it', () => {
		const container = $('.icon-label-test');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const label = disposables.add(new IconLabel(container));

		label.setLabel('name', undefined, { iconPath: ThemeIcon.modify(Codicon.loading, 'spin'), iconColor: 'rgb(255, 0, 0)' });
		const icon = label.element.querySelector<HTMLElement>('.monaco-icon-label-iconpath')!;

		assert.deepStrictEqual({
			iconSpins: icon.classList.contains('codicon-modifier-spin') && mainWindow.getComputedStyle(icon).animationName,
			labelSpins: mainWindow.getComputedStyle(label.element).animationName,
			iconColor: mainWindow.getComputedStyle(icon).color,
		}, { iconSpins: 'codicon-spin', labelSpins: 'none', iconColor: 'rgb(255, 0, 0)' });
	});

	test('an icon of its own that shows an image after a theme icon, such as as the label is reused for another editor, keeps nothing of the theme icon', () => {
		const container = $('.icon-label-test');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const label = disposables.add(new IconLabel(container));

		label.setLabel('chat', undefined, { iconPath: ThemeIcon.modify(Codicon.loading, 'spin') });
		label.setLabel('page', undefined, { iconPath: URI.parse('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>') });
		const icon = label.element.querySelector<HTMLElement>('.monaco-icon-label-iconpath')!;

		assert.deepStrictEqual({ classes: [...icon.classList], animation: mainWindow.getComputedStyle(icon).animationName, image: icon.style.backgroundImage.startsWith('url(') }, { classes: ['monaco-icon-label-iconpath'], animation: 'none', image: true });
	});

	test('a spinning icon of its own stands still while motion is reduced', () => {
		const container = $('.icon-label-test.monaco-reduce-motion');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const label = disposables.add(new IconLabel(container));

		label.setLabel('chat', undefined, { iconPath: ThemeIcon.modify(Codicon.loading, 'spin') });

		assert.strictEqual(mainWindow.getComputedStyle(label.element.querySelector<HTMLElement>('.monaco-icon-label-iconpath')!).animationName, 'none');
	});
});
