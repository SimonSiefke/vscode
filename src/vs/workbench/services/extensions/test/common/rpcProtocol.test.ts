/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMessagePassingProtocol } from '../../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createProxyIdentifier, ProxyIdentifier, SerializableObjectWithBuffers } from '../../common/proxyIdentifier.js';
import { RPCProtocol as ByteRPCProtocol } from '../../common/rpcProtocol.js';
import { StructuredCloneRPCProtocol } from '../../common/structuredCloneRPCProtocol.js';
import { IRPCMessage, IStructuredCloneRPCTransport } from '../../common/rpcMessagePort.js';

const loggingIdentifier = createProxyIdentifier<{ $echo(value: string): Promise<string> }>('rpcLoggingTest');

[false, true].forEach(native => suite(`RPCProtocol (${native ? 'structured clone' : 'byte'})`, () => {
	const RPCProtocol = native ? StructuredCloneRPCProtocol : ByteRPCProtocol;
	type RPCProtocol = StructuredCloneRPCProtocol | ByteRPCProtocol;

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	class MessagePassingProtocol implements IMessagePassingProtocol, IStructuredCloneRPCTransport {
		private _pair?: MessagePassingProtocol;

		private readonly _onMessage = new Emitter<VSBuffer>();
		public readonly onMessage: Event<VSBuffer> = this._onMessage.event;

		private readonly _onRPCMessage = new Emitter<IRPCMessage>();
		public readonly onRPCMessage = this._onRPCMessage.event;

		public sendRPCMessage(message: IRPCMessage): void {
			const cloned = structuredClone(message);
			Promise.resolve().then(() => this._pair!._onRPCMessage.fire(cloned));
		}

		public setPair(other: MessagePassingProtocol) {
			this._pair = other;
		}

		public send(buffer: VSBuffer): void {
			Promise.resolve().then(() => {
				this._pair!._onMessage.fire(buffer);
			});
		}
	}


	test('reports unknown native sizes and measured byte sizes', async () => {
		const lengths: (number | undefined)[] = [];
		const logger = { logIncoming: (length: number | undefined) => lengths.push(length), logOutgoing: (length: number | undefined) => lengths.push(length) };
		const one = new MessagePassingProtocol();
		const two = new MessagePassingProtocol();
		one.setPair(two);
		two.setPair(one);
		const caller = disposables.add(new RPCProtocol(one, logger));
		const receiver = disposables.add(new RPCProtocol(two, logger));
		receiver.set(loggingIdentifier, { $echo: async value => value });

		assert.strictEqual(await caller.getProxy(loggingIdentifier).$echo('nonempty'), 'nonempty');
		assert.strictEqual(lengths.length, 6);
		assert.ok(lengths.every(length => native ? length === undefined : typeof length === 'number' && length > 0));
	});

	let delegate: (a1: any, a2: any) => any;
	let bProxy: BClass;
	let bProtocol: RPCProtocol;
	class BClass {
		$m(a1: any, a2: any): Promise<any> {
			return Promise.resolve(delegate.call(null, a1, a2));
		}
	}

	setup(() => {

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


	test('snapshots direct and wrapped shared binary values', async function () {
		if (typeof SharedArrayBuffer === 'undefined') {
			this.skip();
		}
		delegate = value => value;
		const results: { bytes: number[]; shared: boolean }[] = [];
		for (const wrapped of [false, true]) {
			const allocation = new Uint8Array(new SharedArrayBuffer(3));
			allocation.set([41, 42, 43]);
			const bytes = VSBuffer.wrap(allocation);
			const pending = bProxy.$m(wrapped ? new SerializableObjectWithBuffers({ bytes }) : bytes, undefined);
			allocation.fill(0);
			const value = await pending;
			const buffer: VSBuffer = wrapped ? value.value.bytes : value;
			results.push({ bytes: [...buffer.buffer], shared: buffer.buffer.buffer instanceof SharedArrayBuffer });
		}
		assert.deepStrictEqual(results, [{ bytes: [41, 42, 43], shared: false }, { bytes: [41, 42, 43], shared: false }]);
	});


	test('bounds a resizable backing store before a later argument grows it', async function () {
		if (typeof ArrayBuffer.prototype.resize !== 'function') {
			this.skip();
		}
		delegate = (value: VSBuffer | SerializableObjectWithBuffers<{ bytes: VSBuffer }>, marker: string) => {
			const buffer = value instanceof VSBuffer ? value : value.value.bytes;
			return { bytes: [...buffer.buffer], backing: buffer.buffer.buffer.byteLength, resizable: buffer.buffer.buffer instanceof ArrayBuffer && buffer.buffer.buffer.resizable, marker };
		};
		for (const wrapped of [false, true]) {
			const backing = new ArrayBuffer(3, { maxByteLength: 1024 * 1024 });
			const fixedView = new Uint8Array(backing, 0, 3);
			fixedView.set([41, 42, 43]);
			const bytes = VSBuffer.wrap(fixedView);
			const later = { toJSON: () => { backing.resize(1024 * 1024); return 'resized'; } };
			const result = await bProxy.$m(wrapped ? new SerializableObjectWithBuffers({ bytes }) : bytes, later);

			assert.deepStrictEqual({ bytes: result.bytes, resizable: result.resizable, marker: result.marker }, { bytes: [41, 42, 43], resizable: false, marker: 'resized' });
			assert.ok(native ? result.backing === 3 : result.backing < 1024 * 1024);
		}
	});

	test('simple call', function (done) {
		delegate = (a1: number, a2: number) => a1 + a2;
		bProxy.$m(4, 1).then((res: number) => {
			assert.strictEqual(res, 5);
			done(null);
		}, done);
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
