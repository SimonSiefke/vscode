/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { DeferredPromise } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { upcastPartial } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { IExtensionManagementService } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService, NullLoggerService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { RemoteAgentConnectionContext } from '../../../platform/remote/common/remoteAgentEnvironment.js';
import { IPtyHostStarter } from '../../../platform/terminal/node/ptyHost.js';
import { PtyHostService } from '../../../platform/terminal/node/ptyHostService.js';
import { PtyService } from '../../../platform/terminal/node/ptyService.js';
import { AutoRepliesPtyServiceContribution } from '../../../platform/terminal/node/terminalContrib/autoReplies/autoRepliesContribController.js';
import { RemoteTerminalChannelClient } from '../../../workbench/contrib/terminal/common/remote/remoteTerminalChannel.js';
import { RemoteTerminalChannelRequest } from '../../../workbench/contrib/terminal/common/remote/terminal.js';
import { RemoteTerminalChannel } from '../../node/remoteTerminalChannel.js';
import { IServerEnvironmentService } from '../../node/serverEnvironmentService.js';

suite('Remote terminal allocation ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const transfer of ['host restart', 'attachment'] as const) {
		for (const operation of ['settings clear', 'attachment'] as const) {
			test(`a queued ${operation} cannot affect the new owner after ${transfer}`, async () => {
				const cleanup: (() => void)[] = [];
				const shutdowns: boolean[] = [];
				function allocation(creationId: string) {
					const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
					const allocations: Map<number, { pid: number; processLaunchOptions: { options: { creationId: string } }; attach(): Promise<void>; shutdown(immediate: boolean): void }> = Reflect.get(service, '_ptys');
					const contribution: AutoRepliesPtyServiceContribution = Reflect.get(service, '_autoRepliesContribution');
					const settings: ReadonlyMap<number, Readonly<Record<string, string | null>>> = Reflect.get(contribution, '_autoReplies');
					allocations.set(1, { pid: 1234, processLaunchOptions: { options: { creationId } }, attach: async () => { }, shutdown: immediate => { shutdowns.push(immediate); allocations.delete(1); contribution.handleProcessDispose(1); } });
					cleanup.push(() => { contribution.handleProcessDispose(1); allocations.clear(); });
					return { service, settings, allocations };
				}
				let current = allocation('owner A');
				const hostChannel: IChannel = {
					call<T>(command: string, args?: unknown): Promise<T> {
						if (command === 'setAutoReplies') {
							return current.service.setAutoReplies(...args as Parameters<PtyService['setAutoReplies']>) as Promise<T>;
						}
						if (command === 'attachToProcess') {
							return current.service.attachToProcess(...args as Parameters<PtyService['attachToProcess']>) as Promise<T>;
						}
						if (command === 'shutdown') {
							return current.service.shutdown(...args as Parameters<PtyService['shutdown']>) as Promise<T>;
						}
						return Promise.resolve([] as T);
					},
					listen: () => Event.None
				};
				const starter: IPtyHostStarter = {
					start: () => ({ client: { getChannel: <T extends IChannel>() => hostChannel as T }, store: new DisposableStore(), onDidProcessExit: Event.None }),
					dispose: () => { }
				};
				const host = store.add(new PtyHostService(starter, new TestConfigurationService(), new NullLogService(), store.add(new NullLoggerService())));
				const server = store.add(new RemoteTerminalChannel(upcastPartial<IServerEnvironmentService>({}), new NullLogService(), host, upcastPartial<IProductService>({}), upcastPartial<IExtensionManagementService>({}), new TestConfigurationService()));
				const delivery = new DeferredPromise<void>();
				let delivered = 0;
				const context = upcastPartial<RemoteAgentConnectionContext>({ remoteAuthority: 'ssh-remote+test' });
				const network: IChannel = {
					call<T>(command: string, args?: unknown): Promise<T> {
						const payload = structuredClone(args);
						return delivery.p.then(() => { delivered++; return server.call(context, command as RemoteTerminalChannelRequest, payload); });
					},
					listen: () => Event.None
				};
				const instantiationService = store.add(new TestInstantiationService());
				const client = instantiationService.createInstance(RemoteTerminalChannelClient, 'ssh-remote+test', network);
				await current.service.setAutoReplies(1, { prompt: 'original' }, 'owner A');
				const pending = operation === 'attachment'
					? client.attachToProcess(1, { prompt: 'stale' }, 'stale owner', 'owner A', 1234)
					: client.setAutoReplies(1, {}, 'owner A');
				try {
					if (transfer === 'host restart') {
						current = allocation('owner B');
						await current.service.setAutoReplies(1, { prompt: 'peer' }, 'owner B');
					} else {
						await current.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'owner B', 'owner A');
					}
					strictEqual(delivered, 0);
					await delivery.complete();
					if (operation === 'attachment') {
						await rejects(pending);
					} else {
						await pending;
					}
					strictEqual(delivered, 1);
					deepStrictEqual(current.settings.get(1), { prompt: 'peer' });
					await client.setAutoReplies(1, { prompt: 'updated peer' }, 'owner B');
					deepStrictEqual(current.settings.get(1), { prompt: 'updated peer' });
					await client.setAutoReplies(1, {});
					deepStrictEqual(current.settings.get(1), { prompt: 'updated peer' });
					await client.shutdown(1, true, 'owner A');
					deepStrictEqual(shutdowns, []);
					strictEqual(current.allocations.get(1)?.processLaunchOptions.options.creationId, 'owner B');
					await client.shutdown(1, true, 'owner B');
					deepStrictEqual({ allocation: current.allocations.has(1), settings: current.settings.get(1) }, { allocation: false, settings: undefined });
					current = allocation('control allocation');
					await client.attachToProcess(1, { prompt: 'valid transfer' }, 'owner C', 'control allocation', 1234);
					await client.setAutoReplies(1, { prompt: 'updated transfer' }, 'owner C');
					deepStrictEqual(current.settings.get(1), { prompt: 'updated transfer' });
					await client.shutdown(1, true, 'owner C');
					deepStrictEqual(shutdowns, [true, true]);
				} finally {
					await delivery.complete();
					try {
						await pending.catch(() => { });
					} finally {
						for (const dispose of cleanup) {
							dispose();
						}
					}
				}
			});
		}
	}
});
