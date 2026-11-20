/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';
import { CONTEXT_MENU_CLOSE_CHANNEL } from '../../common/contextmenu.js';
import { popup } from '../../electron-browser/contextmenu.js';
import { ipcRenderer } from '../../../sandbox/electron-browser/globals.js';

suite('Native context menu popup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => sinon.restore());

	test('calls onHide once when dismissed without selecting an item', () => {
		type IpcEvent = Parameters<Parameters<typeof ipcRenderer.once>[1]>[0];
		let clickHandler: ((event: IpcEvent, ...args: unknown[]) => void) | undefined;
		let closeHandler: ((event: IpcEvent, ...args: unknown[]) => void) | undefined;
		const once = sinon.stub(ipcRenderer, 'once').callsFake((_channel, listener) => {
			clickHandler = listener;
			return ipcRenderer;
		});
		const on = sinon.stub(ipcRenderer, 'on').callsFake((_channel, listener) => {
			closeHandler = listener;
			return ipcRenderer;
		});
		const removeListener = sinon.stub(ipcRenderer, 'removeListener').returns(ipcRenderer);
		sinon.stub(ipcRenderer, 'send');
		const onHide = sinon.spy();

		popup([{ label: 'Action' }], undefined, onHide);
		assert.ok(clickHandler);
		assert.ok(closeHandler);
		clickHandler({} as IpcEvent, -1);

		assert.strictEqual(onHide.callCount, 1);
		assert.ok(removeListener.calledWith(CONTEXT_MENU_CLOSE_CHANNEL, closeHandler));
		assert.strictEqual(once.callCount, 1);
		assert.strictEqual(on.callCount, 1);
	});
});
