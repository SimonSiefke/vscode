/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChatContextPickService } from '../../../contrib/chat/browser/attachments/chatContextPickService.js';
import { ChatContextService } from '../../../contrib/chat/browser/contextContrib/chatContextService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { MainThreadChatContext } from '../../browser/mainThreadChatContext.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadChatContext', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createBridge() {
		const service = store.add(new ChatContextService(new class extends mock<IChatContextPickService>() { }, new class extends mock<IExtensionService>() { }));
		const mainThread = store.add(new MainThreadChatContext(SingleProxyRPCProtocol(null), service));
		return { service, mainThread };
	}

	for (const sibling of ['attachment', 'tab'] as const) {
		test(`disposing a ${sibling} provider preserves workspace context with the same ID`, () => {
			const { service, mainThread } = createBridge();
			mainThread.$registerChatWorkspaceContextProvider(1, 'shared');
			if (sibling === 'attachment') {
				mainThread.$registerChatExplicitContextProvider(2, 'shared');
			} else {
				mainThread.$registerChatResourceContextProvider(2, 'shared', { uri: [{ language: '*' }] });
			}
			mainThread.$updateWorkspaceContextItems(1, [{ handle: 10, label: 'workspace', value: 'context' }]);
			const before = service.getWorkspaceContextItems();
			mainThread.$unregisterChatContextProvider(2);
			assert.deepStrictEqual(service.getWorkspaceContextItems(), before);
			mainThread.$unregisterChatContextProvider(1);
			assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
		});
	}

	test('workspace disposal removes only its own context and ignores late updates', () => {
		const { service, mainThread } = createBridge();
		mainThread.$registerChatWorkspaceContextProvider(1, 'removed');
		mainThread.$registerChatWorkspaceContextProvider(2, 'live');
		mainThread.$updateWorkspaceContextItems(2, [{ handle: 20, label: 'live', value: 'live context' }]);
		const live = service.getWorkspaceContextItems();
		for (let cycle = 0; cycle < 37; cycle++) {
			mainThread.$registerChatWorkspaceContextProvider(1, 'removed');
			mainThread.$updateWorkspaceContextItems(1, [{ handle: 10, label: 'removed', value: 'removed context' }]);
			mainThread.$unregisterChatContextProvider(1);
			mainThread.$updateWorkspaceContextItems(1, [{ handle: 10, label: 'late', value: 'late context' }]);
			assert.deepStrictEqual(service.getWorkspaceContextItems(), live);
		}
	});
});
