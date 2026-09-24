/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ISetTerminalLayoutInfoArgs } from '../../common/terminalProcess.js';
import { PtyService } from '../../node/ptyService.js';

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
