/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { SessionsTerminalContribution } from '../../browser/sessionsTerminalContribution.js';
import sinon from 'sinon';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { EditorResolverService } from '../../../../../workbench/services/editor/browser/editorResolverService.js';
import { EditorService } from '../../../../../workbench/services/editor/browser/editorService.js';
import { IEditorGroupsService, GroupDirection } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../../workbench/services/editor/common/editorResolverService.js';
import { createEditorPart, registerTestEditor, workbenchInstantiationService, workbenchTeardown } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { TerminalEditorInput } from '../../../../../workbench/contrib/terminal/browser/terminalEditorInput.js';

import { DeferredPromise } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ITerminalCapabilityStore } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';
import { IRemoteAgentService } from '../../../../../workbench/services/remote/common/remoteAgentService.js';
import { IEditorService } from '../../../../../workbench/services/editor/common/editorService.js';
import { IEditorPane } from '../../../../../workbench/common/editor.js';
import { ITerminalEditorService, ITerminalInstance, ITerminalInstanceService, ITerminalService, terminalEditorId } from '../../../../../workbench/contrib/terminal/browser/terminal.js';
import { TerminalEditorService } from '../../../../../workbench/contrib/terminal/browser/terminalEditorService.js';
import { TerminalService } from '../../../../../workbench/contrib/terminal/browser/terminalService.js';
import { ITerminalStatusList } from '../../../../../workbench/contrib/terminal/browser/terminalStatusList.js';

