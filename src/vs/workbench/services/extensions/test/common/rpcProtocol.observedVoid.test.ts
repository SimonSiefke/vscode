/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ProxyIdentifier } from '../../common/proxyIdentifier.js';
import { RPCMessagePort } from '../../common/rpcMessagePort.js';
import { RPCProtocol } from '../../common/rpcProtocol.js';

interface ObservedVoidService {
	$finish(): void;
}

const identifier = new ProxyIdentifier<ObservedVoidService>('observedVoidCompletion', undefined, ['$finish']);

suite('RPCProtocol (observed void actor)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('an explicitly observed void actor retains completion over real MessagePorts', async () => {
		const channel = new MessageChannel();
		disposables.add(toDisposable(() => {
			channel.port1.onmessage = null;
			channel.port2.onmessage = null;
			channel.port1.close();
			channel.port2.close();
		}));
		const first = disposables.add(new RPCMessagePort(message => channel.port1.postMessage(message)));
		const second = disposables.add(new RPCMessagePort(message => channel.port2.postMessage(message)));
		channel.port1.onmessage = event => first.acceptMessage(event.data);
		channel.port2.onmessage = event => second.acceptMessage(event.data);
		channel.port1.start();
		channel.port2.start();
		const client = disposables.add(new RPCProtocol(first));
		const server = disposables.add(new RPCProtocol(second));
		const entered = new DeferredPromise<void>();
		const completion = new DeferredPromise<void>();
		server.set(identifier, {
			$finish: () => {
				void entered.complete(undefined);
				return completion.p;
			}
		});
		const result = client.getProxy(identifier).$finish();
		let settled = false;
		const observed = result.then(() => { settled = true; }, () => { settled = true; });
		await entered.p;
		assert.ok(result instanceof Promise);
		assert.strictEqual(settled, false);
		void completion.complete(undefined);
		const value = await result;
		await observed;
		assert.deepStrictEqual({ settled, value }, { settled: true, value: undefined });
	});
});
