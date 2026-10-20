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
import { IEditorGroupsService, GroupDirection, IAuxiliaryEditorPart } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../../workbench/services/editor/common/editorResolverService.js';
import { createEditorPart, registerTestEditor, workbenchInstantiationService, workbenchTeardown } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { TerminalEditorInput } from '../../../../../workbench/contrib/terminal/browser/terminalEditorInput.js';

import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ITerminalCapabilityImplMap, ITerminalCapabilityStore, TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalLocation, TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';
import { IRemoteAgentService } from '../../../../../workbench/services/remote/common/remoteAgentService.js';
import { IEditorService, AUX_WINDOW_GROUP } from '../../../../../workbench/services/editor/common/editorService.js';
import { IEditorPane } from '../../../../../workbench/common/editor.js';
import { ITerminalEditorService, ITerminalInstance, ITerminalInstanceService, ITerminalService, terminalEditorId } from '../../../../../workbench/contrib/terminal/browser/terminal.js';
import { TerminalEditorService } from '../../../../../workbench/contrib/terminal/browser/terminalEditorService.js';
import { TerminalService } from '../../../../../workbench/contrib/terminal/browser/terminalService.js';
import { ITerminalStatusList } from '../../../../../workbench/contrib/terminal/browser/terminalStatusList.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService, IConfirmationResult } from '../../../../../platform/dialogs/common/dialogs.js';
import { IAgentHostTerminalService } from '../../../../../workbench/contrib/terminal/browser/agentHostTerminalService.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { IActiveSession, ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISession } from '../../../../services/sessions/common/session.js';

