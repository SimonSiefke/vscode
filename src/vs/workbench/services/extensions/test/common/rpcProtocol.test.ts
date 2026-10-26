/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { errorHandler } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { getStructuredCloneMessage, IMessagePassingProtocol, IStructuredCloneMessage, wrapStructuredCloneMessage } from '../../../../../base/parts/ipc/common/ipc.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ProxyIdentifier, SerializableObjectWithBuffers } from '../../common/proxyIdentifier.js';
import { RPCMessagePort } from '../../common/rpcMessagePort.js';
import { RPCProtocol } from '../../common/rpcProtocol.js';

type ObservedRepliesService = {
	$echo(value: unknown): unknown;
	$fail(): number;
	$hold(): Promise<number>;
};
const observedRepliesIdentifier = new ProxyIdentifier<ObservedRepliesService>('observedReplies', undefined, ['$echo', '$fail', '$hold']);

['binary', 'native JSON', 'batched JSON', 'batched native receive'].forEach(mode => suite(`RPCProtocol (${mode})`, () => {
	const native = mode !== 'binary';
	const timerOptions = { toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldClearNativeTimers: true };

	let disposables: DisposableStore;

	class MessagePassingProtocol implements IMessagePassingProtocol {
		private _pair?: MessagePassingProtocol;
		private readonly bufferedPort?: RPCMessagePort;

		private readonly _onMessage = new Emitter<VSBuffer>();
		public readonly onMessage: Event<VSBuffer> = this._onMessage.event;

		public readonly sendStructuredClone?: (message: IStructuredCloneMessage) => void;
		public readonly onMessageWithStructuredClone?: Event<VSBuffer | IStructuredCloneMessage | readonly IStructuredCloneMessage[]>;

		constructor(private readonly onSend?: (buffer: VSBuffer) => void) {
			if (mode === 'batched JSON' || mode === 'batched native receive') {
				this.bufferedPort = disposables.add(new RPCMessagePort(data => {
					if (ArrayBuffer.isView(data)) {
						this.onSend?.(VSBuffer.wrap(data as Uint8Array));
					} else {
						for (const message of Array.isArray(data) ? data : [data]) {
							this.onSend?.(wrapStructuredCloneMessage(message));
						}
					}
					Promise.resolve().then(() => this._pair!.bufferedPort!.acceptMessage(data));
				}));
				this.onMessage = this.bufferedPort.onMessage;
				if (mode === 'batched native receive') {
					this.onMessageWithStructuredClone = this.bufferedPort.onMessageWithStructuredClone;
				}
				this.sendStructuredClone = message => this.bufferedPort!.sendStructuredClone(message);
			} else if (native) {
				this.sendStructuredClone = message => this.send(wrapStructuredCloneMessage(structuredClone(message)));
			}
		}

		public setPair(other: MessagePassingProtocol) {
			this._pair = other;
		}

		public send(buffer: VSBuffer): void {
			if (this.bufferedPort) {
				this.bufferedPort.send(buffer);
				return;
			}
			this.onSend?.(buffer);
			Promise.resolve().then(() => {
				this._pair!._onMessage.fire(buffer);
			});
		}
	}

	let delegate: (a1: any, a2: any) => any;
	let bProxy: BClass;
	let bProtocol: RPCProtocol;
	class BClass {
		$m(a1: any, a2: any): Promise<any> {
			return Promise.resolve(delegate.call(null, a1, a2));
		}
	}

	// Production actors have stable IDs; avoid exhausting the byte protocol's one-byte ID range.
	const bIdentifier = new ProxyIdentifier<BClass>('bb');
	type NotificationTestService = { $notify: (value?: unknown, token?: CancellationToken) => void; $state: () => unknown };
	const notificationIdentifier = new ProxyIdentifier<NotificationTestService>('notifications', ['$notify']);

	setup(() => {
		disposables = new DisposableStore();

		const a_protocol = new MessagePassingProtocol();
		const b_protocol = new MessagePassingProtocol();
		a_protocol.setPair(b_protocol);
		b_protocol.setPair(a_protocol);

		const A = disposables.add(new RPCProtocol(a_protocol));
		bProtocol = disposables.add(new RPCProtocol(b_protocol));

		const bInstance = new BClass();
		bProtocol.set(bIdentifier, bInstance);
		bProxy = A.getProxy(bIdentifier);
	});

	teardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	/** Use the same transport modes for observed promises and the legacy mixed fallback. */
	function createAuditedPromiseRPC(echo: (value: unknown) => unknown = value => value, sent?: VSBuffer[], runInBatch?: (callback: () => void) => void) {
		const one = new MessagePassingProtocol(message => sent?.push(message));
		const two = new MessagePassingProtocol();
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two, null, null, runInBatch));
		server.set(observedRepliesIdentifier, {
			$echo: echo,
			$fail: () => { throw new Error('observed failure'); },
			$hold: () => new Promise<number>(() => { })
		});
		return { client, server, proxy: client.getProxy(observedRepliesIdentifier) };
	}


	test('native batch context excludes sequential singletons and binary frames', async () => {
		let batches = 0;
		const { proxy } = createAuditedPromiseRPC(value => value, undefined, callback => {
			batches++;
			callback();
		});
		const first = await proxy.$echo(1);
		const second = await proxy.$echo(2);
		const buffer = await proxy.$echo(VSBuffer.fromByteArray([0, 1, 255]));
		assert.ok(buffer instanceof VSBuffer);
		assert.deepStrictEqual({ first, second, bytes: [...buffer.buffer], batches }, {
			first: 1, second: 2, bytes: [0, 1, 255], batches: 0
		});
	});

	if (mode === 'batched native receive') {
		test('short command bursts avoid context buffering while larger bursts retain it', async () => {
			const observations = [];
			for (const count of [3, 4]) {
				let depth = 0;
				let batches = 0;
				const seen: [unknown, number][] = [];
				const { proxy } = createAuditedPromiseRPC(value => {
					seen.push([value, depth]);
					return value;
				}, undefined, callback => {
					batches++;
					depth++;
					try {
						callback();
					} finally {
						depth--;
					}
				});
				const results = await Promise.all(Array.from({ length: count }, (_, value) => proxy.$echo(value)));
				observations.push({ count, seen, results, batches, depth });
			}
			assert.deepStrictEqual(observations, [
				{ count: 3, seen: [[0, 0], [1, 0], [2, 0]], results: [0, 1, 2], batches: 0, depth: 0 },
				{ count: 4, seen: [[0, 0], [1, 1], [2, 1], [3, 1]], results: [0, 1, 2, 3], batches: 1, depth: 0 }
			]);
		});

		test('native batch context covers synchronous invocation and ends before async continuation', async () => {
			let depth = 0;
			let batches = 0;
			const before: [unknown, number][] = [];
			const after: [unknown, number][] = [];
			const { proxy } = createAuditedPromiseRPC(async value => {
				before.push([value, depth]);
				await Promise.resolve();
				after.push([value, depth]);
				if (value === 1) {
					throw new Error('expected batch rejection');
				}
				return value;
			}, undefined, callback => {
				batches++;
				depth++;
				try {
					callback();
				} finally {
					depth--;
				}
			});
			const values = Array.from({ length: 32 }, (_, index) => index);
			const results = await Promise.allSettled(values.map(value => proxy.$echo(value)));
			assert.deepStrictEqual({
				before, after, batches, depth,
				results: results.map(result => result.status === 'fulfilled' ? result.value : result.reason instanceof Error ? result.reason.message : String(result.reason))
			}, {
				before: values.map(value => [value, value === 0 ? 0 : 1]),
				after: values.map(value => [value, 0]),
				batches: 1, depth: 0,
				results: values.map(value => value === 1 ? 'expected batch rejection' : value)
			});
		});

		test('disposing an actor protocol within a native batch unwinds its context', async () => {
			let depth = 0;
			let batches = 0;
			const seen: unknown[] = [];
			const rpc = createAuditedPromiseRPC(value => {
				seen.push(value);
				if (value === 1) {
					rpc.server.dispose();
				}
				return value;
			}, undefined, callback => {
				batches++;
				depth++;
				try {
					callback();
				} finally {
					depth--;
				}
			});
			const replies = Promise.allSettled(Array.from({ length: 32 }, (_, value) => rpc.proxy.$echo(value)));
			await new Promise<void>(resolve => setTimeout(resolve, 0));
			rpc.client.dispose();
			await replies;
			assert.deepStrictEqual({ seen, batches, depth }, { seen: [0, 1], batches: 1, depth: 0 });
		});
	}

	test('audited observed methods return native promises only on native JSON requests', async () => {
		const { proxy } = createAuditedPromiseRPC();
		const reply = proxy.$echo(7);
		assert.strictEqual(reply instanceof Promise, native);
		assert.strictEqual(await reply, 7);
	});

	test('observed methods preserve the lazy mixed-buffer fallback and exact bytes', async () => {
		const { proxy } = createAuditedPromiseRPC();
		const reply = proxy.$echo(VSBuffer.fromByteArray([0, 1, 127, 255]));
		assert.strictEqual(reply instanceof Promise, false);
		const value = await reply;
		assert.ok(value instanceof VSBuffer);
		assert.deepStrictEqual([...value.buffer], [0, 1, 127, 255]);
	});

	test('observed method rejections remain catchable', async () => {
		const { proxy } = createAuditedPromiseRPC();
		await assert.rejects(proxy.$fail(), /observed failure/);
	});

	test('disposal rejects an already-observed native reply', async () => {
		const { client, proxy } = createAuditedPromiseRPC();
		const rejection = assert.rejects(proxy.$hold(), /Canceled/);
		client.dispose();
		await rejection;
	});

	test('single scalar request bodies preserve argument normalization and object fallback', async () => {
		const sent: VSBuffer[] = [];
		const { proxy } = createAuditedPromiseRPC(value => ({ kind: typeof value, value, negativeZero: Object.is(value, -0) }), sent);
		const text = String.fromCharCode(0, 0xd800, 0xdc00, 0xd800, 34, 92) + '😊';
		const cases = [
			{ value: undefined, expected: { kind: 'undefined', negativeZero: false }, scalar: true },
			{ value: null, expected: { kind: 'object', value: null, negativeZero: false }, scalar: true },
			{ value: true, expected: { kind: 'boolean', value: true, negativeZero: false }, scalar: true },
			{ value: false, expected: { kind: 'boolean', value: false, negativeZero: false }, scalar: true },
			{ value: 42, expected: { kind: 'number', value: 42, negativeZero: false }, scalar: true },
			{ value: -0, expected: { kind: 'number', value: 0, negativeZero: false }, scalar: true },
			{ value: NaN, expected: { kind: 'object', value: null, negativeZero: false }, scalar: true },
			{ value: Infinity, expected: { kind: 'object', value: null, negativeZero: false }, scalar: true },
			{ value: -Infinity, expected: { kind: 'object', value: null, negativeZero: false }, scalar: true },
			{ value: '', expected: { kind: 'string', value: '', negativeZero: false }, scalar: true },
			{ value: text, expected: { kind: 'string', value: text, negativeZero: false }, scalar: true },
			{ value: text.repeat(4096), expected: { kind: 'string', value: text.repeat(4096), negativeZero: false }, scalar: true },
			{ value: { toJSON: () => 'object fallback' }, expected: { kind: 'string', value: 'object fallback', negativeZero: false }, scalar: false },
			{ value: { toJSON: () => undefined }, expected: { kind: 'object', value: null, negativeZero: false }, scalar: false }
		];
		for (const item of cases) {
			sent.length = 0;
			assert.deepStrictEqual(await proxy.$echo(item.value), item.expected);
			if (native) {
				assert.strictEqual(messageType(sent[0]), item.scalar ? 15 : 1);
			}
		}
	});

	test('simple call', function (done) {
		delegate = (a1: number, a2: number) => a1 + a2;
		bProxy.$m(4, 1).then((res: number) => {
			assert.strictEqual(res, 5);
			done(null);
		}, done);
	});

	test('native optional arguments preserve undefined masks at every boundary', async () => {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol(message => sent.push(message));
		const two = new MessagePassingProtocol();
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		const service = {
			$inspect: (...args: unknown[]) => ({
				length: args.length,
				undefinedAt: args.flatMap((value, index) => value === undefined ? [index] : []),
				nullAt: args.flatMap((value, index) => value === null ? [index] : [])
			})
		};
		const identifier = new ProxyIdentifier<typeof service>('optionalArguments');
		server.set(identifier, service);
		const proxy = client.getProxy(identifier);
		for (const length of [1, 2, 13, 31, 32, 33, 64]) {
			for (const position of new Set([0, Math.floor(length / 2), length - 1])) {
				const args: unknown[] = Array.from({ length }, (_, index) => index % 3 ? index : null);
				args[position] = undefined;
				sent.length = 0;
				assert.deepStrictEqual(await proxy.$inspect(...args), service.$inspect(...args));
				const frame = getStructuredCloneMessage(sent[0]);
				if (native && length === 1) {
					assert.ok(frame);
					assert.deepStrictEqual({ type: messageType(sent[0]), body: frame.body, undefinedMask: Reflect.get(frame, 'undefinedMask') }, { type: 15, body: undefined, undefinedMask: undefined });
				} else if (native && length <= 32) {
					assert.ok(frame);
					assert.strictEqual(Reflect.get(frame, 'undefinedMask') ?? (frame.header as number[])[4], 1 << position);
				} else {
					assert.strictEqual(frame, undefined);
				}
			}
		}
		assert.deepStrictEqual(await proxy.$inspect(...Array(32).fill(undefined)), { length: 32, undefinedAt: Array.from({ length: 32 }, (_, index) => index), nullAt: [] });
	});

	test('optional native argument payloads retain snapshots and JSON omission semantics', async () => {
		let received: unknown;
		const { proxy } = createNotificationRPC({ $notify: value => { received = value; }, $state: () => received });
		await proxy.$state();
		const payload = { label: 'before', optional: undefined, nested: [undefined, null] };
		proxy.$notify(payload, undefined);
		payload.label = 'after';
		assert.deepStrictEqual(await proxy.$state(), { label: 'before', nested: [null, null] });
	});

	test('notifications with undefined arguments deliver every update without replies', async () => {
		let count = 0;
		let undefinedCount = 0;
		const { proxy, sent } = createNotificationRPC({ $notify: value => { count++; undefinedCount += value === undefined ? 1 : 0; }, $state: () => ({ count, undefinedCount }) });
		await proxy.$state();
		sent.length = 0;
		for (let index = 0; index < 64; index++) {
			proxy.$notify(undefined);
		}
		assert.deepStrictEqual(await proxy.$state(), { count: 64, undefinedCount: 64 });
		assert.strictEqual(sent.filter(message => messageType(message) === 13).length, native ? 64 : 0);
	});

	test('optional native arguments preserve cancellation-token delivery', async () => {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol(message => sent.push(message));
		const two = new MessagePassingProtocol();
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		let enter!: () => void;
		const entered = new Promise<void>(resolve => enter = resolve);
		const service = {
			$wait: (optional: unknown, token: CancellationToken) => new Promise<boolean>(resolve => {
				const listener = token.onCancellationRequested(() => {
					listener.dispose();
					resolve(optional === undefined && token.isCancellationRequested);
				});
				enter();
			})
		};
		const identifier = new ProxyIdentifier<typeof service>('optionalCancellation');
		server.set(identifier, service);
		const source = disposables.add(new CancellationTokenSource());
		const result = client.getProxy(identifier).$wait(undefined, source.token);
		await entered;
		if (native) {
			assert.strictEqual(messageType(sent[0]), 16);
		}
		source.cancel();
		assert.strictEqual(await result, true);
	});

	test('native IPC messages own tightly sized backing buffers', async () => {
		const sent: { length: number; backingLength: number }[] = [];
		const record = (buffer: VSBuffer) => sent.push({ length: buffer.byteLength, backingLength: buffer.buffer.buffer.byteLength });
		const one = new MessagePassingProtocol(record);
		const two = new MessagePassingProtocol(record);
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		const service = { $echo: async (value: string) => value };
		const identifier = new ProxyIdentifier<typeof service>('tightlySized');
		server.set(identifier, service);

		const reply = await client.getProxy(identifier).$echo('small RPC payload');

		assert.deepStrictEqual({ reply, tightlySized: sent.length > 0 && sent.every(message => message.length === message.backingLength) }, {
			reply: 'small RPC payload', tightlySized: true
		});
	});

	function createObservedRPC(service: { $call: () => unknown }) {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol(buffer => sent.push(buffer));
		const two = new MessagePassingProtocol(buffer => sent.push(buffer));
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		const identifier = new ProxyIdentifier<typeof service>('acknowledgements');
		server.set(identifier, service);
		return { client, proxy: client.getProxy(identifier), sent, two };
	}

	test('immediate replies acknowledge requests without a separate message', async () => {
		const { client, proxy, sent } = createObservedRPC({ $call: () => 42 });
		assert.strictEqual(await proxy.$call(), 42);
		assert.strictEqual(sent.length, 2);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	test('immediate errors acknowledge requests without a separate message', async () => {
		const { client, proxy, sent } = createObservedRPC({ $call: () => { throw new Error('expected failure'); } });
		await assert.rejects(proxy.$call(), /expected failure/);
		assert.strictEqual(sent.length, 2);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	for (const fail of [false, true]) {
		test(`short async ${fail ? 'errors' : 'replies'} acknowledge without a separate message`, async () => {
			const { client, proxy, sent } = createObservedRPC({
				$call: async () => {
					await Promise.resolve();
					await Promise.resolve();
					if (fail) {
						throw new Error('short async failure');
					}
					return 42;
				}
			});
			if (fail) {
				await assert.rejects(proxy.$call(), /short async failure/);
			} else {
				assert.strictEqual(await proxy.$call(), 42);
			}
			assert.strictEqual(sent.length, 2);
			assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		});
	}

	test('pending handlers acknowledge before their result is available', async () => {
		let resolve!: (value: number) => void;
		const result = new Promise<number>(r => resolve = r);
		const { client, proxy, sent } = createObservedRPC({ $call: () => result });
		const reply = proxy.$call();
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(sent.length, 2);
		const acknowledgement = getStructuredCloneMessage(sent[1]);
		assert.strictEqual(!!acknowledgement, native);
		assert.strictEqual(messageType(sent[1]), 5); // Acknowledged
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		resolve(42);
		assert.strictEqual(await reply, 42);
		assert.strictEqual(sent.length, 3);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	test('pending handler errors settle after their acknowledgement', async () => {
		let reject!: (error: Error) => void;
		const result = new Promise<number>((_resolve, r) => { reject = r; });
		const { client, proxy, sent } = createObservedRPC({ $call: () => result });
		const reply = assert.rejects(proxy.$call(), /pending failure/);
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(sent.length, 2);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		reject(new Error('pending failure'));
		await reply;
		assert.strictEqual(sent.length, 3);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	if (native) {
		test('compact native headers preserve request IDs above the 27-bit boundary', async () => {
			const { client, proxy, sent } = createObservedRPC({ $call: () => 42 });
			Reflect.set(client, '_lastMessageId', 0xfffffffe);
			assert.strictEqual(await proxy.$call(), 42);
			const request = getStructuredCloneMessage(sent[0])!;
			const reply = getStructuredCloneMessage(sent[1])!;
			assert.deepStrictEqual({ requestHeader: request.header, requestBody: request.body, replyHeader: reply.header, replyBody: reply.body }, {
				requestHeader: 0xffffffff * 32 + 1,
				requestBody: '[]',
				replyHeader: 0xffffffff * 32 + 14,
				replyBody: 42
			});
		});
	}

	test('late and duplicate acknowledgements do not corrupt responsiveness accounting', async () => {
		const { client, proxy, sent, two } = createObservedRPC({ $call: () => 42 });
		assert.strictEqual(await proxy.$call(), 42);
		const ack = VSBuffer.alloc(5);
		ack.writeUInt8(5, 0); // Acknowledged
		const first = getStructuredCloneMessage(sent[0]);
		ack.writeUInt32BE(first ? typeof first.header === 'number' ? Math.floor(first.header / 32) : (first.header as number[])[1] : sent[0].readUInt32BE(1), 1);
		two.send(ack);
		two.send(ack);
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		assert.strictEqual(await proxy.$call(), 42);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	test('short calls reuse a responsiveness check until it expires', async () => {
		const clock = sinon.useFakeTimers(timerOptions);
		try {
			const { client, proxy } = createObservedRPC({ $call: () => 42 });
			const schedule = sinon.spy(Reflect.get(client, '_asyncCheckUresponsive'), 'schedule');
			for (let i = 0; i < 100; i++) {
				assert.strictEqual(await proxy.$call(), 42);
			}
			assert.strictEqual(schedule.callCount, 1);
			assert.strictEqual(clock.countTimers(), 1);
			await clock.tickAsync(1001);
			assert.strictEqual(clock.countTimers(), 0);
			assert.strictEqual(await proxy.$call(), 42);
			assert.strictEqual(schedule.callCount, 2);
			client.dispose();
			assert.strictEqual(clock.countTimers(), 0);
		} finally {
			clock.restore();
		}
	});

	test('a reused check still detects an unresponsive peer and recovers', async () => {
		const clock = sinon.useFakeTimers(timerOptions);
		try {
			let release!: (value: number) => void;
			let held = false;
			const { client, proxy, two } = createObservedRPC({ $call: () => held ? new Promise<number>(resolve => release = resolve) : 42 });
			assert.strictEqual(await proxy.$call(), 42);
			held = true;
			const dropAcknowledgement = sinon.stub(two, 'send');
			const dropNativeAcknowledgement = two.sendStructuredClone ? sinon.stub(two, 'sendStructuredClone') : undefined;
			const reply = proxy.$call();
			await clock.tickAsync(1001);
			assert.strictEqual(client.responsiveState, 0);
			await clock.tickAsync(4001);
			assert.strictEqual(client.responsiveState, 1);
			dropAcknowledgement.restore();
			dropNativeAcknowledgement?.restore();
			release(42);
			assert.strictEqual(await reply, 42);
			assert.strictEqual(client.responsiveState, 0);
			client.dispose();
			assert.strictEqual(clock.countTimers(), 0);
		} finally {
			clock.restore();
		}
	});

	for (const fail of [false, true]) {
		test(`releases the caller cancellation subscription after ${fail ? 'error' : 'success'}`, async () => {
			let listeners = 0;
			const emitter = disposables.add(new Emitter<void>({
				onDidAddListener: () => listeners++,
				onWillRemoveListener: () => listeners--
			}));
			const token: CancellationToken = { isCancellationRequested: false, onCancellationRequested: emitter.event };
			delegate = value => {
				if (fail) {
					throw new Error('expected failure');
				}
				return value;
			};
			const reply = bProxy.$m(42, token);
			assert.strictEqual(listeners, 1);
			if (fail) {
				await assert.rejects(reply, /expected failure/);
			} else {
				assert.strictEqual(await reply, 42);
			}
			assert.strictEqual(listeners, 0);
		});
	}

	function createNotificationRPC(service: NotificationTestService) {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol(buffer => sent.push(buffer));
		const two = new MessagePassingProtocol(buffer => sent.push(buffer));
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		server.set(notificationIdentifier, service);
		return { client, server, two, sent, proxy: client.getProxy(notificationIdentifier) };
	}

	function messageType(buffer: VSBuffer): number {
		const message = getStructuredCloneMessage(buffer);
		if (!message) {
			return buffer.readUInt8(0);
		}
		return typeof message.header === 'number' ? message.header & 31 : (message.header as number[])[0];
	}

	test('explicit notifications deliver every update before an ordinary barrier request', async () => {
		const clock = sinon.useFakeTimers({ toFake: ['Date'] });
		let count = 0;
		const { client, server, proxy, sent } = createNotificationRPC({ $notify: () => { count++; }, $state: () => count });
		try {
			assert.strictEqual(await proxy.$state(), 0);
			sent.length = 0;
			for (let i = 0; i < 64; i++) {
				proxy.$notify(i);
			}
			assert.strictEqual(await proxy.$state(), 64);
			assert.strictEqual(sent.filter(buffer => messageType(buffer) === 13).length, native ? 64 : 0);
			assert.strictEqual(sent.filter(buffer => messageType(buffer) === 7).length, native ? 0 : 64);
		} finally {
			client.dispose();
			server.dispose();
			clock.restore();
		}
	});

	test('notification DTOs are snapshotted at call time and preserve URI payloads', async () => {
		let last: unknown;
		const { proxy } = createNotificationRPC({ $notify: value => { last = value; }, $state: () => last });
		await proxy.$state();
		const value = { label: 'before' };
		proxy.$notify(value);
		value.label = 'after';
		assert.deepStrictEqual(await proxy.$state(), { label: 'before' });
		const uri = URI.file('/notification-test');
		proxy.$notify(uri);
		assert.deepStrictEqual(await proxy.$state(), JSON.parse(JSON.stringify(uri)));
	});

	test('notification and binary fallback calls retain invocation order', async () => {
		const seen: unknown[] = [];
		const { proxy } = createNotificationRPC({
			$notify: value => { seen.push(value instanceof VSBuffer ? value.toString() : value); },
			$state: () => seen
		});
		await proxy.$state();
		proxy.$notify(1);
		await proxy.$notify(VSBuffer.fromString('binary'));
		proxy.$notify(2);
		assert.deepStrictEqual(await proxy.$state(), [1, 'binary', 2]);
	});

	test('cancellable notification methods keep the full request/reply path', async () => {
		let entered!: () => void;
		const invoked = new Promise<void>(resolve => entered = resolve);
		const { client, proxy } = createNotificationRPC({
			$notify: (_value, token) => new Promise<void>(resolve => {
				const listener = token!.onCancellationRequested(() => {
					listener.dispose();
					resolve();
				});
				entered();
			}),
			$state: () => 0
		});
		const source = disposables.add(new CancellationTokenSource());
		const reply = proxy.$notify(1, source.token);
		await invoked;
		assert.strictEqual(Object.keys(Reflect.get(client, '_pendingRPCReplies')).length, 1);
		source.cancel();
		await reply;
		assert.strictEqual(Object.keys(Reflect.get(client, '_pendingRPCReplies')).length, 0);
	});

	test('notification handler errors are reported for synchronous and async handlers', async () => {
		const received: unknown[] = [];
		const handler = sinon.stub(errorHandler, 'onUnexpectedError').callsFake(error => received.push(error));
		try {
			const { proxy } = createNotificationRPC({
				$notify: value => {
					if (value === 'async') {
						return Promise.reject(new Error('notification failure'));
					}
					throw new Error('notification failure');
				},
				$state: () => 0
			});
			await proxy.$state();
			proxy.$notify('sync');
			await proxy.$state();
			proxy.$notify('async');
			await proxy.$state();
			assert.strictEqual(received.length, 2);
			assert.ok(received.every(error => error instanceof Error && error.message === 'notification failure'));
		} finally {
			handler.restore();
		}
	});

	if (native) {
		test('notification traffic periodically probes a silent peer and cleans up on disposal', async () => {
			const clock = sinon.useFakeTimers(timerOptions);
			try {
				const { client, server, two, proxy } = createNotificationRPC({ $notify: () => new Promise<void>(() => { }), $state: () => 0 });
				await proxy.$state();
				await proxy.$notify();
				assert.strictEqual(Object.keys(Reflect.get(client, '_pendingRPCReplies')).length, 0);
				await clock.tickAsync(1100);
				sinon.stub(two, 'send');
				if (two.sendStructuredClone) {
					sinon.stub(two, 'sendStructuredClone');
				}
				const probe = proxy.$notify();
				const rejected = assert.rejects(probe, /Canceled/);
				assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 1);
				for (let i = 0; i < 10; i++) {
					proxy.$notify(i);
				}
				assert.strictEqual(Object.keys(Reflect.get(client, '_pendingRPCReplies')).length, 1);
				await clock.tickAsync(4001);
				assert.strictEqual(client.responsiveState, 1);
				client.dispose();
				server.dispose();
				await rejected;
				assert.strictEqual(clock.countTimers(), 0);
			} finally {
				clock.restore();
			}
		});
	}

	test('mixed native and binary requests preserve invocation order', async () => {
		const one = new MessagePassingProtocol();
		const two = new MessagePassingProtocol();
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		const seen: number[] = [];
		const service = { $echo: (index: number, value: unknown) => { seen.push(index); return value; } };
		const identifier = new ProxyIdentifier<typeof service>('mixed-order');
		server.set(identifier, service);
		const proxy = client.getProxy(identifier);
		const bytes = VSBuffer.fromString('mixed binary frame');
		const [first, second, third, fourth] = await Promise.all([
			proxy.$echo(0, { value: 1 }), proxy.$echo(1, bytes), proxy.$echo(2, undefined), proxy.$echo(3, { value: 4 })
		]);
		assert.deepStrictEqual(seen, [0, 1, 2, 3]);
		assert.deepStrictEqual(first, { value: 1 });
		assert.ok(second instanceof VSBuffer);
		assert.strictEqual(second.toString(), bytes.toString());
		assert.strictEqual(third, undefined);
		assert.deepStrictEqual(fourth, { value: 4 });
	});

	test('native scalar replies retain JSON conversions and object fallback', async () => {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol();
		const two = new MessagePassingProtocol(buffer => sent.push(buffer));
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		server.set(bIdentifier, new BClass());
		const proxy = client.getProxy(bIdentifier);
		const unusualText = String.fromCharCode(0, 0xd800, 0xdc00, 0xd800, 34, 92) + '😊';
		const text = unusualText.repeat(4096);
		const cases = [
			{ value: undefined, expected: undefined, scalar: false },
			{ value: null, expected: null, scalar: true },
			{ value: true, expected: true, scalar: true },
			{ value: false, expected: false, scalar: true },
			{ value: 42, expected: 42, scalar: true },
			{ value: -0, expected: 0, scalar: true },
			{ value: 1.25, expected: 1.25, scalar: true },
			{ value: NaN, expected: null, scalar: true },
			{ value: Infinity, expected: null, scalar: true },
			{ value: -Infinity, expected: null, scalar: true },
			{ value: '', expected: '', scalar: true },
			{ value: unusualText, expected: unusualText, scalar: true },
			{ value: text, expected: text, scalar: true },
			{ value: { toJSON: () => 'object fallback' }, expected: 'object fallback', scalar: false }
		];
		for (const item of cases) {
			sent.length = 0;
			delegate = () => item.value;
			assert.deepStrictEqual(await proxy.$m(null, null), item.expected);
			const reply = sent.find(buffer => [7, 9, 14].includes(messageType(buffer)));
			assert.ok(reply);
			assert.strictEqual(messageType(reply), item.value === undefined ? 7 : native && item.scalar ? 14 : 9);
			if (native && item.scalar) {
				assert.deepStrictEqual(getStructuredCloneMessage(reply)?.body, item.expected);
			}
		}
	});

	test('simple call without result', function (done) {
		delegate = (a1: number, a2: number) => { };
		bProxy.$m(4, 1).then((res: number) => {
			assert.strictEqual(res, undefined);
			done(null);
		}, done);
	});

	test('passing buffer as argument', function (done) {
		delegate = (a1: VSBuffer, a2: number) => {
			assert.ok(a1 instanceof VSBuffer);
			return a1.buffer[a2];
		};
		const b = VSBuffer.alloc(4);
		b.buffer[0] = 1;
		b.buffer[1] = 2;
		b.buffer[2] = 3;
		b.buffer[3] = 4;
		bProxy.$m(b, 2).then((res: number) => {
			assert.strictEqual(res, 3);
			done(null);
		}, done);
	});

	test('returning a buffer', function (done) {
		delegate = (a1: number, a2: number) => {
			const b = VSBuffer.alloc(4);
			b.buffer[0] = 1;
			b.buffer[1] = 2;
			b.buffer[2] = 3;
			b.buffer[3] = 4;
			return b;
		};
		bProxy.$m(4, 1).then((res: VSBuffer) => {
			assert.ok(res instanceof VSBuffer);
			assert.strictEqual(res.buffer[0], 1);
			assert.strictEqual(res.buffer[1], 2);
			assert.strictEqual(res.buffer[2], 3);
			assert.strictEqual(res.buffer[3], 4);
			done(null);
		}, done);
	});

	test('cancelling a call via CancellationToken before', function (done) {
		delegate = (a1: number, a2: number) => a1 + a2;
		const p = bProxy.$m(4, CancellationToken.Cancelled);
		p.then((res: number) => {
			assert.fail('should not receive result');
		}, (err) => {
			assert.ok(true);
			done(null);
		});
	});

	test('passing CancellationToken.None', function (done) {
		delegate = (a1: number, token: CancellationToken) => {
			assert.ok(!!token);
			return a1 + 1;
		};
		bProxy.$m(4, CancellationToken.None).then((res: number) => {
			assert.strictEqual(res, 5);
			done(null);
		}, done);
	});

	test('cancelling a call via CancellationToken quickly', function (done) {
		// this is an implementation which, when cancellation is triggered, will return 7
		delegate = (a1: number, token: CancellationToken) => {
			return new Promise((resolve, reject) => {
				const disposable = token.onCancellationRequested((e) => {
					disposable.dispose();
					resolve(7);
				});
			});
		};
		const tokenSource = new CancellationTokenSource();
		const p = bProxy.$m(4, tokenSource.token);
		p.then((res: number) => {
			assert.strictEqual(res, 7);
		}, (err) => {
			assert.fail('should not receive error');
		}).finally(done);
		tokenSource.cancel();
	});

	test('releases cancellation handler when the invoked call does not settle', async function () {
		let resolveRemoteToken!: (token: CancellationToken) => void;
		const remoteToken = new Promise<CancellationToken>(resolve => resolveRemoteToken = resolve);
		delegate = (_a1: number, token: CancellationToken) => {
			resolveRemoteToken(token);
			return new Promise(() => { });
		};

		const tokenSource = disposables.add(new CancellationTokenSource());
		void bProxy.$m(4, tokenSource.token);
		const token = await remoteToken;
		const cancellationRequested = new Promise<void>(resolve => {
			disposables.add(token.onCancellationRequested(() => resolve()));
		});
		tokenSource.cancel();
		await cancellationRequested;

		const cancelInvokedHandlers = Reflect.get(bProtocol, '_cancelInvokedHandlers') as Record<string, () => void>;
		assert.deepStrictEqual(Object.keys(cancelInvokedHandlers), []);
	});

	test('does not track uncancellable calls that do not settle', async function () {
		let resolveInvoked!: () => void;
		const invoked = new Promise<void>(resolve => resolveInvoked = resolve);
		delegate = () => {
			resolveInvoked();
			return new Promise(() => { });
		};

		void bProxy.$m(4, 1);
		await invoked;

		const cancelInvokedHandlers = Reflect.get(bProtocol, '_cancelInvokedHandlers') as Record<string, () => void>;
		assert.deepStrictEqual(Object.keys(cancelInvokedHandlers), []);
	});

	test('throwing an error', function (done) {
		delegate = (a1: number, a2: number) => {
			throw new Error(`nope`);
		};
		bProxy.$m(4, 1).then((res) => {
			assert.fail('unexpected');
		}, (err) => {
			assert.strictEqual(err.message, 'nope');
		}).finally(done);
	});

	test('error promise', function (done) {
		delegate = (a1: number, a2: number) => {
			return Promise.reject(undefined);
		};
		bProxy.$m(4, 1).then((res) => {
			assert.fail('unexpected');
		}, (err) => {
			assert.strictEqual(err, undefined);
		}).finally(done);
	});

	test('issue #60450: Converting circular structure to JSON', function (done) {
		delegate = (a1: number, a2: number) => {
			// eslint-disable-next-line local/code-no-any-casts
			const circular = <any>{};
			circular.self = circular;
			return circular;
		};
		bProxy.$m(4, 1).then((res) => {
			assert.strictEqual(res, null);
		}, (err) => {
			assert.fail('unexpected');
		}).finally(done);
	});

	test('issue #72798: null errors are hard to digest', function (done) {
		delegate = (a1: number, a2: number) => {
			// eslint-disable-next-line no-throw-literal
			throw { 'what': 'what' };
		};
		bProxy.$m(4, 1).then((res) => {
			assert.fail('unexpected');
		}, (err) => {
			assert.strictEqual(err.what, 'what');
		}).finally(done);
	});

	test('undefined arguments arrive as null', function () {
		delegate = (a1: any, a2: any) => {
			assert.strictEqual(typeof a1, 'undefined');
			assert.strictEqual(a2, null);
			return 7;
		};
		return bProxy.$m(undefined, null).then((res) => {
			assert.strictEqual(res, 7);
		});
	});

	test('issue #81424: SerializeRequest should throw if an argument can not be serialized', () => {
		const badObject = {};
		// eslint-disable-next-line local/code-no-any-casts
		(<any>badObject).loop = badObject;

		assert.throws(() => {
			bProxy.$m(badObject, '2');
		});
	});

	test('SerializableObjectWithBuffers is correctly transferred', function (done) {
		delegate = (a1: SerializableObjectWithBuffers<{ string: string; buff: VSBuffer }>, a2: number) => {
			return new SerializableObjectWithBuffers({ string: a1.value.string + ' world', buff: a1.value.buff });
		};

		const b = VSBuffer.alloc(4);
		b.buffer[0] = 1;
		b.buffer[1] = 2;
		b.buffer[2] = 3;
		b.buffer[3] = 4;

		bProxy.$m(new SerializableObjectWithBuffers({ string: 'hello', buff: b }), undefined).then((res: SerializableObjectWithBuffers<any>) => {
			assert.ok(res instanceof SerializableObjectWithBuffers);
			assert.strictEqual(res.value.string, 'hello world');

			assert.ok(res.value.buff instanceof VSBuffer);

			const bufferValues = Array.from(res.value.buff.buffer);

			assert.strictEqual(bufferValues[0], 1);
			assert.strictEqual(bufferValues[1], 2);
			assert.strictEqual(bufferValues[2], 3);
			assert.strictEqual(bufferValues[3], 4);
			done(null);
		}, done);
	});
}));
