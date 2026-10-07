/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Session } from 'inspector';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEditorTabGroupDto, MainThreadEditorTabsShape } from '../../common/extHost.protocol.js';
import { ExtHostEditorTabs } from '../../common/extHostEditorTabs.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostEditorTabs - garbage collection', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('a new group does not retain the model of a closed group', async () => {
		class ClosedGroupDto implements IEditorTabGroupDto {
			readonly groupId = 1;
			readonly isActive = true;
			readonly viewColumn = 1;
			readonly tabs = [];
		}

		const tabs = new ExtHostEditorTabs(SingleProxyRPCProtocol(new class extends mock<MainThreadEditorTabsShape>() { }));
		function replaceGroup(): WeakRef<ClosedGroupDto> {
			const previous = new ClosedGroupDto();
			tabs.$acceptEditorTabModel([previous]);
			tabs.$acceptEditorTabModel([{ groupId: 2, isActive: true, viewColumn: 2, tabs: [] }]);
			return new WeakRef(previous);
		}
		const previous = replaceGroup();

		// WeakRef targets stay alive until the end of the job that created them.
		await new Promise<void>(resolve => setImmediate(resolve));
		const inspector = new Session();
		inspector.connect();
		try {
			await new Promise<void>((resolve, reject) => inspector.post('HeapProfiler.collectGarbage', error => error ? reject(error) : resolve()));
		} finally {
			inspector.disconnect();
		}
		assert.strictEqual(previous.deref(), undefined, 'The replacement group retains the closed group');
		assert.strictEqual(tabs.tabGroups.all.length, 1);
		assert.strictEqual(tabs.tabGroups.activeTabGroup.isActive, true);
	});
});