suite('Sessions - terminal editor ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => sinon.restore());

	function makeInstance(id: number): ITerminalInstance {
		const onDisposed = store.add(new Emitter<ITerminalInstance>());
		const onExit = store.add(new Emitter<number | undefined>());
		return new class extends mock<ITerminalInstance>() {
			override readonly instanceId = id;
			override readonly resource = URI.from({ scheme: 'vscode-terminal', path: `/queued-test/${id}` });
			override target = TerminalLocation.Editor;
			override isDisposed = false;
			override readonly hasChildProcesses = false;
			override readonly waitOnExit = false;
			override readonly description = undefined;
			override readonly shellLaunchConfig = {};
			override readonly capabilities = new class extends mock<ITerminalCapabilityStore>() {
				override readonly onDidChangeCapabilities = Event.None;
			};
			override readonly statusList = new class extends mock<ITerminalStatusList>() {
				override readonly onDidChangePrimaryStatus = Event.None;
			};
			override readonly onDidFocus = Event.None;
			override readonly onDidBlur = Event.None;
			override readonly onTitleChanged = Event.None;
			override readonly onIconChanged = Event.None;
			override readonly onDisposed = onDisposed.event;
			override readonly onExit = onExit.event;
			override detachFromElement(): void { }
			override setParentContextKeyService(): void { }
			override dispose(): void {
				if (!this.isDisposed) {
					this.isDisposed = true;
					onDisposed.fire(this);
					onExit.fire(undefined);
				}
			}
		};
	}

	test('detaches and disposes a queued terminal without opening or retaining its old input', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(ITerminalInstanceService, 'getBackend', undefined);
		instantiationService.stub(ITerminalInstanceService, 'getRegisteredBackends', []);
		instantiationService.stub(IRemoteAgentService, 'getConnection', null);
		const editors = store.add(instantiationService.createInstance(TerminalEditorService));
		instantiationService.stub(ITerminalEditorService, editors);
		const terminals = store.add(instantiationService.createInstance(TerminalService));
		instantiationService.stub(ITerminalService, terminals);

		const firstEntered = new DeferredPromise<void>();
		const firstOpen = new DeferredPromise<IEditorPane | undefined>();
		let calls = 0;
		instantiationService.stub(IEditorService, 'openEditor', () => {
			calls++;
			if (calls === 1) {
				void firstEntered.complete();
				return firstOpen.p;
			}
			return Promise.resolve(undefined);
		});
		const first = makeInstance(1);
		const firstOpening = editors.openEditor(first);
		await firstEntered.p;
		const trackedInputs = Reflect.get(editors, '_editorInputs') as Map<string, object>;
		const trackedDisposables = Reflect.get(editors, '_instanceDisposables') as Map<string, object>;
		let forwardedDisposals = 0;
		store.add(terminals.onDidDisposeInstance(() => forwardedDisposals++));

		const pending: Promise<void>[] = [];
		const queuedInstances: ITerminalInstance[] = [];
		const editorService = instantiationService.invokeFunction(accessor => accessor.get(IEditorService));
		const closeTerminal = Reflect.get(SessionsTerminalContribution.prototype, '_closeTerminal') as (this: { _terminalService: TerminalService; _editorService: IEditorService }, instance: ITerminalInstance) => Promise<void>;
		try {
			for (let i = 0; i < 37; i++) {
				const queued = makeInstance(i + 2);
				const opening = editors.openEditor(queued);
				pending.push(opening);
				queuedInstances.push(queued);
				const input = editors.getInputFromResource(queued.resource);
				assert.deepStrictEqual([editors.instances.length, trackedInputs.size, trackedDisposables.size], [2, 2, 2]);
				// Exercise the contribution close path against the actual terminal and input owners.
				await closeTerminal.call({ _terminalService: terminals, _editorService: editorService }, queued);
				assert.strictEqual(input.isDisposed(), true);
				assert.strictEqual(input.terminalInstance, undefined);

				assert.deepStrictEqual([queued.isDisposed, editors.instances.length, trackedInputs.size, trackedDisposables.size, terminals.instances.includes(queued)], [true, 1, 1, 1, false]);
				// Save and drain queued promises when the first request is released below.
			}
		} finally {
			for (const queued of queuedInstances) {
				editors.detachInstance(queued);
				queued.dispose();
			}
			await firstOpen.complete(undefined);
			await Promise.all([firstOpening, ...pending]);
			editors.detachInstance(first);
			first.dispose();
		}
		assert.deepStrictEqual([calls, forwardedDisposals, editors.instances.length, trackedInputs.size, trackedDisposables.size], [1, 37, 0, 0, 0]);
		const control = makeInstance(100);
		try {
			await editors.openEditor(control);
			assert.deepStrictEqual([calls, editors.instances.length, trackedInputs.size, trackedDisposables.size], [2, 1, 1, 1]);
			assert.strictEqual(editors.getInputFromResource(control.resource).terminalInstance, control);
		} finally {
			editors.detachInstance(control);
			control.dispose();
		}
	});

	async function createRealEditorOwners() {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(ITerminalInstanceService, 'getBackend', undefined);
		instantiationService.stub(ITerminalInstanceService, 'getRegisteredBackends', []);
		instantiationService.stub(IRemoteAgentService, 'getConnection', null);
		const part = await createEditorPart(instantiationService, store.add(new DisposableStore()));
		instantiationService.stub(IEditorGroupsService, part);
		const resolver = store.add(instantiationService.createInstance(EditorResolverService));
		instantiationService.stub(IEditorResolverService, resolver);
		const editorService = store.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);
		const editors = store.add(instantiationService.createInstance(TerminalEditorService));
		instantiationService.stub(ITerminalEditorService, editors);
		const terminals = store.add(instantiationService.createInstance(TerminalService));
		instantiationService.stub(ITerminalService, terminals);
		store.add(registerTestEditor('test.terminal-owner-pane', [new SyncDescriptor(TerminalEditorInput)]));
		let missingInputRequests = 0;
		store.add(resolver.registerEditor('vscode-terminal:/**', {
			id: terminalEditorId, label: 'Terminal Test', priority: RegisteredEditorPriority.exclusive,
		}, { singlePerResource: true }, {
			createEditorInput: ({ resource }) => {
				if (!editors.getInstanceFromResource(resource)) {
					missingInputRequests++;
				}
				return { editor: editors.getInputFromResource(resource) };
			},
		}));
		return { instantiationService, part, editorService, editors, terminals, resolver, missingInputRequests: () => missingInputRequests };
	}

	test('a submitted fresh terminal never resolves its detached resource after opening resumes', async () => {
		const owners = await createRealEditorOwners();
		const { part, editorService, editors, terminals, instantiationService, resolver } = owners;
		const group = part.activeGroup;
		const entered = new DeferredPromise<void>();
		const release = new DeferredPromise<void>();
		const realResolve = resolver.resolveEditor.bind(resolver);
		const pendingResolver = sinon.stub(resolver, 'resolveEditor').callsFake(async (editor, preferredGroup) => {
			await entered.complete();
			await release.p;
			return realResolve(editor, preferredGroup);
		});
		const realOpen = group.openEditor.bind(group);
		const pendingGroup = sinon.stub(group, 'openEditor').callsFake(async (editor, options) => {
			await entered.complete();
			await release.p;
			return realOpen(editor, options);
		});
		const instance = makeInstance(701);
		const opening = editors.openEditor(instance);
		// Observe rejection immediately while the two real opening boundaries are held.
		const result = opening.then(() => undefined, error => error as Error);
		try {
			await entered.p;
			const input = editors.getInputFromResource(instance.resource);
			assert.strictEqual(editorService.findEditors(instance.resource).length, 0);
			terminals.moveToBackground(instance);
			await terminals.safeDisposeTerminal(instance);
			assert.deepStrictEqual([input.isDisposed(), input.terminalInstance, editors.instances.length, (Reflect.get(editors, '_editorInputs') as Map<string, object>).size, (Reflect.get(editors, '_instanceDisposables') as Map<string, object>).size], [true, undefined, 0, 0, 0]);
			await release.complete();
			const error = await result;
			assert.deepStrictEqual({ error: error?.message, missingInputRequests: owners.missingInputRequests(), groupCount: group.count, openEditors: editorService.findEditors(instance.resource).length, instances: terminals.instances.length }, { error: undefined, missingInputRequests: 0, groupCount: 0, openEditors: 0, instances: 0 });
		} finally {
			await release.complete();
			await result;
			pendingResolver.restore();
			pendingGroup.restore();
			editors.detachInstance(instance);
			instance.dispose();
			await workbenchTeardown(instantiationService);
		}
	});

	test('the already-open terminal still moves its same input to an explicit group once', async () => {
		const owners = await createRealEditorOwners();
		const { part, editorService, editors, instantiationService } = owners;
		const instance = makeInstance(702);
		try {
			await editors.openEditor(instance);
			const input = editors.getInputFromResource(instance.resource);
			const first = part.activeGroup;
			const second = part.addGroup(first, GroupDirection.RIGHT);
			assert.strictEqual(editorService.findEditors(instance.resource).length, 1);
			await editors.openEditor(instance, { viewColumn: second.id });
			assert.deepStrictEqual({
				locations: editorService.findEditors(instance.resource).map(identifier => ({ group: identifier.groupId, same: identifier.editor === input })),
				oldCount: first.count,
				newCount: second.count,
				instances: editors.instances.length,
			}, { locations: [{ group: second.id, same: true }], oldCount: 0, newCount: 1, instances: 1 });
			// Existing-input fast path in the real resolver may move/reuse before invoking factory.
			// Assert exactly one input and owner, rather than demanding a positive factory-call count.
			await editors.openEditor(instance, { viewColumn: second.id });
			assert.deepStrictEqual([editorService.findEditors(instance.resource).length, second.count, editors.instances.length], [1, 1, 1]);
		} finally {
			await editorService.closeEditors([...editorService.findEditors(instance.resource)]);
			editors.detachInstance(instance);
			instance.dispose();
			await workbenchTeardown(instantiationService);
		}
	});
});
