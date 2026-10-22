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

['binary', 'native JSON', 'batched JSON'].forEach(mode => suite(`RPCProtocol (${mode})`, () => {
	const native = mode !== 'binary';

	let disposables: DisposableStore;

	class MessagePassingProtocol implements IMessagePassingProtocol {
		private _pair?: MessagePassingProtocol;
		private readonly bufferedPort?: RPCMessagePort;

		private readonly _onMessage = new Emitter<VSBuffer>();
		public readonly onMessage: Event<VSBuffer> = this._onMessage.event;

		public readonly sendStructuredClone?: (message: IStructuredCloneMessage) => void;

		constructor(private readonly onSend?: (buffer: VSBuffer) => void) {
			if (mode === 'batched JSON') {
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

	setup(() => {
		disposables = new DisposableStore();

		const a_protocol = new MessagePassingProtocol();
		const b_protocol = new MessagePassingProtocol();
		a_protocol.setPair(b_protocol);
		b_protocol.setPair(a_protocol);

		const A = disposables.add(new RPCProtocol(a_protocol));
		bProtocol = disposables.add(new RPCProtocol(b_protocol));

		const bIdentifier = new ProxyIdentifier<BClass>('bb');
		const bInstance = new BClass();
		bProtocol.set(bIdentifier, bInstance);
		bProxy = A.getProxy(bIdentifier);
	});

	teardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('simple call', function (done) {
		delegate = (a1: number, a2: number) => a1 + a2;
		bProxy.$m(4, 1).then((res: number) => {
			assert.strictEqual(res, 5);
			done(null);
		}, done);
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

	test('pending handlers acknowledge before their result is available', async () => {
		let resolve!: (value: number) => void;
		const result = new Promise<number>(r => resolve = r);
		const { client, proxy, sent } = createObservedRPC({ $call: () => result });
		const reply = proxy.$call();
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(sent.length, 2);
		assert.strictEqual(sent[1].readUInt8(0), 5); // Acknowledged
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		resolve(42);
		assert.strictEqual(await reply, 42);
		assert.strictEqual(sent.length, 3);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	test('late and duplicate acknowledgements do not corrupt responsiveness accounting', async () => {
		const { client, proxy, sent, two } = createObservedRPC({ $call: () => 42 });
		assert.strictEqual(await proxy.$call(), 42);
		const ack = VSBuffer.alloc(5);
		ack.writeUInt8(5, 0); // Acknowledged
		const first = getStructuredCloneMessage(sent[0]);
		ack.writeUInt32BE(first ? (first.header as number[])[1] : sent[0].readUInt32BE(1), 1);
		two.send(ack);
		two.send(ack);
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
		assert.strictEqual(await proxy.$call(), 42);
		assert.strictEqual(Reflect.get(client, '_unacknowledgedCount'), 0);
	});

	test('short calls reuse a responsiveness check until it expires', async () => {
		const clock = sinon.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
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
		const clock = sinon.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		try {
			let release!: (value: number) => void;
			let held = false;
			const { client, proxy, two } = createObservedRPC({ $call: () => held ? new Promise<number>(resolve => release = resolve) : 42 });
			assert.strictEqual(await proxy.$call(), 42);
			held = true;
			const dropAcknowledgement = sinon.stub(two, 'send');
			const reply = proxy.$call();
			await clock.tickAsync(1001);
			assert.strictEqual(client.responsiveState, 0);
			await clock.tickAsync(4001);
			assert.strictEqual(client.responsiveState, 1);
			dropAcknowledgement.restore();
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

	function createNotificationRPC(service: { $notify: (value?: unknown, token?: CancellationToken) => void; $state: () => unknown }) {
		const sent: VSBuffer[] = [];
		const one = new MessagePassingProtocol(buffer => sent.push(buffer));
		const two = new MessagePassingProtocol(buffer => sent.push(buffer));
		one.setPair(two);
		two.setPair(one);
		const client = disposables.add(new RPCProtocol(one));
		const server = disposables.add(new RPCProtocol(two));
		const identifier = new ProxyIdentifier<typeof service>('notifications', ['$notify']);
		server.set(identifier, service);
		return { client, server, two, sent, proxy: client.getProxy(identifier) };
	}

	function messageType(buffer: VSBuffer): number {
		const message = getStructuredCloneMessage(buffer);
		return message ? (message.header as number[])[0] : buffer.readUInt8(0);
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
			const clock = sinon.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
			try {
				const { client, server, two, proxy } = createNotificationRPC({ $notify: () => new Promise<void>(() => { }), $state: () => 0 });
				await proxy.$state();
				await proxy.$notify();
				assert.strictEqual(Object.keys(Reflect.get(client, '_pendingRPCReplies')).length, 0);
				await clock.tickAsync(1100);
				sinon.stub(two, 'send');
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
