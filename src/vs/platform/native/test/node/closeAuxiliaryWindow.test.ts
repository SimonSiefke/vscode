/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { closeAuxiliaryWindow } from '../../node/closeAuxiliaryWindow.js';

class TestWindow extends EventEmitter {
	readonly webContents = new EventEmitter();

	constructor(private readonly requestClose: (window: TestWindow) => void) {
		super();
	}

	close(): void {
		this.requestClose(this);
	}

	assertNoRequestListeners(): void {
		assert.deepStrictEqual({ close: this.listenerCount('close'), closed: this.listenerCount('closed'), veto: this.webContents.listenerCount('will-prevent-unload') }, { close: 0, closed: 0, veto: 0 });
	}
}

suite('Native auxiliary window close', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('waits for closed after the close event and releases listeners', async () => {
		const window = new TestWindow(window => window.emit('close', { defaultPrevented: false }));
		const closing = closeAuxiliaryWindow(window);
		assert.strictEqual(await Promise.race([closing, Promise.resolve('pending')]), 'pending');
		assert.strictEqual(window.listenerCount('closed'), 1);
		window.emit('closed');
		assert.strictEqual(await closing, true);
		window.assertNoRequestListeners();
	});

	test('reports a main-process veto after all synchronous close listeners', async () => {
		const window = new TestWindow(window => {
			// Registered after the request observer, as another main-process owner can be.
			window.once('close', event => event.defaultPrevented = true);
			window.emit('close', { defaultPrevented: false });
		});
		assert.strictEqual(await closeAuxiliaryWindow(window), false);
		window.assertNoRequestListeners();
	});

	test('reports a renderer unload veto and releases listeners', async () => {
		const window = new TestWindow(window => {
			window.emit('close', { defaultPrevented: false });
			window.webContents.emit('will-prevent-unload', { defaultPrevented: false });
		});
		assert.strictEqual(await closeAuxiliaryWindow(window), false);
		window.assertNoRequestListeners();
	});

	test('waits for closed when a main-process listener overrides a renderer veto', async () => {
		const window = new TestWindow(window => {
			window.webContents.once('will-prevent-unload', event => event.defaultPrevented = true);
			window.emit('close', { defaultPrevented: false });
			window.webContents.emit('will-prevent-unload', { defaultPrevented: false });
			// The close completion follows the request observer's queued veto check.
			queueMicrotask(() => window.emit('closed'));
		});
		assert.strictEqual(await closeAuxiliaryWindow(window), true);
		window.assertNoRequestListeners();
	});

	test('releases listeners when requesting close throws', async () => {
		const window = new TestWindow(() => { throw new Error('close request failed'); });
		await assert.rejects(closeAuxiliaryWindow(window), /close request failed/);
		window.assertNoRequestListeners();
	});
});
