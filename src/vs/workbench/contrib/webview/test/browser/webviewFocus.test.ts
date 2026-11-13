/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isSafari } from '../../../../../base/browser/browser.js';
import { addDisposableListener, isHTMLElement } from '../../../../../base/browser/dom.js';
import { parentOriginHash } from '../../../../../base/browser/iframe.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, raceTimeout } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

const preloadUrl = new URL(FileAccess.asBrowserUri('vs/workbench/contrib/webview/browser/pre/index.html').toString(true));

// The WebKit unit runner does not activate these frames from script-driven focus commands.
(preloadUrl.protocol === 'http:' && !isSafari ? suite : suite.skip)('Webview preload focus', function () {
	this.timeout(15_000);
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function receive<T>(target: EventTarget, predicate: (event: MessageEvent<T>) => boolean, action: () => void | Promise<void>): Promise<T> {
		const received = new DeferredPromise<T>();
		const listener = addDisposableListener(target, 'message', (event: MessageEvent<T>) => {
			if (predicate(event)) {
				received.complete(event.data);
			}
		});
		try {
			await action();
			const result = await raceTimeout(received.p, 5000);
			assert.ok(result, 'Timed out waiting for a webview notification');
			return result;
		} finally {
			listener.dispose();
		}
	}

	async function createWebview(crossOrigin = false) {
		const fixture = store.add(new DisposableStore());
		const previousFocus = mainWindow.document.activeElement;
		const outside = mainWindow.document.createElement('button');
		const frame = mainWindow.document.createElement('iframe');
		const focusOutside = () => {
			mainWindow.focus();
			outside.focus();
		};
		fixture.add(toDisposable(() => {
			focusOutside();
			frame.remove();
			outside.remove();
			if (isHTMLElement(previousFocus) && previousFocus.isConnected) {
				previousFocus.focus();
			}
		}));
		outside.textContent = 'Outside webview';
		mainWindow.document.body.appendChild(outside);
		focusOutside();
		frame.style.cssText = 'width: 400px; height: 300px;';
		frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

		const id = generateUuid();
		const shellUrl = new URL(preloadUrl);
		shellUrl.hostname = `${await parentOriginHash(mainWindow.origin, id)}.localhost`;
		shellUrl.search = new URLSearchParams({ id, origin: id, parentOrigin: mainWindow.origin, platform: 'browser', disableServiceWorker: 'true' }).toString();
		let port: MessagePort | undefined;
		await receive<{ channel: string }>(mainWindow, event => {
			if (event.source === frame.contentWindow && event.origin === shellUrl.origin && event.data.channel === 'webview-ready') {
				port = event.ports[0];
				return true;
			}
			return false;
		}, () => {
			frame.src = shellUrl.href;
			mainWindow.document.body.appendChild(frame);
		});
		assert.ok(port);
		const channel = port;
		fixture.add(toDisposable(() => channel.close()));
		channel.start();
		const notifications: string[] = [];
		fixture.add(addDisposableListener(channel, 'message', (event: MessageEvent<{ channel: string }>) => {
			if (event.data.channel === 'did-focus' || event.data.channel === 'did-blur') {
				notifications.push(event.data.channel);
			}
		}));

		let request = 0;
		let documentId = '';
		type Reply = { testId: string; documentId: string; request?: number; kind: string; hasFocus?: boolean };
		const send = (command: string, args: object) => channel.postMessage({ channel: command, args });
		const expectFocus = (focused: boolean, action: () => void | Promise<void>) => receive<{ channel: string }>(channel, event => event.data.channel === (focused ? 'did-focus' : 'did-blur'), action);
		const command = async (target: 'content' | 'nested' | 'fence') => {
			const current = ++request;
			const reply = await receive<Reply>(mainWindow, event => event.data?.testId === id && event.data.documentId === documentId && event.data.request === current, () => {
				send('message', { message: { target, request: current }, transfer: [] });
			});
			if (target !== 'fence') {
				assert.strictEqual(reply.hasFocus, true, `Expected ${target} focus; top-level document focus: ${mainWindow.document.hasFocus()}`);
			}
		};
		const setContent = async () => {
			documentId = generateUuid();
			const reply = `testId: ${JSON.stringify(id)}, documentId: ${JSON.stringify(documentId)}`;
			const nestedHtml = `<input id="nested"><script>addEventListener('message', event => { document.getElementById('nested').focus(); top.postMessage({ ${reply}, kind: 'complete', request: event.data.request, hasFocus: document.hasFocus() }, '*'); }); top.postMessage({ ${reply}, kind: 'ready' }, '*');</script>`;
			const nestedSource = crossOrigin
				? `src="data:text/html;base64,${btoa(nestedHtml)}"`
				: `srcdoc="${nestedHtml.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
			const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' data:;"></head><body><input id="content"><iframe id="child" ${nestedSource}></iframe><script>addEventListener('message', event => { if (event.data.target === 'nested') { document.getElementById('child').contentWindow.postMessage(event.data, '*'); } else { if (event.data.target === 'content') { document.getElementById('content').focus(); } top.postMessage({ ${reply}, kind: 'complete', request: event.data.request, hasFocus: document.hasFocus() }, '*'); } });</script></body></html>`;
			await receive<Reply>(mainWindow, event => event.data?.testId === id && event.data.documentId === documentId && event.data.kind === 'ready', async () => {
				await receive<{ channel: string }>(channel, event => event.data.channel === 'updated-intrinsic-content-size', () => {
					send('content', { contents: html, title: 'Focus test', options: { allowScripts: true, allowForms: true }, cspSource: shellUrl.origin, confirmBeforeClose: 'never' });
				});
			});
		};
		await setContent();
		return { focusOutside, notifications, command, expectFocus, setContent, send };
	}

	test('reports direct content focus and blur from the actual preload', async () => {
		const webview = await createWebview();
		await webview.expectFocus(true, () => webview.command('content'));
		await webview.expectFocus(false, webview.focusOutside);
		assert.deepStrictEqual(webview.notifications, ['did-focus', 'did-blur']);
	});

	for (const crossOrigin of [false, true]) {
		for (const directEntry of [false, true]) {
			test(`reports ${crossOrigin ? 'cross-origin' : 'same-origin'} nested frame focus and blur with ${directEntry ? 'direct' : 'content-first'} entry`, async () => {
				const webview = await createWebview(crossOrigin);
				if (!directEntry) {
					await webview.expectFocus(true, () => webview.command('content'));
				}
				const focusNested = () => webview.command('nested');
				if (directEntry) {
					await webview.expectFocus(true, focusNested);
				} else {
					await focusNested();
				}
				await webview.expectFocus(false, webview.focusOutside);
				assert.deepStrictEqual(webview.notifications, ['did-focus', 'did-blur']);
			});
		}
	}

	test('keeps virtual focus until a context menu closes', async () => {
		const webview = await createWebview();
		await webview.expectFocus(true, () => webview.command('content'));
		webview.send('set-context-menu-visible', { visible: true });
		await webview.command('fence');
		webview.focusOutside();
		await webview.command('fence');
		assert.deepStrictEqual(webview.notifications, ['did-focus']);
		await webview.expectFocus(false, () => webview.send('set-context-menu-visible', { visible: false }));
		assert.deepStrictEqual(webview.notifications, ['did-focus', 'did-blur']);
	});

	test('reports focus after replacing the content frame', async () => {
		const webview = await createWebview(true);
		await webview.expectFocus(true, () => webview.command('content'));
		await webview.expectFocus(false, webview.focusOutside);
		await webview.setContent();
		await webview.expectFocus(true, () => webview.command('nested'));
		await webview.expectFocus(false, webview.focusOutside);
		assert.deepStrictEqual(webview.notifications, ['did-focus', 'did-blur', 'did-focus', 'did-blur']);
	});
});
