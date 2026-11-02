/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../browser/dom.js';
import { IconLabel } from '../../../../browser/ui/iconLabel/iconLabel.js';
import { mainWindow } from '../../../../browser/window.js';
import { toDisposable } from '../../../../common/lifecycle.js';
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
});
