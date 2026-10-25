/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { getStructuredCloneMessage, IStructuredCloneMessage } from '../../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { RPCMessagePort } from '../../common/rpcMessagePort.js';

suite('RPCMessagePort', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const frame = (id: number, length = 0): IStructuredCloneMessage => ({ header: [1, id], body: 'x'.repeat(length) });

	test('sends the first frame immediately and coalesces the rest of a burst', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		const frames = [frame(1), frame(2), frame(3)];
		for (const message of frames) {
			port.sendStructuredClone(message);
		}
		assert.deepStrictEqual(sent, [frames[0]]);
		await Promise.resolve();
		assert.deepStrictEqual(sent, [frames[0], frames.slice(1)]);
	});

	test('receiving data keeps the next outgoing frame immediate', () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.sendStructuredClone(frame(1));
		port.acceptMessage(frame(2));
		port.sendStructuredClone(frame(3));
		assert.deepStrictEqual(sent, [frame(1), frame(3)]);
	});

	test('bounds bursts by frame count', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		for (let i = 0; i < 66; i++) {
			port.sendStructuredClone(frame(i));
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
			port.sendStructuredClone(message);
		}
		await Promise.resolve();
		assert.deepStrictEqual(sent, frames);
	});

	test('binary controls flush native frames and preserve startup buffering order', async () => {
		const packets: unknown[] = [];
		const sender = store.add(new RPCMessagePort(message => packets.push(message)));
		sender.sendStructuredClone(frame(1));
		sender.send(VSBuffer.fromByteArray([2]));
		sender.sendStructuredClone(frame(3));
		await Promise.resolve();
		const receiver = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		for (const packet of packets) {
			receiver.acceptMessage(packet);
		}
		const order: number[] = [];
		store.add(receiver.onMessage(buffer => {
			const native = getStructuredCloneMessage(buffer);
			order.push(native ? (native.header as number[])[1] : buffer.readUInt8(0));
		}));
		await Promise.resolve();
		assert.deepStrictEqual(order, [1, 2, 3]);
	});

	test('native receive stream preserves buffered frames and binary controls without wrappers', async () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		const frames = [frame(1), frame(3), frame(4)];
		port.acceptMessage(frames[0]);
		port.acceptMessage(new Uint8Array([2]));
		port.acceptMessage(frames.slice(1));
		const received: (VSBuffer | IStructuredCloneMessage)[] = [];
		store.add(port.onMessageWithStructuredClone(message => received.push(message)));
		await Promise.resolve();
		assert.deepStrictEqual(received.map(message => message instanceof VSBuffer ? message.readUInt8(0) : (message.header as number[])[1]), [1, 2, 3, 4]);
		assert.strictEqual(received[0], frames[0]);
	});

	test('disposal during a native receive batch stops remaining delivery', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		let received = 0;
		store.add(port.onMessageWithStructuredClone(() => {
			received++;
			port.dispose();
		}));
		port.acceptMessage([frame(1), frame(2)]);
		assert.strictEqual(received, 1);
	});

	test('drain flushes a queued frame immediately', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.sendStructuredClone(frame(0));
		port.sendStructuredClone(frame(1));
		assert.deepStrictEqual(sent, [frame(0)]);
		await port.drain();
		assert.deepStrictEqual(sent, [frame(0), frame(1)]);
	});

	test('disposal drops queued sends and later incoming frames', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		store.add(port.onMessage(() => assert.fail('unexpected incoming frame')));
		port.sendStructuredClone(frame(0));
		port.sendStructuredClone(frame(1));
		port.dispose();
		port.acceptMessage(frame(2));
		port.send(VSBuffer.fromByteArray([3]));
		port.sendStructuredClone(frame(4));
		await Promise.resolve();
		assert.deepStrictEqual(sent, [frame(0)]);
	});

	test('disposal during a batch stops delivery of remaining frames', () => {
		const port = store.add(new RPCMessagePort(() => assert.fail('unexpected send')));
		let received = 0;
		store.add(port.onMessage(() => {
			received++;
			port.dispose();
		}));
		port.acceptMessage([frame(1), frame(2)]);
		assert.strictEqual(received, 1);
	});
});
