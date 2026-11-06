/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { SearchEditorScheme } from '../../browser/constants.js';
import { SearchEditorInput } from '../../browser/searchEditorInput.js';
import { searchEditorModelFactory } from '../../browser/searchEditorModel.js';

suite('SearchEditorInput', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createInput(resource: URI, backingUri?: URI) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const decorations = store.add(instantiationService.createInstance(DecorationsService));
		instantiationService.stub(IDecorationsService, decorations);
		searchEditorModelFactory.models.set(resource, { resolve: () => Promise.reject(new Error('Not implemented')) });
		store.add(toDisposable(() => searchEditorModelFactory.models.delete(resource)));
		const input = store.add(instantiationService.createInstance(SearchEditorInput, resource, backingUri));
		store.add(decorations.registerDecorationsProvider({
			label: 'Test',
			onDidChange: Event.None,
			provideDecorations: () => undefined
		}));
		const cache = Reflect.get(decorations, '_data') as { get(uri: URI): object | undefined };
		return { input, decorations, cache };
	}

	test('disposal clears the temporary resource decoration cache', () => {
		const resource = URI.from({ scheme: SearchEditorScheme, fragment: 'disposed' });
		const otherResource = URI.from({ scheme: SearchEditorScheme, fragment: 'other' });
		const { input, decorations, cache } = createInput(resource);
		decorations.getDecoration(resource, false);
		decorations.getDecoration(otherResource, false);
		const cachedBefore = !!cache.get(resource);

		input.dispose();

		assert.deepStrictEqual({ cachedBefore, cachedAfter: !!cache.get(resource), otherCached: !!cache.get(otherResource) }, {
			cachedBefore: true, cachedAfter: false, otherCached: true
		});
	});

	test('disposal preserves cached decorations for a saved search file', () => {
		const resource = URI.from({ scheme: SearchEditorScheme, fragment: 'saved' });
		const backingUri = URI.file('/saved.code-search');
		const { input, decorations, cache } = createInput(resource, backingUri);
		decorations.getDecoration(resource, false);
		decorations.getDecoration(backingUri, false);

		input.dispose();

		assert.deepStrictEqual({ temporaryCached: !!cache.get(resource), backingCached: !!cache.get(backingUri) }, {
			temporaryCached: false, backingCached: true
		});
	});
});
