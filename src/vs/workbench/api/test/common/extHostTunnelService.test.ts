/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { MainThreadTunnelServiceShape, TunnelDto } from '../../common/extHost.protocol.js';
import { IExtHostInitDataService } from '../../common/extHostInitDataService.js';
import { ExtHostTunnelService } from '../../common/extHostTunnelService.js';
import { SingleProxyRPCProtocol } from './testRPCProtocol.js';

suite('Extension host tunnel disposal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let service: ExtHostTunnelService;
	let closed: number[];

	setup(() => {
		closed = [];
		const proxy = new class extends mock<MainThreadTunnelServiceShape>() {
			override async $setTunnelProvider(): Promise<void> { }
			override async $openTunnel(options: { remoteAddress: { host: string; port: number } }): Promise<TunnelDto> {
				return { remoteAddress: options.remoteAddress, localAddress: 'localhost:3000', privacy: 'private', public: false, protocol: 'http' };
			}
			override async $closeTunnel(remote: { port: number }): Promise<void> {
				closed.push(remote.port);
			}
		};
		service = store.add(new ExtHostTunnelService(SingleProxyRPCProtocol(proxy), new class extends mock<IExtHostInitDataService>() { }, new NullLogService()));
	});

	test('forgets a tunnel when its caller disposes it', async () => {
		const tunnel = await service.openTunnel(nullExtensionDescription, { remoteAddress: { host: 'localhost', port: 3000 } });
		assert.ok(tunnel);
		await tunnel.dispose();
		assert.deepStrictEqual(closed, [3000]);
		service.dispose();
		assert.deepStrictEqual(closed, [3000]);
	});

	test('still closes live tunnels when the service is disposed', async () => {
		await service.openTunnel(nullExtensionDescription, { remoteAddress: { host: 'localhost', port: 3000 } });
		await service.openTunnel(nullExtensionDescription, { remoteAddress: { host: 'localhost', port: 3001 } });
		service.dispose();
		assert.deepStrictEqual(closed, [3000, 3001]);
	});

	for (const silent of [false, true]) {
		test(`releases the provider disposal listener when closing a tunnel (silent=${silent})`, async () => {
			let disposedListeners = 0;
			const remoteAddress = { host: 'localhost', port: 3000 };
			store.add(await service.registerTunnelProvider({
				provideTunnel: async () => ({
					remoteAddress,
					localAddress: 'localhost:3000',
					onDidDispose: () => toDisposable(() => disposedListeners++),
					dispose: async () => { }
				})
			}, {}));
			assert.ok(await service.$forwardPort({ remoteAddress }, { elevationRequired: false }));
			await service.$closeTunnel(remoteAddress, silent);
			assert.strictEqual(disposedListeners, 1);
			service.dispose();
			assert.strictEqual(disposedListeners, 1);
		});
	}
});
