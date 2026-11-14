/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IContextViewProvider } from '../../../../browser/ui/contextview/contextview.js';
import { unthemedSelectBoxStyles } from '../../../../browser/ui/selectBox/selectBox.js';
import { SelectBoxList } from '../../../../browser/ui/selectBox/selectBoxCustom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('SelectBoxList', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('reuses existing option elements when options change', () => {
		const container = document.createElement('div');
		const selectBox = disposables.add(new SelectBoxList([
			{ text: 'one' },
			{ text: 'two' }
		], 0, {} as IContextViewProvider, unthemedSelectBoxStyles));
		selectBox.render(container);

		const selectElement = container.querySelector('select')!;
		const firstOption = selectElement.options[0];
		const secondOption = selectElement.options[1];

		selectBox.setOptions([
			{ text: 'three', isDisabled: true },
			{ text: 'four' }
		], 1);

		assert.strictEqual(selectElement.options[0], firstOption);
		assert.strictEqual(selectElement.options[1], secondOption);
		assert.strictEqual(firstOption.value, 'three');
		assert.strictEqual(firstOption.text, 'three');
		assert.strictEqual(firstOption.disabled, true);
		assert.strictEqual(selectElement.selectedIndex, 1);

		selectBox.setOptions([{ text: 'five' }], 0);

		assert.strictEqual(selectElement.options.length, 1);
		assert.strictEqual(selectElement.options[0], firstOption);
		assert.strictEqual(firstOption.value, 'five');
	});
});
