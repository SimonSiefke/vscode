/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../common/event.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';
import { flushBatchedChannelProtocol, getBatchedChannelProtocol } from '../../common/ipc.batch.js';
import { IMessagePassingProtocol, IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from '../../common/ipc.js';
import { Client, MessageEvent, MessagePort } from '../../common/ipc.mp.js';

suite('Native channel batching', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const frame = (id: number, body: unknown = '{}'): IStructuredCloneMessage => ({ header: [100, id, 'echo', 'echo'], body });
	const flatten = (messages: readonly IStructuredCloneMessage[]) => messages.flatMap(message => message.batch ?? [message]);

	function createProtocol() {
		const incoming = store.add(new Emitter<IStructuredCloneMessage>());
		const sent: IStructuredCloneMessage[] = [];
		const raw: IStructuredCloneMessagePassingProtocol = { type: 'structuredClone', onMessage: incoming.event, send: message => sent.push(structuredClone(message)) };
		const protocol = getBatchedChannelProtocol(raw);
		if (protocol.type !== 'structuredClone') {
			throw new Error('Expected a native protocol');
		}
		return { raw, protocol, incoming, sent };
	}

	test('shares one adapter and leaves byte protocols unchanged', () => {
		const { raw, protocol } = createProtocol();
		assert.strictEqual(getBatchedChannelProtocol(raw), protocol);
		assert.strictEqual(getBatchedChannelProtocol(protocol), protocol);
		const bytes: IMessagePassingProtocol = { send: () => { }, onMessage: Event.None };
		assert.strictEqual(getBatchedChannelProtocol(bytes), bytes);
	});

	test('sends the first frame immediately and coalesces the rest of a burst', async () => {
		const { protocol, sent } = createProtocol();
		for (let id = 0; id < 32; id++) {
			protocol.send(frame(id));
		}
		assert.strictEqual(sent.length, 1);
		await Promise.resolve();
		assert.strictEqual(sent.length, 2);
		assert.strictEqual(sent[1].batch?.length, 31);
		assert.deepStrictEqual(flatten(sent).map(message => (message.header as number[])[1]), Array.from({ length: 32 }, (_, id) => id));
	});

	test('receiving data keeps the next send immediate and flushes preceding frames', async () => {
		const { protocol, incoming, sent } = createProtocol();
		store.add(protocol.onMessage(() => { }));
		protocol.send(frame(0));
		protocol.send(frame(1));
		incoming.fire({ header: [200], body: undefined });
		protocol.send(frame(2));
		assert.strictEqual(sent.length, 3);
		await Promise.resolve();
		assert.strictEqual(sent.length, 3);
	});

	test('bounds packet frame counts and keeps large DTOs pipelined', async () => {
		const { protocol, sent } = createProtocol();
		for (let id = 0; id < 160; id++) {
			protocol.send(frame(id));
		}
		await Promise.resolve();
		assert.strictEqual(flatten(sent).length, 160);
		assert.ok(sent.every(message => !message.batch || message.batch.length <= 64));
		sent.length = 0;
		for (let id = 0; id < 8; id++) {
			protocol.send(frame(id, 'x'.repeat(9000)));
		}
		await Promise.resolve();
		assert.strictEqual(sent.length, 8);
		assert.ok(sent.every(message => !message.batch));
	});

	test('flushes before native graphs and preserves their call-time snapshots', async () => {
		const { protocol, sent } = createProtocol();
		protocol.send(frame(0));
		protocol.send(frame(1));
		const bytes = new Uint8Array([97, 98]);
		protocol.send(frame(2, bytes));
		bytes[0] = 99;
		assert.strictEqual(sent.length, 3);
		assert.deepStrictEqual([...(sent[2].body as Uint8Array)], [97, 98]);
		const context = { name: 'original' };
		protocol.send(frame(3));
		protocol.send({ header: context, body: undefined });
		context.name = 'mutated';
		assert.deepStrictEqual(sent[4].header, { name: 'original' });
		await Promise.resolve();
		assert.strictEqual(sent.length, 5);
	});

	test('de-batches before fanout so both roles observe the same frame order', () => {
		const { protocol, incoming } = createProtocol();
		const seen: string[] = [];
		store.add(protocol.onMessage(message => seen.push(`client:${(message.header as number[])[1]}`)));
		store.add(protocol.onMessage(message => seen.push(`server:${(message.header as number[])[1]}`)));
		incoming.fire({ header: null, body: undefined, batch: [{ header: [100, 1], body: '{}' }, { header: [201, 2], body: '{}' }] });
		assert.deepStrictEqual(seen, ['client:1', 'server:1', 'client:2', 'server:2']);
	});

	test('attaches one raw listener lazily and releases it with the last observer', () => {
		const { protocol, incoming } = createProtocol();
		assert.strictEqual(incoming.hasListeners(), false);
		const first = store.add(protocol.onMessage(() => { }));
		const second = store.add(protocol.onMessage(() => { }));
		assert.strictEqual(incoming.hasListeners(), true);
		first.dispose();
		assert.strictEqual(incoming.hasListeners(), true);
		second.dispose();
		assert.strictEqual(incoming.hasListeners(), false);
	});

	test('retains a raw listener that synchronously delivers during subscription', () => {
		let attaches = 0;
		let detaches = 0;
		const raw: IStructuredCloneMessagePassingProtocol = {
			type: 'structuredClone', send: () => { },
			onMessage: listener => {
				attaches++;
				listener({ header: [200], body: undefined });
				return toDisposable(() => detaches++);
			}
		};
		const protocol = getBatchedChannelProtocol(raw);
		let received = 0;
		const subscription = store.add(protocol.onMessage(() => received++));
		assert.strictEqual(received, 1);
		assert.strictEqual(attaches, 1);
		assert.strictEqual(detaches, 0);
		subscription.dispose();
		assert.strictEqual(detaches, 1);
	});

	test('explicit flushing sends queued frames without duplicate microtask sends', async () => {
		const { raw, protocol, sent } = createProtocol();
		protocol.send(frame(0));
		protocol.send(frame(1));
		flushBatchedChannelProtocol(raw);
		assert.strictEqual(sent.length, 2);
		await Promise.resolve();
		assert.strictEqual(sent.length, 2);
	});

	test('a peer closing before a queued send does not throw from the microtask', async () => {
		let closed = false;
		let sent = 0;
		const raw: IStructuredCloneMessagePassingProtocol = {
			type: 'structuredClone', onMessage: Event.None,
			send: () => {
				if (closed) { throw new Error('Native peer closed'); }
				sent++;
			}
		};
		const protocol = getBatchedChannelProtocol(raw);
		if (protocol.type !== 'structuredClone') {
			throw new Error('Expected a native protocol');
		}
		protocol.send(frame(0));
		protocol.send(frame(1));
		closed = true;
		await Promise.resolve();
		assert.strictEqual(sent, 1);
	});

	test('MessagePort client flushes queued requests before closing its native port', async () => {
		const listeners = new Set<(this: MessagePort, event: MessageEvent) => unknown>();
		const sent: IStructuredCloneMessage[] = [];
		let closed = false;
		const port: MessagePort = {
			addEventListener: (_type, listener) => listeners.add(listener),
			removeEventListener: (_type, listener) => { listeners.delete(listener); },
			postMessage: message => { if (!closed) { sent.push(structuredClone(message)); } },
			start: () => { }, close: () => { closed = true; }
		};
		const client = store.add(new Client(port, 'test'));
		for (const listener of listeners) {
			listener.call(port, { data: { header: [200], body: undefined } });
		}
		const channel = client.getChannel('echo');
		const pending = Promise.allSettled([channel.call('first'), channel.call('second')]);
		client.dispose();
		assert.strictEqual(flatten(sent).filter(message => (message.header as number[])[0] === 100).length, 2);
		assert.strictEqual(listeners.size, 0);
		assert.ok((await pending).every(result => result.status === 'rejected'));
	});
});
