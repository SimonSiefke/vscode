/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TreeVisibility } from '../../../../../base/browser/ui/tree/tree.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { QuickInputTreeFilter } from '../../../browser/tree/quickInputTreeFilter.js';

suite('QuickInputTreeFilter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hides unmatched leaves and searches unmatched parents', () => {
		const filter = new QuickInputTreeFilter();
		filter.filterValue = 'xyz';
		assert.deepStrictEqual([
			filter.filter({ label: 'Hello' }, TreeVisibility.Recurse).visibility,
			filter.filter({ label: 'Hello', children: [{ label: 'xyz' }] }, TreeVisibility.Recurse).visibility,
			filter.filter({ label: 'Hello' }, TreeVisibility.Visible).visibility,
		], [TreeVisibility.Hidden, TreeVisibility.Recurse, TreeVisibility.Visible]);
	});

	test('matches descriptions after an unsuccessful label match', () => {
		const filter = new QuickInputTreeFilter();
		filter.filterValue = 'world';
		filter.matchOnDescription = true;
		assert.deepStrictEqual(filter.filter({ label: 'Hello', description: 'world' }, TreeVisibility.Recurse), {
			visibility: TreeVisibility.Visible,
			data: { labelHighlights: [], descriptionHighlights: [{ start: 0, end: 5 }] }
		});
	});
});
