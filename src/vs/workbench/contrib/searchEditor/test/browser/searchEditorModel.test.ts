/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchEditorModel, searchEditorModelFactory } from '../../browser/searchEditorModel.js';

suite('SearchEditorModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('removes its factory entry when disposed', () => {
		const resource = URI.from({ scheme: 'search-editor-test', fragment: 'dispose' });
		searchEditorModelFactory.models.set(resource, { resolve: () => Promise.reject(new Error('Unexpected resolve')) });

		const model = new SearchEditorModel(resource);
		model.dispose();

		assert.strictEqual(searchEditorModelFactory.models.has(resource), false);
	});
});
