/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChatContextItemDto, MainThreadChatContextShape } from '../../common/extHost.protocol.js';
import { ExtHostChatContext } from '../../common/extHostChatContext.js';
import { IExtHostCommands } from '../../common/extHostCommands.js';
import { IExtHostEditorTabs } from '../../common/extHostEditorTabs.js';
import { TextTabInput } from '../../common/extHostTypes.js';
import { SingleProxyRPCProtocol } from './testRPCProtocol.js';

suite('Chat context provider teardown', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const uri = URI.file('/context.txt');
	let service: ExtHostChatContext;
	let handle: number;
	let updates: IChatContextItemDto[][];

	setup(() => {
		updates = [];
		const tab = new class extends mock<vscode.Tab>() { override readonly input = new TextTabInput(uri); };
		const group = new class extends mock<vscode.TabGroup>() { override readonly tabs = [tab]; };
		service = store.add(new ExtHostChatContext(SingleProxyRPCProtocol(new class extends mock<MainThreadChatContextShape>() {
			override $registerChatWorkspaceContextProvider(value: number): void { handle = value; }
			override $registerChatExplicitContextProvider(value: number): void { handle = value; }
			override $registerChatResourceContextProvider(value: number): void { handle = value; }
			override $unregisterChatContextProvider(): void { }
			override $updateWorkspaceContextItems(_handle: number, items: IChatContextItemDto[]): void { updates.push(items); }
		}), new class extends mock<IExtHostCommands>() { }, new class extends mock<IExtHostEditorTabs>() {
			override readonly tabGroups = new class extends mock<vscode.TabGroups>() { override readonly all = [group]; };
		}));
	});

	test('ignores a workspace result arriving after unregistration', async () => {
		const pending = new DeferredPromise<vscode.ChatContextItem[]>();
		const registration = store.add(service.registerChatWorkspaceContextProvider('workspace', { provideWorkspaceChatContext: () => pending.p }));
		const request = service.$provideWorkspaceChatContext(handle, CancellationToken.None);
		registration.dispose();
		await pending.complete([{ label: 'late', value: 'old provider' }]);
		assert.deepStrictEqual(await request, []);
	});

	test('ignores an attachment result arriving after unregistration', async () => {
		const pending = new DeferredPromise<vscode.ChatContextItem[]>();
		const registration = store.add(service.registerChatAttachContextProvider('attach', { provideAttachChatContext: () => pending.p, resolveAttachChatContext: item => item }));
		const request = service.$provideExplicitChatContext(handle, CancellationToken.None);
		registration.dispose();
		await pending.complete([{ label: 'late', value: 'old provider' }]);
		assert.deepStrictEqual(await request, []);
	});

	test('ignores a tab result arriving after unregistration', async () => {
		const pending = new DeferredPromise<vscode.ChatContextItem>();
		const registration = store.add(service.registerChatTabContextProvider({ uri: '*' }, 'tab', { provideChatTabContext: () => pending.p, resolveChatTabContext: item => item }));
		const request = service.$provideResourceChatContext(handle, { resource: uri, withValue: false }, CancellationToken.None);
		registration.dispose();
		await pending.complete({ label: 'late', value: 'old provider' });
		assert.strictEqual(await request, undefined);
	});

	test('does not publish the initial workspace fetch after unregistration', async () => {
		const pending = new DeferredPromise<vscode.ChatContextItem[]>();
		const changed = store.add(new Emitter<void>());
		const registration = store.add(service.registerChatWorkspaceContextProvider('initial', {
			onDidChangeWorkspaceChatContext: changed.event,
			provideWorkspaceChatContext: () => pending.p
		}));
		registration.dispose();
		await pending.complete([{ label: 'late', value: 'old provider' }]);
		await timeout(0);
		assert.deepStrictEqual(updates, []);
	});

	test('still returns results while the provider is registered', async () => {
		store.add(service.registerChatWorkspaceContextProvider('active', { provideWorkspaceChatContext: () => [{ label: 'current', value: 'active provider' }] }));
		const result = await service.$provideWorkspaceChatContext(handle, CancellationToken.None);
		assert.deepStrictEqual(result.map(item => ({ label: item.label, value: item.value })), [{ label: 'current', value: 'active provider' }]);
	});
});
