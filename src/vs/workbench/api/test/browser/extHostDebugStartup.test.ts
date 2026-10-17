/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../../base/common/async.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../base/test/common/mock.js';
import { IDebugAdapter } from '../../../contrib/debug/common/debug.js';
import { ExtensionDescriptionRegistry } from '../../../services/extensions/common/extensionDescriptionRegistry.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { IDebugSessionDto, MainThreadDebugServiceShape } from '../../common/extHost.protocol.js';
import { IExtHostCommands } from '../../common/extHostCommands.js';
import { IExtHostConfiguration } from '../../common/extHostConfiguration.js';
import { ExtHostDebugServiceBase } from '../../common/extHostDebugService.js';
import { IExtHostEditorTabs } from '../../common/extHostEditorTabs.js';
import { IExtHostExtensionService } from '../../common/extHostExtensionService.js';
import { IExtHostTesting } from '../../common/extHostTesting.js';
import { DebugAdapterInlineImplementation } from '../../common/extHostTypes.js';
import { IExtHostVariableResolverProvider } from '../../common/extHostVariableResolverService.js';
import { IExtHostWorkspace } from '../../common/extHostWorkspace.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

// The existing startup path ignores the return values of its own error/exit
// subscriptions. Assert actual cache/publisher cleanup instead of tracking those
// unowned subscription wrappers, whose emitters are disposed by the adapter.
// eslint-disable-next-line local/code-ensure-no-disposables-leak-in-test
suite('Extension host debug adapter startup disposal', () => {
	const store = new DisposableStore();
	teardown(() => store.clear());
	suiteTeardown(() => store.dispose());
	const extension = { ...nullExtensionDescription, contributes: { debuggers: [{ type: 'startup-disposal', label: 'Startup Disposal' }] } };
	const session: IDebugSessionDto = { id: 'startup-disposal', type: 'startup-disposal', name: 'Startup Disposal', parent: undefined, folderUri: undefined, configuration: { type: 'startup-disposal', request: 'launch', name: 'Startup Disposal' } };

	function createService() {
		const proxy = new class extends mock<MainThreadDebugServiceShape>() {
			override $registerDebugTypes(): void { }
			override $registerDebugAdapterDescriptorFactory(): Promise<void> { return Promise.resolve(); }
			override $unregisterDebugAdapterDescriptorFactory(): void { }
			override $sessionCached(): void { }
		};
		return store.add(new class extends ExtHostDebugServiceBase { }(
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

	function createImplementation() {
		const emitter = store.add(new Emitter<vscode.DebugProtocolMessage>());
		let disposed = 0;
		const received: vscode.DebugProtocolMessage[] = [];
		const descriptor = new DebugAdapterInlineImplementation({
			onDidSendMessage: emitter.event,
			handleMessage: message => received.push(message),
			dispose() { disposed++; }
		});
		return { descriptor, received, observe: () => ({ listeners: emitter.hasListeners(), disposed }) };
	}

	function observe(service: ExtHostDebugServiceBase) {
		const adapters: Map<number, IDebugAdapter> = Reflect.get(service, '_debugAdapters');
		const trackers: Map<number, vscode.DebugAdapterTracker> = Reflect.get(service, '_debugAdaptersTrackers');
		const starts: Map<number, object> | undefined = Reflect.get(service, '_debugAdapterStartRequests');
		return { adapters: adapters.size, trackers: trackers.size, starts: starts?.size ?? 0 };
	}

	test('stopping while a descriptor is pending disposes the late implementation', async () => {
		const service = createService();
		const implementation = createImplementation();
		const entered = new DeferredPromise<void>();
		const descriptor = new DeferredPromise<vscode.DebugAdapterDescriptor>();
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'startup-disposal', {
			createDebugAdapterDescriptor() { entered.complete(); return descriptor.p; }
		}));
		const startup = service.$startDASession(1, session).catch(error => error);
		try {
			await entered.p;
			await service.$stopDASession(1);
			descriptor.complete(implementation.descriptor);
			const result = await startup;
			assert.deepStrictEqual({ cancelled: isCancellationError(result), ...observe(service), ...implementation.observe() }, { cancelled: true, adapters: 0, trackers: 0, starts: 0, listeners: false, disposed: 1 });
		} finally {
			descriptor.complete(implementation.descriptor);
			await startup;
			await service.$stopDASession(1);
		}
	});

	test('stopping while trackers are pending does not retain or start the late tracker', async () => {
		const service = createService();
		const implementation = createImplementation();
		const entered = new DeferredPromise<void>();
		const tracker = new DeferredPromise<vscode.DebugAdapterTracker>();
		let started = 0;
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'startup-disposal', { createDebugAdapterDescriptor: () => implementation.descriptor }));
		store.add(service.registerDebugAdapterTrackerFactory('startup-disposal', {
			createDebugAdapterTracker() { entered.complete(); return tracker.p; }
		}));
		const startup = service.$startDASession(1, session).catch(error => error);
		try {
			await entered.p;
			await service.$stopDASession(1);
			tracker.complete({ onWillStartSession: () => started++ });
			const result = await startup;
			assert.deepStrictEqual({ cancelled: isCancellationError(result), ...observe(service), ...implementation.observe(), started }, { cancelled: true, adapters: 0, trackers: 0, starts: 0, listeners: false, disposed: 1, started: 0 });
		} finally {
			tracker.complete({});
			await startup;
			await service.$stopDASession(1);
		}
	});

	test('stopping before the session lookup finishes does not invoke its factory', async () => {
		const service = createService();
		let invoked = 0;
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'startup-disposal', {
			createDebugAdapterDescriptor() { invoked++; return undefined; }
		}));
		const startup = service.$startDASession(1, session).catch(error => error);
		await service.$stopDASession(1);
		const result = await startup;
		assert.deepStrictEqual({ cancelled: isCancellationError(result), invoked, ...observe(service) }, { cancelled: true, invoked: 0, adapters: 0, trackers: 0, starts: 0 });
	});

	test('a live session preserves adapter communication and tracker lifecycle', async () => {
		const service = createService();
		const implementation = createImplementation();
		const lifecycle: string[] = [];
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'startup-disposal', { createDebugAdapterDescriptor: () => implementation.descriptor }));
		store.add(service.registerDebugAdapterTrackerFactory('startup-disposal', {
			createDebugAdapterTracker: () => ({ onWillStartSession: () => lifecycle.push('start'), onWillStopSession: () => lifecycle.push('stop') })
		}));
		try {
			await service.$startDASession(1, session);
			const message: DebugProtocol.Request = { type: 'request', seq: 1, command: 'threads' };
			service.$sendDAMessage(1, message);
			assert.deepStrictEqual({ ...observe(service), received: implementation.received, lifecycle }, { adapters: 1, trackers: 1, starts: 0, received: [message], lifecycle: ['start'] });
			await service.$stopDASession(1);
			assert.deepStrictEqual({ ...observe(service), ...implementation.observe(), lifecycle }, { adapters: 0, trackers: 0, starts: 0, listeners: false, disposed: 1, lifecycle: ['start', 'stop'] });
		} finally {
			await service.$stopDASession(1);
		}
	});

	test('descriptor failure preserves the error and releases pending startup state', async () => {
		const service = createService();
		const error = new Error('descriptor rejected');
		store.add(service.registerDebugAdapterDescriptorFactory(extension, 'startup-disposal', { createDebugAdapterDescriptor: () => Promise.reject(error) }));
		await assert.rejects(service.$startDASession(1, session), candidate => candidate === error);
		assert.deepStrictEqual(observe(service), { adapters: 0, trackers: 0, starts: 0 });
	});
});
