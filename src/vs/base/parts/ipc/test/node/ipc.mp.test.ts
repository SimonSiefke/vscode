/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../common/cancellation.js';
import { Emitter, Event } from '../../../../common/event.js';
import { URI } from '../../../../common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';
import { ChannelClient, ChannelServer } from '../../common/ipc.js';
import { createMessagePortProtocols } from './ipcTestUtils.js';

suite('MessagePort IPC', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let server: ChannelServer;
	let client: ChannelClient;

	setup(() => {
		const [serverProtocol, clientProtocol] = createMessagePortProtocols(store);
		server = store.add(new ChannelServer(serverProtocol, 'ctx'));
		client = store.add(new ChannelClient(clientProtocol));
	});

	test('round trips URI, VSBuffer, typed array views and cyclic aliases', async () => {
		server.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
		const bytes = Uint8Array.from([0, 97, 98, 99, 0]).subarray(1, 4);
		const buffer = VSBuffer.wrap(bytes);
		const input = { uri: URI.file('/folder/test file'), buffer, bytes, aliases: [buffer], cycle: {} as { self?: object } };
		input.cycle.self = input;

		const result = await client.getChannel('echo').call<typeof input>('echo', input);

		assert.deepStrictEqual({
			uri: URI.revive(result.uri).toString(),
			buffer: result.buffer.toString(),
			bytes: [...result.bytes],
			viewAlias: result.bytes.buffer === result.buffer.buffer.buffer && result.bytes.byteOffset === result.buffer.buffer.byteOffset,
			bufferAlias: result.aliases[0] === result.buffer,
			cycle: result.cycle.self === result,
			input: [...bytes]
		}, {
			uri: input.uri.toString(), buffer: 'abc', bytes: [97, 98, 99],
			viewAlias: true, bufferAlias: true, cycle: true, input: [97, 98, 99]
		});
	});

	test('propagates errors and cancellation across the port', async () => {
		const started = store.add(new Emitter<void>());
		const cancelled = store.add(new Emitter<void>());
		server.registerChannel('requests', {
			call: async <T>(_ctx: string, command: string, _arg: unknown, token: CancellationToken) => {
				if (command === 'error') {
					throw new Error('port error');
				}
				store.add(token.onCancellationRequested(() => cancelled.fire()));
				started.fire();
				await Event.toPromise(cancelled.event);
				return undefined as T;
			},
			listen: () => Event.None
		});
		const channel = client.getChannel('requests');
		await assert.rejects(channel.call('error'), /port error/);
		const source = store.add(new CancellationTokenSource());
		const didStart = Event.toPromise(started.event);
		const request = channel.call('cancel', undefined, source.token);
		// Attach the rejection handler before cancellation can reject the request.
		const rejection = assert.rejects(request, /Canceled/);
		await didStart;
		const didCancel = Event.toPromise(cancelled.event);
		source.cancel();
		await Promise.all([rejection, didCancel]);
	});

	test('disposes event subscriptions across the port', async () => {
		const emitter = store.add(new Emitter<VSBuffer>());
		server.registerChannel('events', {
			call: async <T>() => emitter.hasListeners() as T,
			listen: <T>() => emitter.event as Event<T>
		});
		const channel = client.getChannel('events');
		const received: string[] = [];
		const subscription = store.add(channel.listen<VSBuffer>('change')(value => received.push(value.toString())));
		assert.strictEqual(await channel.call('hasListeners'), true);
		emitter.fire(VSBuffer.fromString('event'));
		// Requests and events use the same ordered port.
		await channel.call('hasListeners');
		subscription.dispose();
		assert.deepStrictEqual({ received, listening: await channel.call('hasListeners') }, { received: ['event'], listening: false });
	});
});