suite('Sessions - terminal editor ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => sinon.restore());

	function makeInstance(id: number, hasChildProcesses = false): ITerminalInstance {
		const onDisposed = store.add(new Emitter<ITerminalInstance>());
		const onExit = store.add(new Emitter<number | undefined>());
		return new class extends mock<ITerminalInstance>() {
			override readonly instanceId = id;
			override readonly resource = URI.from({ scheme: 'vscode-terminal', path: `/queued-test/${id}` });
			override target = TerminalLocation.Editor;
			override isDisposed = false;
			override readonly hasChildProcesses = hasChildProcesses;
			override readonly title = `terminal-${id}`;
			override readonly waitOnExit = false;
			override readonly description = undefined;
			override readonly shellLaunchConfig = {};
			override readonly capabilities = new class extends mock<ITerminalCapabilityStore>() {
				override readonly onDidChangeCapabilities = Event.None;
				override get<T extends TerminalCapability>(_capability: T): ITerminalCapabilityImplMap[T] | undefined { return undefined; }
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
			override resetFocusContextKey(): void { }
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

	for (const confirmed of [false, true]) {
		for (const visibilityStartedFirst of [false, true]) {
			for (const siblingCount of [1, 2]) {
				test(`preserves real editor confirmation ownership: confirmed=${confirmed}, staleVisibility=${visibilityStartedFirst}, siblings=${siblingCount}`, async () => {
					const owners = await createRealEditorOwners();
					const { instantiationService, editorService, editors, terminals } = owners;
					const configuration = instantiationService.invokeFunction(accessor => accessor.get(IConfigurationService)) as TestConfigurationService;
					await configuration.setUserConfiguration(TerminalSettingId.ConfirmOnKill, 'editor');
					const dialogService = instantiationService.invokeFunction(accessor => accessor.get(IDialogService));
					const promptEntered = Array.from({ length: siblingCount }, () => new DeferredPromise<void>());
					const promptResults = Array.from({ length: siblingCount }, () => new DeferredPromise<IConfirmationResult>());
					let promptCount = 0;
					const confirmDialog = sinon.stub(dialogService, 'confirm').callsFake(async () => {
						const index = promptCount++;
						assert.ok(promptResults[index], 'each draft terminal should request exactly one editor confirmation');
						await promptEntered[index].complete();
						return promptResults[index].p;
					});
					instantiationService.stub(ISessionsManagementService, new class extends mock<ISessionsManagementService>() {
						override readonly onDidReplaceNewDraftSession = Event.None;
						override readonly onDidDiscardNewSession = Event.None;
						override readonly onDidReplaceSession = Event.None;
						override readonly onDidChangeSessions = Event.None;
						override getSessions(): ISession[] { return []; }
					});
					instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
						override readonly activeSession = constObservable<IActiveSession | undefined>(undefined);
					});
					instantiationService.stub(ISessionsProvidersService, new class extends mock<ISessionsProvidersService>() {
						override getProvider(): undefined { return undefined; }
					});
					instantiationService.stub(IAgentHostTerminalService, new class extends mock<IAgentHostTerminalService>() {
						override readonly profiles = constObservable<never[]>([]);
						override setDefaultCwd(): void { }
						override getAgentHostAddress(): undefined { return undefined; }
					});
					const contribution = store.add(instantiationService.createInstance(SessionsTerminalContribution));
					const sessionTerminals = Reflect.get(contribution, '_sessionTerminals') as Map<string, Set<number>>;
					const scopes = Reflect.get(contribution, '_trackedTerminalScopes') as Map<number, { sessionId: string; key: string; agentHostAddress: string | undefined }>;
					const standalone = Reflect.get(contribution, '_standaloneTerminalIds') as Set<number>;
					const draftId = 'test:confirming-draft';
					const incomingId = 'test:incoming';
					const draftTerminals = Array.from({ length: siblingCount }, (_, index) => makeInstance(801 + index, true));
					const incoming = makeInstance(810);
					const originalInputs: TerminalEditorInput[] = [];
					const trackedInputs = Reflect.get(editors, '_editorInputs') as Map<string, TerminalEditorInput>;
					const trackedDisposables = Reflect.get(editors, '_instanceDisposables') as Map<string, object>;
					const opening = sinon.spy(editors, 'openEditor');
					const visibilityEntered = new DeferredPromise<void>();
					const releaseVisibility = new DeferredPromise<void>();
					const realShow = terminals.showBackgroundTerminal.bind(terminals);
					const pendingShow = sinon.stub(terminals, 'showBackgroundTerminal').callsFake(async (instance, suppressSetActive) => {
						if (instance === incoming) {
							await visibilityEntered.complete();
							await releaseVisibility.p;
						}
						await realShow(instance, suppressSetActive);
					});
					const closeDraft = Reflect.get(contribution, '_closeTerminalsForSession') as (sessionId: string, reason: string, protectActive: boolean) => Promise<void>;
					const updateVisibility = Reflect.get(contribution, '_updateTerminalVisibility') as (session: ISession, key: string, address: string | undefined, forceIds: number[]) => Promise<void>;
					const incomingSession = new class extends mock<ISession>() { override readonly sessionId = incomingId; };
					let closing = Promise.resolve();
					let visibility = Promise.resolve();
					try {
						for (const instance of draftTerminals) {
							await editors.openEditor(instance);
							originalInputs.push(editors.getInputFromResource(instance.resource));
							scopes.set(instance.instanceId, { sessionId: draftId, key: '/draft', agentHostAddress: undefined });
						}
						await editors.openEditor(incoming);
						scopes.set(incoming.instanceId, { sessionId: incomingId, key: '/incoming', agentHostAddress: undefined });
						sessionTerminals.set(draftId, new Set(draftTerminals.map(instance => instance.instanceId)));
						sessionTerminals.set(incomingId, new Set([incoming.instanceId]));
						const incomingInput = editors.getInputFromResource(incoming.resource);
						const incomingClosed = Event.toPromise(Event.filter(editorService.onDidCloseEditor, event => event.editor === incomingInput));
						terminals.moveToBackground(incoming);
						await incomingClosed;
						await editorService.openEditor(originalInputs[0], { pinned: true });
						if (visibilityStartedFirst) {
							visibility = updateVisibility.call(contribution, incomingSession, '/incoming', undefined, []);
							// Reaching toShow means every old draft terminal has already entered toHide.
							await visibilityEntered.p;
						}
						closing = closeDraft.call(contribution, draftId, 'test draft discarded', false);
						const closeObserved = closing.then(() => ({ kind: 'closed' as const }), error => ({ kind: 'error' as const, error }));
						const first = await Promise.race([promptEntered[0].p.then(() => ({ kind: 'prompt' as const })), closeObserved]);
						assert.deepStrictEqual(first, { kind: 'prompt' });
						if (!visibilityStartedFirst) {
							visibility = updateVisibility.call(contribution, incomingSession, '/incoming', undefined, []);
							await visibilityEntered.p;
						}
						await releaseVisibility.complete();
						await visibility;
						const pendingState = draftTerminals.map((instance, index) => ({
							live: !instance.isDisposed,
							inputLive: !originalInputs[index].isDisposed(),
							sameInput: trackedInputs.get(instance.resource.path) === originalInputs[index],
							attached: originalInputs[index].terminalInstance === instance,
							foreground: terminals.foregroundInstances.includes(instance),
						}));
						for (let index = 0; index < siblingCount; index++) {
							if (index > 0) {
								const next = await Promise.race([promptEntered[index].p.then(() => ({ kind: 'prompt' as const })), closeObserved]);
								assert.deepStrictEqual(next, { kind: 'prompt' }, 'an open editor sibling must keep its own confirmation');
							}
							await promptResults[index].complete({ confirmed });
						}
						await closing;
						await Promise.all(opening.returnValues);
						assert.deepStrictEqual({
							pendingState,
							promptCount,
							draftOwner: sessionTerminals.has(draftId),
							terminals: draftTerminals.map((instance, index) => ({
								live: !instance.isDisposed,
								inputLive: !originalInputs[index].isDisposed(),
								sameInput: trackedInputs.get(instance.resource.path) === originalInputs[index],
								liveInputAttachment: !originalInputs[index].isDisposed() && originalInputs[index].terminalInstance === instance,
								foreground: terminals.foregroundInstances.includes(instance),
								managed: editors.instances.includes(instance),
								inputOwner: trackedInputs.has(instance.resource.path),
								listenerOwner: trackedDisposables.has(instance.resource.path),
								openEditors: editorService.findEditors(instance.resource).length,
								standalone: standalone.has(instance.instanceId),
								scope: scopes.has(instance.instanceId),
							})),
							incomingLive: !incoming.isDisposed,
						}, {
							pendingState: draftTerminals.map(() => ({ live: true, inputLive: true, sameInput: true, attached: true, foreground: true })),
							promptCount: siblingCount,
							draftOwner: false,
							terminals: draftTerminals.map(() => ({ live: !confirmed, inputLive: !confirmed, sameInput: !confirmed, liveInputAttachment: !confirmed, foreground: !confirmed, managed: !confirmed, inputOwner: !confirmed, listenerOwner: !confirmed, openEditors: confirmed ? 0 : 1, standalone: !confirmed, scope: false })),
							incomingLive: true,
						});
					} finally {
						await releaseVisibility.complete();
						for (const result of promptResults) {
							await result.complete({ confirmed: false });
						}
						await Promise.allSettled([closing, visibility]);
						await Promise.allSettled(opening.returnValues);
						pendingShow.restore();
						confirmDialog.restore();
						for (const instance of [...draftTerminals, incoming]) {
							for (const { editor, groupId } of editorService.findEditors(instance.resource)) {
								await editor.revert(groupId);
							}
							await editorService.closeEditors([...editorService.findEditors(instance.resource)]);
							editors.detachInstance(instance);
							instance.dispose();
						}
						contribution.dispose();
						await workbenchTeardown(instantiationService);
					}
				});
			}
		}
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

	test('keeps one terminal editor when fresh auxiliary and main opens overlap', async () => {
		const owners = await createRealEditorOwners();
		const { part, editorService, editors, instantiationService } = owners;
		const mainGroup = part.activeGroup;
		const auxiliaryGroup = part.addGroup(mainGroup, GroupDirection.RIGHT);
		const auxiliaryEntered = new DeferredPromise<void>();
		const releaseAuxiliary = new DeferredPromise<void>();
		const auxiliaryPart = new class extends mock<IAuxiliaryEditorPart>() {
			override readonly activeGroup = auxiliaryGroup;
		};
		const createAuxiliary = sinon.stub(part, 'createAuxiliaryEditorPart').callsFake(async () => {
			await auxiliaryEntered.complete();
			await releaseAuxiliary.p;
			return auxiliaryPart;
		});
		const instance = makeInstance(703);
		const auxiliaryOpening = editors.openEditor(instance, { viewColumn: AUX_WINDOW_GROUP });
		const mainOpening = editors.openEditor(instance, { viewColumn: mainGroup.id });
		const openings = Promise.all([auxiliaryOpening, mainOpening]);
		void openings.catch(() => undefined);
		try {
			await auxiliaryEntered.p;
			// Drain the main-group promise chain while auxiliary group selection is held.
			await timeout(0);
			await releaseAuxiliary.complete();
			await openings;
			const input = editors.getInputFromResource(instance.resource);
			assert.deepStrictEqual({
				locations: editorService.findEditors(instance.resource).length,
				live: !input.isDisposed() && input.terminalInstance === instance,
				instances: editors.instances.length,
			}, { locations: 1, live: true, instances: 1 });
		} finally {
			await releaseAuxiliary.complete();
			await Promise.allSettled([auxiliaryOpening, mainOpening]);
			createAuxiliary.restore();
			await editorService.closeEditors([...editorService.findEditors(instance.resource)]);
			editors.detachInstance(instance);
			instance.dispose();
			await workbenchTeardown(instantiationService);
		}
	});
});
