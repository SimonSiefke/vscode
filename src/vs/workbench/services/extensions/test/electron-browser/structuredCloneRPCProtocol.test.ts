/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { canceled } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { URITransformer } from '../../../../../base/common/uriIpc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ProxyIdentifier, SerializableObjectWithBuffers } from '../../common/proxyIdentifier.js';
import { RPCMessagePort } from '../../common/rpcMessagePort.js';
import { StructuredCloneRPCProtocol } from '../../common/structuredCloneRPCProtocol.js';

type Service = {
	$echo(value: unknown, optional?: unknown): Promise<unknown>;
	$wait(token: CancellationToken): Promise<void>;
	$fail(): Promise<void>;
};
const identifier = new ProxyIdentifier<Service>('structuredCloneRealPort');

suite('StructuredCloneRPCProtocol, real MessagePort', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let caller: StructuredCloneRPCProtocol;
	let receiver: StructuredCloneRPCProtocol;
	let proxy: Service;
	let cancelled: Promise<void>;

	setup(async () => {
		const { port1, port2 } = new MessageChannel();
		store.add(toDisposable(() => { port1.close(); port2.close(); }));
		const one = store.add(new RPCMessagePort(message => port1.postMessage(message)));
		const two = store.add(new RPCMessagePort(message => port2.postMessage(message)));
		port1.onmessage = event => one.acceptMessage(event.data);
		port2.onmessage = event => two.acceptMessage(event.data);
		port1.start();
		port2.start();
		// Exercise initialization before installing RPC listeners, as in production.
		const ready = Event.toPromise(one.onMessage);
		two.send(VSBuffer.fromString('ready'));
		assert.strictEqual((await ready).toString(), 'ready');
		const transformer = new URITransformer({
			transformIncoming: uri => ({ ...uri, path: '/incoming' + uri.path }),
			transformOutgoing: uri => ({ ...uri, path: '/outgoing' + uri.path }),
			transformOutgoingScheme: scheme => scheme
		});
		caller = store.add(new StructuredCloneRPCProtocol(one, null, transformer));
		receiver = store.add(new StructuredCloneRPCProtocol(two));
		cancelled = new Promise<void>(resolve => receiver.set(identifier, {
			$echo: async value => value,
			$wait: token => new Promise<void>((_done, reject) => {
				store.add(token.onCancellationRequested(() => { resolve(); reject(canceled()); }));
			}),
			$fail: async () => { throw new Error('real port failure'); }
		}));
		proxy = caller.getProxy(identifier);
	});

	test('transforms nested URI arguments and replies', async () => {
		const value = await proxy.$echo({ uri: URI.file('/file') }) as { uri: URI };
		assert.strictEqual(URI.revive(value.uri).path, '/incoming/outgoing/file');
	});

	test('preserves exact buffer view bytes', async () => {
		const bytes = Uint8Array.from([99, 0xef, 0xbb, 0xbf, 0xff, 0, 99]).subarray(1, 6);
		const value = await proxy.$echo(new SerializableObjectWithBuffers({ bytes: VSBuffer.wrap(bytes), optional: undefined }), undefined) as SerializableObjectWithBuffers<{ bytes: VSBuffer }>;
		assert.deepStrictEqual([...value.value.bytes.buffer], [...bytes]);
	});

	test('propagates errors and cancellation', async () => {
		await assert.rejects(proxy.$fail(), /real port failure/);
		const source = store.add(new CancellationTokenSource());
		const pending = proxy.$wait(source.token);
		const completion = assert.rejects(pending, /Canceled/);
		source.cancel();
		await Promise.all([cancelled, completion]);
	});

	test('request IDs remain distinct above the 32-bit boundary', async () => {
		Reflect.set(caller, '_lastMessageId', 2 ** 32 - 2);
		assert.deepStrictEqual(await Promise.all([proxy.$echo(1), proxy.$echo(2), proxy.$echo(3)]), [1, 2, 3]);
	});

	test('disposal rejects outstanding replies and cancels running handlers', async () => {
		const source = store.add(new CancellationTokenSource());
		const pending = proxy.$wait(source.token);
		// An ordered barrier ensures the handler is installed before disposal.
		await proxy.$echo('barrier');
		const rejection = assert.rejects(pending, /Canceled/);
		caller.dispose();
		receiver.dispose();
		await Promise.all([cancelled, rejection]);
	});
});
