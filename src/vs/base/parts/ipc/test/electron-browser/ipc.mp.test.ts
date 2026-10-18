/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../browser/window.js';
import { VSBuffer } from '../../../../common/buffer.js';
import { Event } from '../../../../common/event.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { URI } from '../../../../common/uri.js';
import { ChannelClient, ChannelServer } from '../../common/ipc.js';
import { Protocol } from '../../common/ipc.mp.js';
import { Client as MessagePortClient } from '../../browser/ipc.mp.js';
import { acquirePort, MessagePortAcquisitionError } from '../../electron-browser/ipc.mp.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';

suite('IPC, MessagePorts', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('structured clone channel round trip over native MessagePorts', async () => {
		const { port1, port2 } = new MessageChannel();
		store.add(toDisposable(() => {
			port1.close();
			port2.close();
		}));
		const server = store.add(new ChannelServer(new Protocol(port1), 'ctx'));
		const client = store.add(new ChannelClient(new Protocol(port2)));
		server.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
		const buffer = VSBuffer.wrap(Uint8Array.from([0, 97, 98, 99, 0]).subarray(1, 4));
		const input = { uri: URI.file('/folder/test file'), buffer, map: new Map<object, object>(), set: new Set<object>() };
		input.map.set(input, buffer);
		input.set.add(input);
		input.set.add(buffer);

		const result = await client.getChannel('echo').call<typeof input>('echo', input);

		assert.deepStrictEqual({
			uri: URI.revive(result.uri).toString(),
			buffer: result.buffer.toString(),
			mapAlias: result.map.get(result) === result.buffer,
			setAlias: result.set.has(result) && result.set.has(result.buffer),
			input: buffer.toString()
		}, { uri: input.uri.toString(), buffer: 'abc', mapAlias: true, setAlias: true, input: 'abc' });
	});

	test('message port close event', async () => {
		const { port1, port2 } = new MessageChannel();

		const client1 = new MessagePortClient(port1, 'client1');
		const client2 = new MessagePortClient(port2, 'client2');

		// This test ensures that Electron's API for the close event
		// does not break because we rely on it to dispose client
		// connections from the server.
		//
		// This event is not provided by browser MessagePort API though.
		const whenClosed = new Promise<boolean>(resolve => port1.addEventListener('close', () => resolve(true)));

		client2.dispose();

		assert.ok(await whenClosed);

		client1.dispose();
	});

	test('message port acquisition reports structured errors', async () => {
		async function acquireError(nonce: string, fatal: boolean): Promise<{ message: string; fatal: boolean }> {
			const result = acquirePort(undefined, 'test:messagePortError', nonce, () => { });
			mainWindow.postMessage(null, '*');
			mainWindow.postMessage(42, '*');
			mainWindow.postMessage({ nonce, error: `failure-${fatal}`, fatal }, '*');
			try {
				await result;
				throw new Error('Expected acquirePort to reject.');
			} catch (error) {
				assert.ok(error instanceof MessagePortAcquisitionError);
				return { message: error.message, fatal: error.fatal };
			}
		}

		assert.deepStrictEqual({
			nonFatal: await acquireError('non-fatal', false),
			fatal: await acquireError('fatal', true),
		}, {
			nonFatal: { message: 'failure-false', fatal: false },
			fatal: { message: 'failure-true', fatal: true },
		});
	});

});
