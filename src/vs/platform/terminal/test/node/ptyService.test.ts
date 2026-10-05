/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert, { deepStrictEqual, rejects } from 'assert';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ISetTerminalLayoutInfoArgs } from '../../common/terminalProcess.js';
import { PtyService, XtermSerializer } from '../../node/ptyService.js';
import { SerializeAddon } from '@xterm/addon-serialize';
import pkg from '@xterm/headless';
import { createSandbox } from 'sinon';
import { toDisposable } from '../../../../base/common/lifecycle.js';

suite('PtyService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class TestPtyService extends mock<Pick<PtyService, 'setTerminalLayoutInfo' | 'traceRpcArgs'>>() {
		readonly _workspaceLayoutInfos = new Map<string, ISetTerminalLayoutInfoArgs>();
		override get traceRpcArgs() { return { logService: new NullLogService(), simulatedLatency: 0 }; }
		override setTerminalLayoutInfo = PtyService.prototype.setTerminalLayoutInfo;
	}

	for (const background of [null, []]) {
		test(`clears empty workspace layouts with ${background === null ? 'null' : 'empty'} background terminals`, async () => {
			const service = new TestPtyService();
			const otherLayout = { workspaceId: 'other', tabs: [], background: [2] };
			await service.setTerminalLayoutInfo(otherLayout);
			await service.setTerminalLayoutInfo({ workspaceId: 'test', tabs: [], background: [1] });
			await service.setTerminalLayoutInfo({ workspaceId: 'test', tabs: [], background });

			assert.deepStrictEqual([...service._workspaceLayoutInfos.values()], [otherLayout]);
		});
	}

	test('preserves layouts with background terminals', async () => {
		const service = new TestPtyService();
		const layout = { workspaceId: 'test', tabs: [], background: [1] };
		await service.setTerminalLayoutInfo(layout);

		assert.strictEqual(service._workspaceLayoutInfos.get('test'), layout);
	});

	test('preserves layouts with terminal tabs', async () => {
		const service = new TestPtyService();
		const layout = {
			workspaceId: 'test',
			tabs: [{ isActive: true, activePersistentProcessId: 1, terminals: [{ terminal: 1, relativeSize: 1 }] }],
			background: null
		};
		await service.setTerminalLayoutInfo(layout);

		assert.strictEqual(service._workspaceLayoutInfos.get('test'), layout);
	});
});

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
