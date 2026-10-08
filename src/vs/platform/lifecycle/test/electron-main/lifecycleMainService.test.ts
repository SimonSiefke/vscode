/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import electron from 'electron';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { InMemoryTestStateMainService } from '../../../test/electron-main/workbenchTestServices.js';
import { ICodeWindow, UnloadReason } from '../../../window/electron-main/window.js';
import { LifecycleMainService } from '../../electron-main/lifecycleMainService.js';

interface UnloadRequest {
	readonly okChannel?: string;
	readonly cancelChannel?: string;
	readonly replyChannel?: string;
	readonly reason: UnloadReason;
}

suite('LifecycleMainService - renderer unload', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createWindow() {
		let closed = false;
		let disposed = false;
		const didClose = store.add(new Emitter<void>());
		const nativeEvents = new EventEmitter();
		const nativeWindow = upcastPartial<electron.BrowserWindow>({
			isDestroyed: () => closed,
			on: sinon.stub().callsFake((name: string, listener: () => void) => {
				nativeEvents.on(name, listener);
				return nativeWindow;
			}),
			removeListener: sinon.stub().callsFake((name: string, listener: () => void) => {
				nativeEvents.removeListener(name, listener);
				return nativeWindow;
			})
		});
		const send = sinon.spy();
		const close = sinon.spy();
		const reload = sinon.spy();
		const window = upcastPartial<ICodeWindow>({
			id: 1,
			isReady: true,
			get win() { return disposed ? null : nativeWindow; },
			onDidClose: didClose.event,
			onWillLoad: Event.None,
			send,
			close,
			reload
		});
		const service = store.add(new LifecycleMainService(
			store.add(new NullLogService()),
			new InMemoryTestStateMainService(),
			upcastPartial<IEnvironmentMainService>({ args: { _: [] } })
		));
		const closeNativeWindow = () => {
			if (!closed) {
				closed = true;
				didClose.fire();
				disposed = true;
				nativeEvents.emit('closed');
			}
		};
		const request = (index: number) => {
			const call = send.getCall(index);
			assert.ok(call, `Missing renderer request ${index}`);
			return call.args[1] as UnloadRequest;
		};
		const reply = (index: number, key: 'okChannel' | 'cancelChannel' | 'replyChannel') => {
			const channel = request(index)[key];
			assert.ok(channel);
			electron.ipcMain.emit(channel, { senderFrame: { url: 'about:blank' } });
		};
		const pendingChannels = () => send.getCalls().flatMap(call => {
			const { okChannel, cancelChannel, replyChannel } = call.args[1] as UnloadRequest;
			return [okChannel, cancelChannel, replyChannel].filter((channel): channel is string => !!channel && electron.ipcMain.listenerCount(channel) > 0);
		});
		return { window, service, send, close, reload, nativeEvents, closeNativeWindow, request, reply, pendingChannels };
	}

	async function withWindow(run: (fixture: ReturnType<typeof createWindow>) => Promise<void>): Promise<void> {
		const fixture = createWindow();
		try {
			await run(fixture);
		} finally {
			fixture.closeNativeWindow();
			// Complete only this fixture's channels, including on the unfixed source,
			// so intentional red assertions cannot contaminate the following test.
			for (let attempt = 0; attempt < 3; attempt++) {
				for (let index = 0; index < fixture.send.callCount; index++) {
					const request = fixture.request(index);
					if (request.okChannel) {
						fixture.reply(index, 'okChannel');
					} else if (request.replyChannel) {
						fixture.reply(index, 'replyChannel');
					}
				}
				await timeout(0);
			}
		}
	}

	test('normal replies finish both stages and remove IPC listeners', () => withWindow(async ({ window, service, send, reply, pendingChannels }) => {
		const unload = service.unload(window, UnloadReason.CLOSE);
		reply(0, 'okChannel');
		await timeout(0);
		reply(1, 'replyChannel');
		assert.deepStrictEqual({ veto: await unload, requests: send.callCount, pending: pendingChannels() }, { veto: false, requests: 2, pending: [] });
	}));

	test('a window that is not ready does not start renderer requests', () => withWindow(async ({ window, service, send }) => {
		const notReadyWindow = upcastPartial<ICodeWindow>({ id: window.id, win: window.win, isReady: false });
		assert.deepStrictEqual({ veto: await service.unload(notReadyWindow, UnloadReason.CLOSE), requests: send.callCount }, { veto: false, requests: 0 });
	}));

	test('renderer veto removes both listeners and does not start will-unload', () => withWindow(async ({ window, service, send, reply, pendingChannels }) => {
		const unload = service.unload(window, UnloadReason.CLOSE);
		reply(0, 'cancelChannel');
		assert.deepStrictEqual({ veto: await unload, requests: send.callCount, pending: pendingChannels() }, { veto: true, requests: 1, pending: [] });
	}));

	test('closing during before-unload settles the request without starting will-unload', () => withWindow(async ({ window, service, send, closeNativeWindow, pendingChannels }) => {
		let veto: boolean | undefined;
		service.unload(window, UnloadReason.CLOSE).then(value => veto = value);
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ veto, requests: send.callCount, pending: pendingChannels() }, { veto: false, requests: 1, pending: [] });
	}));

	test('closing during will-unload settles the request and removes its listener', () => withWindow(async ({ window, service, send, reply, closeNativeWindow, pendingChannels }) => {
		let veto: boolean | undefined;
		service.unload(window, UnloadReason.CLOSE).then(value => veto = value);
		reply(0, 'okChannel');
		await timeout(0);
		assert.strictEqual(send.callCount, 2);
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ veto, requests: send.callCount, pending: pendingChannels() }, { veto: false, requests: 2, pending: [] });
	}));

	test('closing between the reply stages does not send to the closed renderer', () => withWindow(async ({ window, service, send, reply, closeNativeWindow, pendingChannels }) => {
		let veto: boolean | undefined;
		service.unload(window, UnloadReason.CLOSE).then(value => veto = value);
		reply(0, 'okChannel');
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ veto, requests: send.callCount, pending: pendingChannels() }, { veto: false, requests: 1, pending: [] });
	}));

	test('concurrent unloads share one request and release it after closure', () => withWindow(async ({ window, service, send, closeNativeWindow, pendingChannels }) => {
		const first = service.unload(window, UnloadReason.CLOSE);
		assert.strictEqual(service.unload(window, UnloadReason.RELOAD), first);
		let veto: boolean | undefined;
		first.then(value => veto = value);
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ veto, requests: send.callCount, pending: pendingChannels() }, { veto: false, requests: 1, pending: [] });
		const next = service.unload(window, UnloadReason.CLOSE);
		assert.notStrictEqual(next, first);
		assert.strictEqual(await next, false);
		assert.strictEqual(send.callCount, 1);
	}));

	test('a closed window does not start an unload or reload', () => withWindow(async ({ window, service, send, reload, closeNativeWindow }) => {
		closeNativeWindow();
		let settled = false;
		service.reload(window).then(() => settled = true);
		await timeout(0);
		assert.deepStrictEqual({ settled, requests: send.callCount, reloads: reload.callCount }, { settled: true, requests: 0, reloads: 0 });
	}));

	test('a reload interrupted by closure does not reload the disposed window', () => withWindow(async ({ window, service, reload, closeNativeWindow, pendingChannels }) => {
		let settled = false;
		service.reload(window).then(() => settled = true);
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ settled, reloads: reload.callCount, pending: pendingChannels() }, { settled: true, reloads: 0, pending: [] });
	}));

	test('normal reload still reaches the live window', () => withWindow(async ({ window, service, reload, reply }) => {
		const result = service.reload(window);
		reply(0, 'okChannel');
		await timeout(0);
		reply(1, 'replyChannel');
		await result;
		assert.strictEqual(reload.callCount, 1);
	}));

	test('an interrupted native close does not enqueue another close or notification', () => withWindow(async ({ window, service, close, nativeEvents, closeNativeWindow, pendingChannels }) => {
		const beforeClose = sinon.spy();
		store.add(service.onBeforeCloseWindow(beforeClose));
		service.registerWindow(window);
		const preventDefault = sinon.spy();
		nativeEvents.emit('close', { preventDefault });
		assert.strictEqual(preventDefault.callCount, 1);
		closeNativeWindow();
		await timeout(0);
		assert.deepStrictEqual({ closes: close.callCount, notifications: beforeClose.callCount, pending: pendingChannels() }, { closes: 0, notifications: 0, pending: [] });
	}));

	test('normal native close still notifies and closes the live window', () => withWindow(async ({ window, service, close, nativeEvents, reply, pendingChannels }) => {
		const beforeClose = sinon.spy();
		store.add(service.onBeforeCloseWindow(beforeClose));
		service.registerWindow(window);
		nativeEvents.emit('close', { preventDefault: sinon.spy() });
		reply(0, 'okChannel');
		await timeout(0);
		reply(1, 'replyChannel');
		await timeout(0);
		assert.deepStrictEqual({ closes: close.callCount, notifications: beforeClose.callCount, pending: pendingChannels() }, { closes: 1, notifications: 1, pending: [] });
	}));
});
