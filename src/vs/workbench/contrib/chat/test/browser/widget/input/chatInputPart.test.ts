/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../../../base/common/event.js';
import { DisposableMap, DisposableStore, toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ChatInputPart } from '../../../../browser/widget/input/chatInputPart.js';

suite('ChatInputPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposes confirmation carousel listeners with the carousel', () => {
		const carousels = store.add(new DisposableMap<string>());
		const carouselListeners = store.add(new DisposableMap<string, DisposableStore>());
		const event = store.add(new Emitter<void>());
		const key = 'session';
		let carouselDisposed = false;
		let eventCount = 0;

		carousels.set(key, toDisposable(() => carouselDisposed = true));
		const listeners = new DisposableStore();
		listeners.add(event.event(() => eventCount++));
		carouselListeners.set(key, listeners);

		const disposeToolConfirmationCarousel = Reflect.get(ChatInputPart.prototype, '_disposeToolConfirmationCarousel') as (this: object, key: string) => void;
		disposeToolConfirmationCarousel.call({
			_chatToolConfirmationCarousels: carousels,
			_chatToolConfirmationCarouselListeners: carouselListeners,
		}, key);
		event.fire();

		assert.strictEqual(carouselDisposed, true);
		assert.strictEqual(eventCount, 0);
		assert.strictEqual(carousels.has(key), false);
		assert.strictEqual(carouselListeners.has(key), false);
	});
});
