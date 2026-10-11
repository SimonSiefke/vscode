/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAddressProvider } from '../../../remote/common/remoteAgentConnection.js';
import { WebSocketRemoteConnection } from '../../../remote/common/remoteAuthorityResolver.js';
import { AbstractTunnelService, ITunnelProvider, RemoteTunnel, TunnelPrivacyId, isTunnelProvider } from '../../common/tunnel.js';

class TestTunnelService extends AbstractTunnelService {
	next: Promise<RemoteTunnel | string | undefined> | undefined;
	creations = 0;

	isPortPrivileged(): boolean { return false; }

	protected createTunnel(provider: IAddressProvider | ITunnelProvider, host: string, port: number): Promise<RemoteTunnel | string | undefined> | undefined {
		this.creations++;
		return isTunnelProvider(provider) ? this.createWithProvider(provider, host, port, undefined, false) : this.next;
	}
}

suite('Tunnel lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const addressProvider: IAddressProvider = { getAddress: async () => ({ connectTo: new WebSocketRemoteConnection('localhost', 8000), connectionToken: undefined }) };

	function setup() {
		const configuration = new TestConfigurationService();
		store.add(configuration.onDidChangeConfigurationEmitter);
		const service = store.add(new TestTunnelService(new NullLogService(), configuration));
		const disposed: (boolean | undefined)[] = [];
		const tunnel: RemoteTunnel = {
			get tunnelRemoteHost() { return '127.0.0.1'; },
			tunnelRemotePort: 8000, tunnelLocalPort: 9000, localAddress: 'localhost:9000', privacy: TunnelPrivacyId.Private,
			dispose: async silent => { disposed.push(silent); }
		};
		service.next = Promise.resolve(tunnel);
		const open = async (host = '127.0.0.1') => {
			const result = await service.openTunnel(addressProvider, host, 8000);
			assert.ok(result && typeof result !== 'string');
			return result;
		};
		return { service, tunnel, disposed, open };
	}

	test('aliases and existing-tunnel lookups return independent disposable handles', async () => {
		const { service, disposed, open } = setup();
		const first = await open();
		const second = await open('localhost');
		const existing = await service.getExistingTunnel('0.0.0.0', 8000);
		assert.ok(existing && typeof existing !== 'string');
		assert.strictEqual(second.tunnelRemoteHost, '127.0.0.1');
		assert.strictEqual(service.creations, 1);
		await first.dispose();
		await first.dispose();
		await existing.dispose();
		assert.deepStrictEqual(disposed, []);
		await second.dispose();
		assert.deepStrictEqual(disposed, [true]);
		assert.deepStrictEqual(await service.tunnels, []);
	});

	test('the final release and force-close await asynchronous backend disposal', async () => {
		const { service, tunnel, open } = setup();
		const closed = new DeferredPromise<void>();
		tunnel.dispose = () => closed.p;
		const first = await open();
		let finished = false;
		const closing = first.dispose().then(() => finished = true);
		await Promise.resolve();
		assert.strictEqual(finished, false);
		await closed.complete();
		await closing;
		assert.strictEqual(finished, true);
		const second = await open();
		await service.closeTunnel('127.0.0.1', 8000);
		await second.dispose();
		assert.deepStrictEqual(await service.tunnels, []);
	});

	test('force-close leaves replacement tunnels independent of old handles', async () => {
		const { service, disposed, open } = setup();
		const first = await open();
		const second = await open();
		await service.closeTunnel('127.0.0.1', 8000);
		const replacement = await open();
		await first.dispose();
		await second.dispose();
		assert.deepStrictEqual(disposed, [true]);
		await replacement.dispose();
		assert.deepStrictEqual(disposed, [true, true]);
	});

	test('closing a pending tunnel disposes its result without closing a replacement', async () => {
		const { service, tunnel, disposed, open } = setup();
		const pending = new DeferredPromise<RemoteTunnel>();
		service.next = pending.p;
		const opening = service.openTunnel(addressProvider, '127.0.0.1', 8000);
		const closing = service.closeTunnel('127.0.0.1', 8000);
		service.next = Promise.resolve(tunnel);
		const replacement = await open();
		await pending.complete(tunnel);
		assert.strictEqual(await opening, undefined);
		await closing;
		assert.strictEqual((await service.tunnels).length, 1);
		assert.deepStrictEqual(disposed, [true]);
		await replacement.dispose();
	});

	test('failed and empty creations release their references and allow retry', async () => {
		const { service, tunnel, open } = setup();
		for (const result of [undefined, 'provider error']) {
			service.next = Promise.resolve(result);
			assert.strictEqual(await service.openTunnel(addressProvider, '127.0.0.1', 8000), result);
			assert.deepStrictEqual(await service.tunnels, []);
		}
		service.next = Promise.reject(new Error('creation failed'));
		await assert.rejects(service.openTunnel(addressProvider, '127.0.0.1', 8000)!, /creation failed/);
		service.next = Promise.resolve(tunnel);
		await (await open()).dispose();
	});

	test('provider exceptions clear the creation guard', async () => {
		const { service, tunnel } = setup();
		store.add(service.setTunnelProvider({ forwardPort: () => { throw new Error('provider failed'); } }));
		assert.throws(() => service.openTunnel(undefined, '127.0.0.1', 8000), /provider failed/);
		store.add(service.setTunnelProvider({ forwardPort: () => Promise.resolve(tunnel) }));
		const result = await service.openTunnel(undefined, '127.0.0.1', 8000);
		assert.ok(result && typeof result !== 'string');
		await result.dispose();
	});

	test('service shutdown waits for pending creation and disposes without silent mode', async () => {
		const { service, tunnel, disposed } = setup();
		const pending = new DeferredPromise<RemoteTunnel>();
		service.next = pending.p;
		const opening = service.openTunnel(addressProvider, '127.0.0.1', 8000);
		const shutdown = service.dispose();
		await pending.complete(tunnel);
		await shutdown;
		assert.strictEqual(await opening, undefined);
		assert.deepStrictEqual(disposed, [false]);
	});
});
