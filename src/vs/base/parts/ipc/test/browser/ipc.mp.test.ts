/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../common/buffer.js';
import { URI } from '../../../../common/uri.js';
import { CancellationToken } from '../../../../common/cancellation.js';
import { Event } from '../../../../common/event.js';
import { Client as MessagePortClient } from '../../browser/ipc.mp.js';
import { Protocol } from '../../common/ipc.mp.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';

suite('IPC, MessagePorts', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('ignores empty frames before dispatching structured clone messages', async () => {
		const { port1, port2 } = new MessageChannel();
		const protocol = new Protocol(port1);
		disposables.add(toDisposable(() => {
			protocol.disconnect();
			port2.close();
		}));
		const received: { header: unknown; body: unknown }[] = [];
		const delivered = new Promise<void>(resolve => {
			disposables.add(protocol.onMessage((header, body) => {
				received.push({ header, body });
				resolve();
			}));
		});

		port2.postMessage(null);
		port2.postMessage(undefined);
		port2.postMessage({ header: [200, 1], body: 'ready' });
		await delivered;

		assert.deepStrictEqual(received, [{ header: [200, 1], body: 'ready' }]);
	});

	test('real MessagePorts preserve native values in nested request and response payloads', async () => {
		const { port1, port2 } = new MessageChannel();
		const one = disposables.add(new MessagePortClient(port1, 'one'));
		const two = disposables.add(new MessagePortClient(port2, 'two'));
		one.registerChannel('values', {
			call: async (_context, _command, value) => {
				assert.ok(value.nested.uri instanceof URI && value.nested.bytes instanceof VSBuffer);
				return value;
			},
			listen: () => Event.None
		});
		const input = { uri: URI.file('/tmp/port.txt'), bytes: VSBuffer.wrap(Uint8Array.from([0, 1, 2, 3]).subarray(1, 3)) };
		const result = await two.getChannel('values').call<{ nested: typeof input }>('echo', { nested: input });
		assert.deepStrictEqual({ uri: result.nested.uri.with({ path: '/changed' }).toString(), bytes: [...result.nested.bytes.buffer] }, { uri: 'file:///changed', bytes: [1, 2] });
	});

	test('message passing', async () => {
		const { port1, port2 } = new MessageChannel();

		const client1 = new MessagePortClient(port1, 'client1');
		const client2 = new MessagePortClient(port2, 'client2');

		client1.registerChannel('client1', {
			call(_: unknown, command: string, arg: any, cancellationToken: CancellationToken): Promise<any> {
				switch (command) {
					case 'testMethodClient1': return Promise.resolve('success1');
					default: return Promise.reject(new Error('not implemented'));
				}
			},

			listen(_: unknown, event: string, arg?: any): Event<any> {
				switch (event) {
					default: throw new Error('not implemented');
				}
			}
		});

		client2.registerChannel('client2', {
			call(_: unknown, command: string, arg: any, cancellationToken: CancellationToken): Promise<any> {
				switch (command) {
					case 'testMethodClient2': return Promise.resolve('success2');
					default: return Promise.reject(new Error('not implemented'));
				}
			},

			listen(_: unknown, event: string, arg?: any): Event<any> {
				switch (event) {
					default: throw new Error('not implemented');
				}
			}
		});

		const channelClient1 = client2.getChannel('client1');
		assert.strictEqual(await channelClient1.call('testMethodClient1'), 'success1');

		const channelClient2 = client1.getChannel('client2');
		assert.strictEqual(await channelClient2.call('testMethodClient2'), 'success2');

		client1.dispose();
		client2.dispose();
	});

});
