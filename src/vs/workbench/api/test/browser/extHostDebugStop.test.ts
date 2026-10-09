/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../base/test/common/mock.js';
import { AbstractDebugAdapter } from '../../../contrib/debug/common/abstractDebugAdapter.js';
import { IDebugAdapter } from '../../../contrib/debug/common/debug.js';
import { ExtensionDescriptionRegistry } from '../../../services/extensions/common/extensionDescriptionRegistry.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { IDebugSessionDto, MainThreadDebugServiceShape } from '../../common/extHost.protocol.js';
import { IExtHostCommands } from '../../common/extHostCommands.js';
import { IExtHostConfiguration } from '../../common/extHostConfiguration.js';
import { ExtHostDebugServiceBase, ExtHostDebugSession } from '../../common/extHostDebugService.js';
import { IExtHostEditorTabs } from '../../common/extHostEditorTabs.js';
import { IExtHostExtensionService } from '../../common/extHostExtensionService.js';
import { IExtHostTesting } from '../../common/extHostTesting.js';
import { DebugAdapterInlineImplementation } from '../../common/extHostTypes.js';
import { IExtHostVariableResolverProvider } from '../../common/extHostVariableResolverService.js';
import { IExtHostWorkspace } from '../../common/extHostWorkspace.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

// Existing startup ignores its onError/onExit subscription-return wrappers;
// assert actual adapter maps, publisher listeners and disposal instead. Their
// emitters are disposed normally, and all fixture resources have owned stores.
// eslint-disable-next-line local/code-ensure-no-disposables-leak-in-test
suite('Extension host debug tracker stop errors', () => {
	const store = new DisposableStore();
	teardown(() => store.clear());
	suiteTeardown(() => store.dispose());
	const extension = { ...nullExtensionDescription, contributes: { debuggers: [{ type: 'stop-error', label: 'Stop Error' }] } };
	const session: IDebugSessionDto = { id: 'stop-error', type: 'stop-error', name: 'Stop Error', parent: undefined, folderUri: undefined, configuration: { type: 'stop-error', request: 'launch', name: 'Stop Error' } };

	function createService(adapterOverride?: AbstractDebugAdapter) {
		const proxy = new class extends mock<MainThreadDebugServiceShape>() {
			override $registerDebugTypes(): void { }
			override $registerDebugAdapterDescriptorFactory(): Promise<void> { return Promise.resolve(); }
			override $unregisterDebugAdapterDescriptorFactory(): void { }
			override $sessionCached(): void { }
		};
		return store.add(new class extends ExtHostDebugServiceBase {
			protected override createDebugAdapter(descriptor: vscode.DebugAdapterDescriptor, debugSession: ExtHostDebugSession): AbstractDebugAdapter | undefined {
				return adapterOverride ?? super.createDebugAdapter(descriptor, debugSession);
			}
		}(
			SingleProxyRPCProtocol(proxy),
			new class extends mock<IExtHostWorkspace>() { },
			upcastPartial<IExtHostExtensionService>({
				async getExtensionRegistry(): Promise<ExtensionDescriptionRegistry> {
					return new class extends mock<ExtensionDescriptionRegistry>() {
						override readonly onDidChange = Event.None;
						override getAllExtensionDescriptions() { return []; }
					};
				}
			}),
			new class extends mock<IExtHostConfiguration>() { },
			new class extends mock<IExtHostEditorTabs>() { },
			new class extends mock<IExtHostVariableResolverProvider>() { },
			new class extends mock<IExtHostCommands>() { },
			new class extends mock<IExtHostTesting>() { }
		));
	}

	function createImplementation(onDispose: () => void = () => { }) {
		const emitter = store.add(new Emitter<vscode.DebugProtocolMessage>());
		let disposed = 0;
		const received: vscode.DebugProtocolMessage[] = [];
		const descriptor = new DebugAdapterInlineImplementation({
			onDidSendMessage: emitter.event,
			handleMessage: message => received.push(message),
			dispose() { disposed++; onDispose(); }
		});
		return { descriptor, received, observe: () => ({ listener: emitter.hasListeners(), disposed }) };
	}

	function register(service: ExtHostDebugServiceBase, descriptor: vscode.DebugAdapterDescriptor, onWillStopSession: () => void) {
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'stop-error', { createDebugAdapterDescriptor: () => descriptor }));
		store.add(service.registerDebugAdapterTrackerFactory('stop-error', { createDebugAdapterTracker: () => ({ onWillStopSession }) }));
	}

	function observe(service: ExtHostDebugServiceBase) {
		const adapters: Map<number, IDebugAdapter> = Reflect.get(service, '_debugAdapters');
		const trackers: Map<number, vscode.DebugAdapterTracker> = Reflect.get(service, '_debugAdaptersTrackers');
		return { adapters: adapters.size, trackers: trackers.size };
	}

	async function stopAndObserveError(service: ExtHostDebugServiceBase): Promise<Error | undefined> {
		try {
			await service.$stopDASession(1);
			return undefined;
		} catch (error) {
			if (!(error instanceof Error)) {
				throw error;
			}
			return error;
		}
	}

	test('a throwing tracker still releases the adapter and its publisher', async () => {
		const service = createService();
		const callbacks: string[] = [];
		const implementation = createImplementation(() => callbacks.push('adapter'));
		const error = new Error('tracker stop failed');
		register(service, implementation.descriptor, () => { callbacks.push('tracker'); throw error; });
		try {
			await service.$startDASession(1, session);
			const result = await stopAndObserveError(service);
			assert.deepStrictEqual({ ...observe(service), ...implementation.observe(), originalError: result === error, callbacks }, { adapters: 0, trackers: 0, listener: false, disposed: 1, originalError: true, callbacks: ['tracker', 'adapter'] });
		} finally {
			await stopAndObserveError(service);
		}
	});

	test('normal stop preserves communication and calls the tracker before disposal', async () => {
		const service = createService();
		const callbacks: string[] = [];
		const implementation = createImplementation(() => callbacks.push('adapter'));
		register(service, implementation.descriptor, () => callbacks.push('tracker'));
		try {
			await service.$startDASession(1, session);
			const message: DebugProtocol.Request = { type: 'request', seq: 1, command: 'threads' };
			service.$sendDAMessage(1, message);
			const error = await stopAndObserveError(service);
			assert.deepStrictEqual({ ...observe(service), ...implementation.observe(), error, received: implementation.received, callbacks }, { adapters: 0, trackers: 0, listener: false, disposed: 1, error: undefined, received: [message], callbacks: ['tracker', 'adapter'] });
		} finally {
			await stopAndObserveError(service);
		}
	});

	test('implementation disposal failure leaves no cache or publisher subscription', async () => {
		const service = createService();
		const error = new Error('implementation dispose failed');
		const implementation = createImplementation(() => { throw error; });
		register(service, implementation.descriptor, () => { });
		try {
			await service.$startDASession(1, session);
			const result = await stopAndObserveError(service);
			assert.deepStrictEqual({ ...observe(service), ...implementation.observe(), originalError: result === error }, { adapters: 0, trackers: 0, listener: false, disposed: 1, originalError: true });
		} finally {
			await stopAndObserveError(service);
		}
	});

	test('waits for asynchronous adapter cleanup before propagating the tracker error', async () => {
		const ready = new DeferredPromise<void>();
		let entered = false;
		let stopped = false;
		const adapter = store.add(new class extends AbstractDebugAdapter {
			startSession(): Promise<void> { return Promise.resolve(); }
			sendMessage(): void { }
			async stopSession(): Promise<void> { entered = true; await ready.p; stopped = true; this.dispose(); }
		});
		const service = createService(adapter);
		const implementation = createImplementation();
		const error = new Error('tracker stop failed');
		register(service, implementation.descriptor, () => { throw error; });
		await service.$startDASession(1, session);
		let settled = false;
		const stopping = stopAndObserveError(service).then(result => { settled = true; return result; });
		try {
			await timeout(0);
			assert.deepStrictEqual({ ...observe(service), entered, stopped, settled }, { adapters: 0, trackers: 0, entered: true, stopped: false, settled: false });
			ready.complete();
			const result = await stopping;
			assert.deepStrictEqual({ originalError: result === error, stopped, settled }, { originalError: true, stopped: true, settled: true });
		} finally {
			ready.complete();
			await stopping;
			await stopAndObserveError(service);
		}
	});

	test('stopping an unknown or already-stopped handle is harmless', async () => {
		const service = createService();
		const first = await stopAndObserveError(service);
		const second = await stopAndObserveError(service);
		assert.deepStrictEqual({ ...observe(service), first, second }, { adapters: 0, trackers: 0, first: undefined, second: undefined });
	});
});
