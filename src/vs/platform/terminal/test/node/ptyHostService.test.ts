/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IChannel, IChannelClient } from '../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { NullLogService, NullLoggerService } from '../../../log/common/log.js';
import { createLocalPtyChannel } from '../../common/localPtyChannel.js';
import { IPtyHostConnection, IPtyHostStarter } from '../../node/ptyHost.js';
import { PtyHostService } from '../../node/ptyHostService.js';

suite('PtyHostService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('restartPtyHost disposes listeners registered during pty host startup', async () => {
		// Track active listener counts per event across pty host restarts. Without the
		// fix, each restart would leak the listeners registered in _startPtyHost.
		const listenerCounts = new Map<string, number>();
		const makeEvent = (name: string): Event<unknown> => (_listener: (e: unknown) => void): IDisposable => {
			listenerCounts.set(name, (listenerCounts.get(name) ?? 0) + 1);
			return { dispose: () => listenerCounts.set(name, listenerCounts.get(name)! - 1) };
		};

		const channel: IChannel = {
			call<T>(): Promise<T> { return Promise.resolve([] as unknown as T); },
			listen<T>(event: string): Event<T> { return makeEvent(event) as Event<T>; }
		};
		const client: IChannelClient = {
			getChannel<T extends IChannel>(): T { return channel as T; }
		};

		const starter: IPtyHostStarter = {
			start: (): IPtyHostConnection => ({
				client,
				store: new DisposableStore(),
				onDidProcessExit: Event.None
			}),
			dispose: () => { }
		};

		const service = store.add(new PtyHostService(
			starter,
			new TestConfigurationService(),
			new NullLogService(),
			store.add(new NullLoggerService())
		));
		const localChannel = createLocalPtyChannel(service, store.add(new DisposableStore()));
		const starts: { isRestart: boolean }[] = [];

		// _startPtyHost runs lazily on first use, so trigger one restart to spin up the
		// initial host and capture the listener counts after a single startup as the baseline.
		await service.restartPtyHost();
		const baseline = new Map(listenerCounts);
		store.add(localChannel.listen<{ isRestart: boolean }>('window', 'onPtyHostStart')(e => starts.push(e)));
		await timeout(0);

		for (let i = 0; i < 5; i++) {
			await service.restartPtyHost();
		}

		deepStrictEqual(
			{ listeners: [...listenerCounts.entries()].sort(), starts },
			{ listeners: [...baseline.entries()].sort(), starts: [{ isRestart: false }, ...Array.from({ length: 5 }, () => ({ isRestart: true }))] },
			'restarts should notify the local channel without accumulating startup listeners'
		);
	});

	test('forwards process-scoped auto replies through the local pty channel', async () => {
		const calls: { command: string; args: unknown }[] = [];
		const channel: IChannel = {
			call<T>(command: string, args: unknown): Promise<T> {
				if (command === 'setAutoReplies' || command === 'attachToProcess' || command === 'shutdown' || command === 'getRevivedPtyProcessIdentity' || command === 'acceptDetachInstanceReply') {
					calls.push({ command, args });
				}
				return Promise.resolve([] as T);
			},
			listen: () => Event.None
		};
		const starter: IPtyHostStarter = {
			start: () => ({
				client: { getChannel: <T extends IChannel>() => channel as T },
				store: new DisposableStore(),
				onDidProcessExit: Event.None
			}),
			dispose: () => { }
		};
		const service = store.add(new PtyHostService(
			starter,
			new TestConfigurationService(),
			new NullLogService(),
			store.add(new NullLoggerService())
		));
		const localChannel = createLocalPtyChannel(service, store.add(new DisposableStore()));
		await localChannel.call('window A', 'setAutoReplies', [1, { 'A prompt': 'A reply' }, 'A']);
		await localChannel.call('window B', 'setAutoReplies', [2, { 'B prompt': 'B reply' }, 'B']);
		await localChannel.call('window B', 'setAutoReplies', [2, {}, 'B']);
		await localChannel.call('window A', 'attachToProcess', [1, 1234, { prompt: 'restored' }, 'restored', 'original']);
		await localChannel.call('window A', 'shutdown', [1, true, 'creation']);
		await localChannel.call('window A', 'getRevivedPtyProcessIdentity', ['workspace', 7, 'saved']);
		await localChannel.call('window A', 'acceptDetachInstanceReply', [8, 1, 'source']);
		await timeout(0);

		deepStrictEqual(calls, [
			{ command: 'setAutoReplies', args: [1, { 'A prompt': 'A reply' }, 'A'] },
			{ command: 'setAutoReplies', args: [2, { 'B prompt': 'B reply' }, 'B'] },
			{ command: 'setAutoReplies', args: [2, {}, 'B'] },
			{ command: 'attachToProcess', args: [1, 1234, { prompt: 'restored' }, 'restored', 'original'] },
			{ command: 'shutdown', args: [1, true, 'creation'] },
			{ command: 'getRevivedPtyProcessIdentity', args: ['workspace', 7, 'saved'] },
			{ command: 'acceptDetachInstanceReply', args: [8, 1, 'source'] }
		]);
	});
});
