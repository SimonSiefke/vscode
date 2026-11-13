/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects } from 'assert';
import { SerializeAddon } from '@xterm/addon-serialize';
import pkg from '@xterm/headless';
import { createSandbox } from 'sinon';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { PtyService, XtermSerializer } from '../../node/ptyService.js';
import { ITerminalChildProcess } from '../../common/terminal.js';
import { AutoRepliesPtyServiceContribution } from '../../node/terminalContrib/autoReplies/autoRepliesContribController.js';

suite('XtermSerializer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const sandbox = createSandbox();

	teardown(() => sandbox.restore());

	function createSerializer(rawReviveBuffer?: string) {
		const loadAddon = sandbox.spy(pkg.Terminal.prototype, 'loadAddon');
		const serializer = new XtermSerializer(80, 30, 100, '6', undefined, 'test-nonce', rawReviveBuffer, new NullLogService());
		const terminal: pkg.Terminal = loadAddon.firstCall.thisValue;
		store.add(toDisposable(() => terminal.dispose()));
		return { serializer, terminal };
	}

	test('releases each replay addon without changing the serialized screen', async () => {
		const { serializer, terminal } = createSerializer();
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		await new Promise<void>(resolve => terminal.write('replay-ready', resolve));
		const results = [];
		for (let index = 0; index < 3; index++) {
			const replay = await serializer.generateReplayEvent();
			results.push({ disposed: dispose.callCount, screen: replay.events[0].data });
		}
		deepStrictEqual(results, [
			{ disposed: 1, screen: 'replay-ready' },
			{ disposed: 2, screen: 'replay-ready' },
			{ disposed: 3, screen: 'replay-ready' }
		]);
	});

	test('releases each addon when serialization throws on repeated attempts', async () => {
		const { serializer } = createSerializer();
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		const failure = new Error('Serialization failed');
		sandbox.stub(SerializeAddon.prototype, 'serialize').throws(failure);
		const disposalCounts = [];
		for (let index = 0; index < 3; index++) {
			await rejects(serializer.generateReplayEvent(), error => error === failure);
			disposalCounts.push(dispose.callCount);
		}
		deepStrictEqual(disposalCounts, [1, 2, 3]);
	});

	test('releases the addon when reusing a saved screen', async () => {
		const { serializer } = createSerializer('saved screen');
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		const serialize = sandbox.spy(SerializeAddon.prototype, 'serialize');
		const replay = await serializer.generateReplayEvent(true, true);
		deepStrictEqual({ disposed: dispose.callCount, serialized: serialize.callCount, screen: replay.events[0].data }, { disposed: 1, serialized: 0, screen: 'saved screen' });
	});
});

suite('PtyService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('rejected attachment preserves peer replies and accepted attachment replaces them before replay', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		const data = store.add(new Emitter<string>());
		const replies: string[] = [];
		const process = new class extends mock<ITerminalChildProcess>() {
			override readonly onProcessData = data.event;
			override input(value: string): void { replies.push(value); }
		};
		const contribution: AutoRepliesPtyServiceContribution = Reflect.get(service, '_autoRepliesContribution');
		const ptys: Map<number, { pid: number; attach(): Promise<void>; shutdown(): void }> = Reflect.get(service, '_ptys');
		let attaches = 0;
		ptys.set(1, { pid: 1234, attach: async () => { attaches++; data.fire('prompt'); }, shutdown: () => { } });
		contribution.handleProcessReady(1, process);
		try {
			await service.setAutoReplies(1, { prompt: 'live owner' });
			await rejects(service.attachToProcess(1, 4321, { prompt: 'restoring window' }));
			data.fire('prompt');
			deepStrictEqual({ attaches, replies }, { attaches: 0, replies: ['live owner'] });
			await service.attachToProcess(1, 1234, { prompt: 'restoring window' });
			deepStrictEqual({ attaches, replies }, { attaches: 1, replies: ['live owner', 'restoring window'] });
		} finally {
			contribution.handleProcessDispose(1);
			await timeout(1100);
		}
	}));

	test('attachToProcess only attaches when the expected pid matches', async () => {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		let attachCount = 0;
		// Stand in for a running persistent process to avoid spawning a pty
		const ptys: Map<number, { pid: number; attach(): Promise<void>; shutdown(): void }> = Reflect.get(service, '_ptys');
		ptys.set(1, { pid: 1234, attach: async () => { attachCount++; }, shutdown: () => { } });

		async function attach(pid?: number): Promise<string> {
			try {
				await service.attachToProcess(1, pid);
				return 'attached';
			} catch {
				return 'rejected';
			}
		}
		const results = { otherPid: await attach(4321), samePid: await attach(1234), noPid: await attach() };

		deepStrictEqual({ ...results, attachCount }, { otherPid: 'rejected', samePid: 'attached', noPid: 'attached', attachCount: 2 });
	});
});
