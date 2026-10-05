/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../../../base/common/event.js';
import { combinedDisposable, DisposableMap, toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ChatInputPart } from '../../../../browser/widget/input/chatInputPart.js';

suite('ChatInputPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposes confirmation carousel listeners with the carousel', () => {
		const carousels = store.add(new DisposableMap<string>());
		const event = store.add(new Emitter<void>());
		const activeSubagent = store.add(new Emitter<string | undefined>());
		const key = 'session';
		let carouselDisposed = false;
		let eventCount = 0;

		carousels.set(key, combinedDisposable(
			toDisposable(() => carouselDisposed = true),
			event.event(() => eventCount++),
		));
		ChatInputPart.prototype.clearToolConfirmationCarousel.call({
			_currentSessionKey: key,
			_chatToolConfirmationCarousels: carousels,
			_onDidChangeActiveConfirmationSubagent: activeSubagent,
			chatToolConfirmationCarouselContainer: document.createElement('div'),
		} as ChatInputPart);
		event.fire();

		assert.deepStrictEqual({ carouselDisposed, eventCount, retained: carousels.has(key) }, { carouselDisposed: true, eventCount: 0, retained: false });
	});
});
