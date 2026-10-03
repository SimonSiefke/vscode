/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IChatContextPickService } from '../../browser/attachments/chatContextPickService.js';
import { ChatContextService } from '../../browser/contextContrib/chatContextService.js';

suite('Chat workspace context provider teardown', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let service: ChatContextService;

	setup(() => {
		service = store.add(new ChatContextService(new class extends mock<IChatContextPickService>() { }, new class extends mock<IExtensionService>() { }));
	});

	function register(id: string, value: string): void {
		service.registerChatWorkspaceContextProvider(id, { provideWorkspaceChatContext: async () => [] });
		service.updateWorkspaceContextItems(id, [{ handle: 1, label: id, value }]);
	}

	test('removes workspace context when its provider is unregistered', () => {
		register('retired', 'old provider value');
		service.unregisterChatContextProvider('retired');
		assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
	});

	test('preserves context from other registered providers', () => {
		register('retired', 'old provider value');
		register('active', 'current provider value');
		service.unregisterChatContextProvider('retired');
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['current provider value']);
	});

	test('does not reuse old context if the same provider ID is registered again', () => {
		register('reused', 'old provider value');
		service.unregisterChatContextProvider('reused');
		service.registerChatWorkspaceContextProvider('reused', { provideWorkspaceChatContext: async () => [] });
		assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
	});
});
