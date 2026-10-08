/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IChatContextPickService } from '../../browser/attachments/chatContextPickService.js';
import { ChatContextService } from '../../browser/contextContrib/chatContextService.js';

suite('ChatContextService workspace provider lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let service: ChatContextService;
	let pickerDisposals: number;

	setup(() => {
		pickerDisposals = 0;
		service = store.add(new ChatContextService(new class extends mock<IChatContextPickService>() {
			override registerChatContextItem() { return toDisposable(() => pickerDisposals++); }
		}, new class extends mock<IExtensionService>() { }));
	});

	function register(id: string, value: string): void {
		service.registerChatWorkspaceContextProvider(id, { provideWorkspaceChatContext: async () => [] });
		service.updateWorkspaceContextItems(id, [{ handle: 1, label: id, value }]);
	}

	test('keeps registered workspace content available', () => {
		register('first', 'current');
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['current']);
	});

	test('releases workspace content when its provider is unregistered', () => {
		register('first', 'obsolete');
		service.unregisterChatContextProvider('first');
		assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
	});

	test('preserves another registered provider when one is removed', () => {
		register('first', 'obsolete');
		register('second', 'current');
		service.unregisterChatContextProvider('first');
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['current']);
	});

	test('does not reuse removed content when the same id registers again', () => {
		register('first', 'obsolete');
		service.unregisterChatContextProvider('first');
		service.registerChatWorkspaceContextProvider('first', { provideWorkspaceChatContext: async () => [] });
		assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
	});

	test('allows new content after a registration is replaced', () => {
		register('first', 'obsolete');
		service.unregisterChatContextProvider('first');
		register('first', 'replacement');
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['replacement']);
	});

	test('repeated unregistration is harmless and leaves no content', () => {
		register('first', 'obsolete');
		service.unregisterChatContextProvider('first');
		service.unregisterChatContextProvider('first');
		assert.deepStrictEqual(service.getWorkspaceContextItems(), []);
	});

	test('removes content as well as a registered explicit picker', () => {
		register('first', 'obsolete');
		service.setChatContextProvider('first', { title: 'First', icon: ThemeIcon.fromId('symbol-variable') });
		service.registerChatExplicitContextProvider('first', {
			provideChatContext: async () => [],
			resolveChatContext: async item => item
		});
		service.unregisterChatContextProvider('first');
		assert.deepStrictEqual({ content: service.getWorkspaceContextItems(), pickerDisposals }, { content: [], pickerDisposals: 1 });
	});

	test('unknown provider removal preserves current content', () => {
		register('first', 'current');
		service.unregisterChatContextProvider('missing');
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['current']);
	});

	test('normal workspace updates replace only their own content', () => {
		register('first', 'old');
		register('second', 'independent');
		service.updateWorkspaceContextItems('first', [{ handle: 2, label: 'first', value: 'new' }]);
		assert.deepStrictEqual(service.getWorkspaceContextItems().map(item => item.value), ['new', 'independent']);
	});
});
