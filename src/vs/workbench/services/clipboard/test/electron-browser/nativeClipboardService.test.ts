/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { Protocol } from '../../../../../base/parts/ipc/common/ipc.electron.js';
import { ChannelClient, ChannelServer, ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { NativeClipboardService } from '../../electron-browser/clipboardService.js';

suite('NativeClipboardService structured clone IPC', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('copies file resources through production Electron protocol and ProxyChannel', async () => {
		const listeners = [new Set<(header: unknown, body: unknown) => void>(), new Set<(header: unknown, body: unknown) => void>()];
		const protocols = listeners.map((_listeners, index) => new Protocol({
			send: (_channel, ...args) => {
				const [header, body] = structuredClone(args);
				queueMicrotask(() => {
					for (const listener of listeners[1 - index]) {
						listener(header, body);
					}
				});
			}
		}, listener => {
			listeners[index].add(listener);
			return toDisposable(() => listeners[index].delete(listener));
		}));
		let clipboard = VSBuffer.alloc(0);
		const server = store.add(new ChannelServer(protocols[0], 'renderer'));
		server.registerChannel('nativeHost', ProxyChannel.fromService({
			writeClipboardBuffer: async (_format: string, value: VSBuffer) => {
				assert.ok(value instanceof VSBuffer);
				clipboard = value;
			},
			readClipboardBuffer: async () => clipboard,
			returnUri: async () => URI.file('/tmp/copied-file.txt'),
			inspectUri: async (uri: URI) => uri.with({ path: '/tmp/changed.txt' }).toString()
		}, store.add(new DisposableStore())));
		const client = store.add(new ChannelClient(protocols[1]));
		const nativeHost = ProxyChannel.toService<INativeHostService & { returnUri(): Promise<URI>; inspectUri(uri: URI): Promise<string> }>(client.getChannel('nativeHost'));
		const clipboardService = new NativeClipboardService(nativeHost, new NullLogService());
		const resources = [URI.file('/tmp/copied-file.txt'), URI.file('/tmp/second.txt')];
		await clipboardService.writeResources(resources);
		const returnedUri = await nativeHost.returnUri();
		assert.deepStrictEqual({
			resources: (await clipboardService.readResources()).map(uri => uri.toString()),
			argumentUri: await nativeHost.inspectUri(resources[0]),
			resultUri: returnedUri.with({ path: '/tmp/result.txt' }).toString()
		}, {
			resources: ['file:///tmp/copied-file.txt', 'file:///tmp/second.txt'],
			argumentUri: 'file:///tmp/changed.txt', resultUri: 'file:///tmp/result.txt'
		});
	});
});
