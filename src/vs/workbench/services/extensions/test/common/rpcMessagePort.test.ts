/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IRPCMessage as IStructuredCloneMessage, RPCMessagePort } from '../../common/rpcMessagePort.js';

suite('RPCMessagePort', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const frame = (id: number, length = 0): IStructuredCloneMessage => ({ header: id, body: 'x'.repeat(length) });

	test('handshake listeners do not consume native frames before the RPC engine subscribes', async () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		const controls: number[] = [];
		store.add(port.onMessage(message => controls.push(message.readUInt8(0))));
		port.acceptMessage(new Uint8Array([1]));
		port.acceptMessage(frame(42));
		const received: IStructuredCloneMessage[] = [];
		store.add(port.onRPCMessage(message => received.push(message)));
		await Promise.resolve();
		assert.deepStrictEqual({ controls, received }, { controls: [1], received: [frame(42)] });
	});

	test('unbatched transport sends every frame immediately', () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message), false));
		port.sendRPCMessage(frame(1));
		port.sendRPCMessage(frame(2));
		assert.deepStrictEqual(sent, [frame(1), frame(2)]);
	});

	test('reentrant delivery cannot overtake the rest of a received batch', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		const received: number[] = [];
		store.add(port.onRPCMessage(message => {
			received.push(message.header);
			if (message.header === 1) {
				port.acceptMessage(frame(3));
			}
		}));
		port.acceptMessage([frame(1), frame(2)]);
		assert.deepStrictEqual(received, [1, 2, 3]);
	});

	test('sends the first frame immediately and coalesces the rest of a burst', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		const frames = [frame(1), frame(2), frame(3)];
		for (const message of frames) {
			port.sendRPCMessage(message);
		}
		assert.deepStrictEqual(sent, [frames[0]]);
		await Promise.resolve();
		assert.deepStrictEqual(sent, [frames[0], frames.slice(1)]);
	});

	test('receiving data keeps the next outgoing frame immediate', () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.sendRPCMessage(frame(1));
		port.acceptMessage(frame(2));
		port.sendRPCMessage(frame(3));
		assert.deepStrictEqual(sent, [frame(1), frame(3)]);
	});

	test('bounds bursts by frame count', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		for (let i = 0; i < 66; i++) {
			port.sendRPCMessage(frame(i));
		}
		await Promise.resolve();
		assert.strictEqual(sent.length, 3);
		assert.deepStrictEqual(sent[0], frame(0));
		assert.strictEqual((sent[1] as unknown[]).length, 64);
		assert.deepStrictEqual(sent[2], frame(65));
	});

	test('large DTOs remain pipelined in separate packets', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		const frames = [frame(1, 9000), frame(2, 9000), frame(3, 9000)];
		for (const message of frames) {
			port.sendRPCMessage(message);
		}
		await Promise.resolve();
		assert.deepStrictEqual(sent, frames);
	});

	test('binary controls flush native frames and preserve startup buffering order', async () => {
		const packets: unknown[] = [];
		const sender = store.add(new RPCMessagePort(message => packets.push(message)));
		sender.sendRPCMessage(frame(1));
		sender.sendRPCBuffer(VSBuffer.fromByteArray([2]));
		sender.sendRPCMessage(frame(3));
		await Promise.resolve();
		const receiver = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		for (const packet of packets) {
			receiver.acceptMessage(packet);
		}
		const order: number[] = [];
		store.add(receiver.onRPCMessage(buffer => {
			order.push(buffer.header === 0 ? (buffer.body as Uint8Array)[0] : buffer.header);
		}));
		await Promise.resolve();
		assert.deepStrictEqual(order, [1, 2, 3]);
	});

	test('native receive stream preserves buffered frames and binary codec envelopes', async () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		const frames = [frame(1), frame(3), frame(4)];
		port.acceptMessage(frames[0]);
		port.acceptMessage({ header: 0, body: new Uint8Array([2]) });
		port.acceptMessage(frames.slice(1));
		const received: (VSBuffer | IStructuredCloneMessage | readonly IStructuredCloneMessage[])[] = [];
		store.add(port.onRPCMessage(message => received.push(message)));
		await Promise.resolve();
		assert.strictEqual(received.length, 4);
		assert.strictEqual(received[0], frames[0]);
		assert.strictEqual((received[1] as IStructuredCloneMessage).header, 0);
		assert.deepStrictEqual(received.slice(2), frames.slice(1));
	});

	test('disposal during a native receive batch stops remaining delivery', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		let received = 0;
		store.add(port.onRPCMessage(() => {
			received++;
			port.dispose();
		}));
		port.acceptMessage([frame(1), frame(2)]);
		assert.strictEqual(received, 1);
	});

	test('a received native batch coalesces small replies without an immediate-send split', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.acceptMessage([frame(0), frame(1)]);
		port.sendRPCMessage(frame(2));
		port.sendRPCMessage(frame(3));
		assert.deepStrictEqual(sent, []);
		await Promise.resolve();
		assert.deepStrictEqual(sent, [[frame(2), frame(3)]]);
	});

	test('native listeners share the current frame when disposal stops the rest of a batch', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		const received: (VSBuffer | IStructuredCloneMessage)[][] = [[], []];
		store.add(port.onRPCMessage(message => {
			received[0].push(message);
			port.dispose();
		}));
		store.add(port.onRPCMessage(message => received[1].push(message)));
		port.acceptMessage([frame(1), frame(2)]);
		assert.deepStrictEqual(received.map(messages => messages.length), [1, 1]);
		assert.strictEqual(received[0][0], received[1][0]);
		assert.strictEqual((received[0][0] as IStructuredCloneMessage).header, 1);
	});

	test('drain flushes a queued frame immediately', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.sendRPCMessage(frame(0));
		port.sendRPCMessage(frame(1));
		assert.deepStrictEqual(sent, [frame(0)]);
		await port.drain();
		assert.deepStrictEqual(sent, [frame(0), frame(1)]);
	});

	test('disposal drops queued sends and later incoming frames', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		store.add(port.onRPCMessage(() => assert.fail('unexpected incoming frame')));
		port.sendRPCMessage(frame(0));
		port.sendRPCMessage(frame(1));
		port.dispose();
		port.acceptMessage(frame(2));
		port.send(VSBuffer.fromByteArray([3]));
		port.sendRPCMessage(frame(4));
		await Promise.resolve();
		assert.deepStrictEqual(sent, [frame(0)]);
	});

	test('disposal during a batch stops delivery of remaining frames', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		let received = 0;
		store.add(port.onRPCMessage(() => {
			received++;
			port.dispose();
		}));
		port.acceptMessage([frame(1), frame(2)]);
		assert.strictEqual(received, 1);
	});
});
