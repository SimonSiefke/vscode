/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws } from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { AuxiliaryEditorPartImpl } from '../../../../browser/parts/editor/auxiliaryEditorPart.js';
import { EditorCloseContext, IEditorCloseEvent } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { GroupDirection, IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { createEditorParts, registerTestEditor, TestEditorParts, TestFileEditorInput, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalInstance, ITerminalInstanceService } from '../../browser/terminal.js';
import { TerminalEditorInput } from '../../browser/terminalEditorInput.js';
import { TerminalEditorService } from '../../browser/terminalEditorService.js';

suite('Workbench - TerminalEditorService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let terminalEditorService: TerminalEditorService;
	let onDidActiveEditorChange: Emitter<void>;
	let onDidCloseEditor: Emitter<IEditorCloseEvent>;
	let activeEditor: EditorInput | undefined;

	setup(() => {
		onDidActiveEditorChange = store.add(new Emitter<void>());
		onDidCloseEditor = store.add(new Emitter<IEditorCloseEvent>());
		activeEditor = undefined;

		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IEditorService, upcastPartial<IEditorService>({
			onDidActiveEditorChange: onDidActiveEditorChange.event,
			onDidVisibleEditorsChange: Event.None,
			onDidCloseEditor: onDidCloseEditor.event,
			get activeEditor() { return activeEditor; },
			activeEditorPane: undefined,
			visibleEditors: [],
		}));
		instantiationService.stub(ITerminalInstanceService, {});

		terminalEditorService = store.add(instantiationService.createInstance(TerminalEditorService));
	});

	function createEditorTerminal(instanceId: number): EditorInput {
		const resource = URI.from({ scheme: Schemas.vscodeTerminal, path: `/${instanceId}` });
		const instance = upcastPartial<ITerminalInstance>({
			instanceId,
			resource,
			waitOnExit: undefined,
			onDidFocus: Event.None,
			onDidBlur: Event.None,
			onDisposed: Event.None,
			onExit: Event.None,
			onTitleChanged: Event.None,
			onIconChanged: Event.None,
			statusList: upcastPartial<ITerminalInstance['statusList']>({ onDidChangePrimaryStatus: Event.None }),
			capabilities: upcastPartial<ITerminalInstance['capabilities']>({ onDidChangeCapabilities: Event.None }),
			dispose: () => { },
		});
		terminalEditorService.resolveResource(instance);
		const input = store.add(terminalEditorService.getInputFromResource(resource));
		activeEditor = input;
		onDidActiveEditorChange.fire();
		return input;
	}

	function getState() {
		return {
			instances: terminalEditorService.instances.map(instance => instance.instanceId),
			activeInstance: terminalEditorService.activeInstance?.instanceId,
		};
	}

	test('keeps a terminal editor tracked and active when it moves to another group', () => {
		const input = createEditorTerminal(1);

		// Moving an editor opens it in the target group first, then closes it in the source group
		onDidCloseEditor.fire({ editor: input, groupId: 1, index: 0, sticky: false, context: EditorCloseContext.MOVE });
		onDidActiveEditorChange.fire();

		deepStrictEqual(getState(), { instances: [1], activeInstance: 1 });
	});

	test('clears the active terminal editor when it is closed', () => {
		const input = createEditorTerminal(1);
		createEditorTerminal(2);
		activeEditor = input;
		onDidActiveEditorChange.fire();
		deepStrictEqual(getState(), { instances: [1, 2], activeInstance: 1 });
		const selectionsOnListChange: (number | undefined)[] = [];
		const activeChanges: (number | undefined)[] = [];
		store.add(terminalEditorService.onDidChangeInstances(() => selectionsOnListChange.push(terminalEditorService.activeInstance?.instanceId)));
		store.add(terminalEditorService.onDidChangeActiveInstance(instance => activeChanges.push(instance?.instanceId)));

		onDidCloseEditor.fire({ editor: input, groupId: 1, index: 0, sticky: false, context: EditorCloseContext.UNKNOWN });

		deepStrictEqual(getState(), { instances: [2], activeInstance: undefined });
		deepStrictEqual(selectionsOnListChange, [undefined]);
		deepStrictEqual(activeChanges, [undefined]);
	});
});

suite('Workbench - TerminalEditorService - editor groups', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const TEST_EDITOR_ID = 'terminalEditorServiceTestEditor';

	let terminalEditorService: TerminalEditorService;
	let parts: TestEditorParts;
	let instantiationService: TestInstantiationService;

	setup(async () => {
		instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IContextKeyService, store.add(instantiationService.createInstance(ContextKeyService)));
		store.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TerminalEditorInput), new SyncDescriptor(TestFileEditorInput)]));

		parts = await createEditorParts(instantiationService, store.add(new DisposableStore()));
		instantiationService.stub(IEditorGroupsService, parts);
	});

	function createTerminalEditorService(): void {
		instantiationService.stub(IEditorService, store.add(instantiationService.createInstance(EditorService, undefined)));
		instantiationService.stub(ITerminalInstanceService, {});

		terminalEditorService = store.add(instantiationService.createInstance(TerminalEditorService));
	}

	async function createAuxiliaryPart() {
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const auxiliary = store.add(instantiationService.createInstance(AuxiliaryEditorPartImpl, mainWindow.vscodeWindowId, parts, undefined, 'Auxiliary'));
		const registration = store.add(parts.registerPart(auxiliary));
		auxiliary.create(container);
		auxiliary.layout(1080, 800, 0, 0);
		await auxiliary.whenReady;
		return { auxiliary, registration };
	}

	function createTerminalInstance(instanceId: number): ITerminalInstance {
		return upcastPartial<ITerminalInstance>({
			instanceId,
			resource: URI.from({ scheme: Schemas.vscodeTerminal, path: `/${instanceId}` }),
			title: `Terminal ${instanceId}`,
			shellLaunchConfig: {},
			waitOnExit: undefined,
			onDidFocus: Event.None,
			onDidBlur: Event.None,
			onDisposed: Event.None,
			onExit: Event.None,
			onTitleChanged: Event.None,
			onIconChanged: Event.None,
			statusList: upcastPartial<ITerminalInstance['statusList']>({ onDidChangePrimaryStatus: Event.None }),
			capabilities: upcastPartial<ITerminalInstance['capabilities']>({ onDidChangeCapabilities: Event.None }),
			setParentContextKeyService: () => { },
			resetFocusContextKey: () => { },
			detachFromElement: () => { },
			focusWhenReady: async () => { },
			dispose: () => { },
		});
	}

	function createContextTrackedTerminal() {
		const rootContext = instantiationService.get(IContextKeyService);
		const terminalContext = store.add(rootContext.createScoped(document.createElement('div')));
		const onDisposed = store.add(new Emitter<ITerminalInstance>());
		const parents: IContextKeyService[] = [];
		let terminalDisposed = false;
		const instance: ITerminalInstance = {
			...createTerminalInstance(1),
			onDisposed: onDisposed.event,
			setParentContextKeyService: parent => {
				parents.push(parent);
				terminalContext.updateParent(parent);
			},
			dispose: () => {
				if (!terminalDisposed) {
					terminalDisposed = true;
					onDisposed.fire(instance);
					terminalContext.dispose();
				}
			},
		};
		return { instance, onDisposed, rootContext, parents, isDisposed: () => terminalDisposed };
	}

	/** Opens a terminal editor in `group` behind an active file editor, so that it stays inactive. */
	async function openInactiveTerminalEditor(group: IEditorGroup, instance: ITerminalInstance): Promise<TerminalEditorInput> {
		await group.openEditor(store.add(new TestFileEditorInput(URI.file(`/file${group.id}`), TEST_EDITOR_ID)), { pinned: true });
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await group.openEditor(input, { pinned: true, inactive: true });
		return input;
	}

	function getState(instance: ITerminalInstance, input: TerminalEditorInput) {
		return {
			instances: terminalEditorService.instances.map(instance => instance.instanceId),
			trackedInput: terminalEditorService.getInputFromResource(instance.resource) === input,
			groups: parts.groups.filter(group => group.contains(input)).map(group => ({ id: group.id, active: group.activeEditor === input })),
		};
	}

	test('keeps an inactive terminal editor tracked and revealable when it moves to another group', async () => {
		createTerminalEditorService();
		const source = parts.activeGroup;
		const target = parts.addGroup(source, GroupDirection.RIGHT);
		const instance = createTerminalInstance(1);
		const input = await openInactiveTerminalEditor(source, instance);
		await target.openEditor(store.add(new TestFileEditorInput(URI.file('/target'), TEST_EDITOR_ID)), { pinned: true });

		source.moveEditor(input, target, { inactive: true, preserveFocus: true });
		deepStrictEqual(getState(instance, input), { instances: [1], trackedInput: true, groups: [{ id: target.id, active: false }] });

		await terminalEditorService.focusInstance(instance);
		deepStrictEqual(getState(instance, input), { instances: [1], trackedInput: true, groups: [{ id: target.id, active: true }] });
	});

	test('rebinds an inactive terminal before revealing it after its whole group moves between parts', async () => {
		const { auxiliary } = await createAuxiliaryPart();
		createTerminalEditorService();
		const source = auxiliary.activeGroup;
		source.focus();
		const file = store.add(new TestFileEditorInput(URI.file('/active-in-moved-group'), TEST_EDITOR_ID));
		const { instance, parents } = createContextTrackedTerminal();
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await source.openEditor(input, { pinned: true });
		await source.openEditor(file, { pinned: true });
		strictEqual(source.activeEditor === file, true);
		strictEqual(input.group?.id, source.id);
		strictEqual(parents.at(-1) === source.scopedContextKeyService, true);

		const closeListeners = store.add(new DisposableStore());
		const close = Event.toPromise(Event.filter(source.onDidCloseEditor, event => event.editor === input), closeListeners);
		const moved = parts.moveGroup(source, parts.mainPart.activeGroup, GroupDirection.RIGHT);
		strictEqual((await close).context, EditorCloseContext.UNKNOWN);
		deepStrictEqual(getState(instance, input), { instances: [1], trackedInput: true, groups: [{ id: moved.id, active: false }] });
		strictEqual(input.group?.id, moved.id);
		strictEqual(parents.at(-1) === moved.scopedContextKeyService, true);

		await terminalEditorService.focusInstance(instance);
		deepStrictEqual(getState(instance, input), { instances: [1], trackedInput: true, groups: [{ id: moved.id, active: true }] });
	});

	test('keeps the live terminal owner when closing an inactive duplicate from a third group', async () => {
		createTerminalEditorService();
		const first = parts.activeGroup;
		const { instance, parents } = createContextTrackedTerminal();
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await first.openEditor(input, { pinned: true });
		const owner = parts.copyGroup(first, first, GroupDirection.RIGHT);
		await owner.openEditor(store.add(new TestFileEditorInput(URI.file('/owner'), TEST_EDITOR_ID)), { pinned: true });
		await owner.openEditor(input, { pinned: true });
		const closing = parts.copyGroup(owner, owner, GroupDirection.RIGHT);
		const closingFile = store.add(new TestFileEditorInput(URI.file('/closing'), TEST_EDITOR_ID));
		await closing.openEditor(closingFile, { pinned: true });
		parts.activateGroup(owner);
		strictEqual(input.group?.id, owner.id);
		strictEqual(parents.at(-1) === owner.scopedContextKeyService, true);
		deepStrictEqual(parts.groups.filter(group => group.activeEditor === input).map(group => group.id), [first.id, owner.id]);
		strictEqual(closing.contains(input, { strictEquals: true }), true);
		strictEqual(closing.activeEditor === closingFile, true);
		const parentCount = parents.length;

		await closing.closeEditor(input);

		strictEqual(closing.contains(input, { strictEquals: true }), false);
		strictEqual(input.group?.id, owner.id);
		strictEqual(parents.at(-1) === owner.scopedContextKeyService, true);
		strictEqual(parents.length, parentCount);
	});

	test('rebinds to the surviving copy that still displays the terminal', async () => {
		createTerminalEditorService();
		const first = parts.activeGroup;
		const { instance, parents } = createContextTrackedTerminal();
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await first.openEditor(input, { pinned: true });
		const activeCopy = parts.copyGroup(first, first, GroupDirection.RIGHT);
		const owner = parts.copyGroup(first, activeCopy, GroupDirection.RIGHT);
		await first.openEditor(store.add(new TestFileEditorInput(URI.file('/first-survivor'), TEST_EDITOR_ID)), { pinned: true });
		parts.activateGroup(first);
		parts.activateGroup(owner);
		strictEqual(input.group?.id, owner.id);
		strictEqual(parents.at(-1) === owner.scopedContextKeyService, true);
		const ownerFile = store.add(new TestFileEditorInput(URI.file('/closing-owner'), TEST_EDITOR_ID));
		await owner.openEditor(ownerFile, { pinned: true });
		strictEqual(parts.activeGroup === owner && owner.activeEditor === ownerFile, true);
		deepStrictEqual(parts.groups.filter(group => group !== owner && group.contains(input, { strictEquals: true }))
			.map(group => [group.id, group.activeEditor === input]), [[first.id, false], [activeCopy.id, true]]);
		const parentCount = parents.length;

		await owner.closeEditor(input, { preserveFocus: true });

		strictEqual(owner.contains(input, { strictEquals: true }), false);
		strictEqual(parts.activeGroup === owner, true);
		strictEqual(input.group?.id, activeCopy.id);
		strictEqual(parents.length, parentCount + 1);
		strictEqual(parents.at(-1) === activeCopy.scopedContextKeyService, true);
	});

	test('removes a terminal editor once it closes in its last group', async () => {
		createTerminalEditorService();
		const group = parts.activeGroup;
		const instance = createTerminalInstance(1);
		const input = await openInactiveTerminalEditor(group, instance);

		await group.closeEditor(input);

		deepStrictEqual(terminalEditorService.instances, []);
	});

	test('releases a disposed terminal when a pending move cannot open it', async () => {
		createTerminalEditorService();
		const source = parts.activeGroup;
		const target = parts.addGroup(source, GroupDirection.RIGHT);
		const { instance, isDisposed, onDisposed } = createContextTrackedTerminal();
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await source.openEditor(input, { pinned: true });
		const activeInstance = createTerminalInstance(2);
		const activeInput = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(activeInstance)));
		await source.openEditor(activeInput, { pinned: true });
		const lastInstance = createTerminalInstance(3);
		const lastInput = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(lastInstance)));
		await source.openEditor(lastInput, { pinned: true });
		await source.openEditor(activeInput, { pinned: true });
		strictEqual(source.activeEditor === activeInput, true);
		strictEqual(terminalEditorService.activeInstance?.instanceId, activeInstance.instanceId);
		deepStrictEqual(terminalEditorService.instances.map(instance => instance.instanceId), [1, 2, 3]);
		strictEqual(input.group?.id, source.id);
		strictEqual(terminalEditorService.getInputFromResource(instance.resource) === input, true);
		strictEqual(onDisposed.hasListeners(), true);
		const closeListeners = store.add(new DisposableStore());
		const sourceClose = Event.toPromise(Event.filter(source.onDidCloseEditor, event => event.editor === input), closeListeners);
		const selectionOnChange: (number | undefined)[] = [];
		store.add(terminalEditorService.onDidChangeInstances(() => selectionOnChange.push(terminalEditorService.activeInstance?.instanceId)));

		instance.dispose();
		strictEqual(isDisposed() && input.isDisposed() && source.contains(input, { strictEquals: true }), true);
		source.moveEditor(input, target, { inactive: true, preserveFocus: true });

		strictEqual((await sourceClose).context, EditorCloseContext.MOVE);
		strictEqual(source.activeEditor === activeInput, true);
		strictEqual(terminalEditorService.activeInstance?.instanceId, activeInstance.instanceId);
		deepStrictEqual(terminalEditorService.instances.map(instance => instance.instanceId), [2, 3]);
		deepStrictEqual(selectionOnChange, [activeInstance.instanceId]);
		deepStrictEqual({
			sourceContainsInput: source.contains(input, { strictEquals: true }),
			targetContainsInput: target.contains(input, { strictEquals: true }),
			instanceIsManaged: terminalEditorService.getInstanceFromResource(instance.resource) !== undefined,
			hasSubscriptions: onDisposed.hasListeners(),
		}, { sourceContainsInput: false, targetContainsInput: false, instanceIsManaged: false, hasSubscriptions: false });
		throws(() => terminalEditorService.getInputFromResource(instance.resource), /Could not get input from resource/);
	});

	test('keeps the editor terminal selection empty after moving the selected terminal to the panel', async () => {
		createTerminalEditorService();
		const source = parts.activeGroup;
		const background = parts.addGroup(source, GroupDirection.RIGHT);
		const file = store.add(new TestFileEditorInput(URI.file('/keep-active'), TEST_EDITOR_ID));
		const createInput = (instance: ITerminalInstance) => store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		const getSelectedInstanceId = () => terminalEditorService.activeInstance?.instanceId;
		const first = createInput(createTerminalInstance(1));
		const movedInstance = createTerminalInstance(2);
		const moved = createInput(movedInstance);
		await source.openEditor(first, { pinned: true });
		await source.openEditor(file, { pinned: true });
		await source.openEditor(moved, { pinned: true });
		strictEqual(source.activeEditor === moved, true);
		strictEqual(terminalEditorService.activeInstance === movedInstance, true);

		const closeListeners = store.add(new DisposableStore());
		const movedClose = Event.toPromise(Event.filter(source.onDidCloseEditor, event => event.editor === moved), closeListeners);
		terminalEditorService.detachInstance(movedInstance);
		await movedClose;
		strictEqual(source.activeEditor === file, true);
		strictEqual(moved.isDisposed(), true);
		deepStrictEqual(terminalEditorService.instances.map(instance => instance.instanceId), [1]);
		strictEqual(getSelectedInstanceId(), undefined);

		await source.closeEditor(first);
		strictEqual(terminalEditorService.instances.length, 0);
		strictEqual(getSelectedInstanceId(), undefined);
		const selectionsOnListChange: (number | undefined)[] = [];
		const activeChanges: (number | undefined)[] = [];
		store.add(terminalEditorService.onDidChangeInstances(() => selectionsOnListChange.push(getSelectedInstanceId())));
		store.add(terminalEditorService.onDidChangeActiveInstance(instance => activeChanges.push(instance?.instanceId)));
		const newInput = createInput(createTerminalInstance(3));
		await background.openEditor(newInput, { pinned: true, preserveFocus: true });

		strictEqual(parts.activeGroup === source && source.activeEditor === file, true);
		strictEqual(background.activeEditor === newInput, true);
		deepStrictEqual(terminalEditorService.instances.map(instance => instance.instanceId), [3]);
		strictEqual(getSelectedInstanceId(), undefined);
		deepStrictEqual(selectionsOnListChange, [undefined]);
		deepStrictEqual(activeChanges, []);
	});

	for (const outcome of ['moves to the panel', 'exits'] as const) {
		test(`does not rebind a shared terminal when it ${outcome}`, async () => {
			createTerminalEditorService();
			const source = parts.activeGroup;
			const { instance, rootContext, parents, isDisposed } = createContextTrackedTerminal();
			const file = store.add(new TestFileEditorInput(URI.file('/keep-open'), TEST_EDITOR_ID));
			await source.openEditor(file, { pinned: true });
			const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
			await source.openEditor(input, { pinned: true, inactive: true });
			const copy = parts.copyGroup(source, source, GroupDirection.RIGHT);
			await source.openEditor(input, { pinned: true });
			strictEqual(copy.contains(input, { strictEquals: true }), true);
			strictEqual(input.group?.id, source.id);
			strictEqual(parents.at(-1) === source.scopedContextKeyService, true);
			const closeListeners = store.add(new DisposableStore());
			const sourceClose = Event.toPromise(Event.map(Event.filter(source.onDidCloseEditor, event => event.editor === input),
				() => copy.contains(input, { strictEquals: true })), closeListeners);
			const copyClose = Event.toPromise(Event.filter(copy.onDidCloseEditor, event => event.editor === input), closeListeners);
			const parentCount = parents.length;

			const movedToPanel = outcome === 'moves to the panel';
			if (movedToPanel) {
				terminalEditorService.detachInstance(instance);
			} else {
				instance.dispose();
			}
			const [copyStillContainedInput] = await Promise.all([sourceClose, copyClose]);

			strictEqual(copyStillContainedInput, true);
			strictEqual(copy.activeEditor === file, true);
			strictEqual(input.isDisposed(), true);
			strictEqual(isDisposed(), !movedToPanel);
			deepStrictEqual(parents.slice(parentCount).map(parent => parent === rootContext), movedToPanel ? [true] : []);
			deepStrictEqual(terminalEditorService.instances, []);
		});
	}

	test('does not rebind an exited terminal when closing its last tab activates a duplicate', async () => {
		createTerminalEditorService();
		const source = parts.activeGroup;
		const { instance, parents } = createContextTrackedTerminal();
		const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
		await source.openEditor(input, { pinned: true });
		const copy = parts.copyGroup(source, source, GroupDirection.RIGHT);
		const file = store.add(new TestFileEditorInput(URI.file('/keep-duplicate-open'), TEST_EDITOR_ID));
		await copy.openEditor(file, { pinned: true });
		await copy.openEditor(input, { pinned: true });
		parts.activateGroup(source);
		strictEqual(parts.activeGroup === source, true);
		strictEqual(source.count, 1);
		strictEqual(input.group?.id, source.id);
		strictEqual(copy.activeEditor === input, true);
		const parentCount = parents.length;
		const closeListeners = store.add(new DisposableStore());
		const sourceClose = Event.toPromise(Event.map(Event.filter(source.onDidCloseEditor, event => event.editor === input),
			() => [parts.activeGroup === copy, copy.activeEditor === input, input.isDisposed()]), closeListeners);
		const copyClose = Event.toPromise(Event.filter(copy.onDidCloseEditor, event => event.editor === input), closeListeners);

		instance.dispose();
		const [duringSourceClose] = await Promise.all([sourceClose, copyClose]);

		deepStrictEqual(duringSourceClose, [true, true, true]);
		strictEqual(copy.activeEditor === file, true);
		strictEqual(parents.length, parentCount);
		deepStrictEqual(terminalEditorService.instances, []);
	});

	test('releases closed terminals and rebinds inactive surviving terminals when the auxiliary part closes', async () => {
		instantiationService.stub(IConfigurationService, new TestConfigurationService({ 'terminal.integrated.confirmOnKill': 'editor' }));
		const { auxiliary, registration } = await createAuxiliaryPart();
		createTerminalEditorService();

		const main = parts.mainPart.activeGroup;
		await main.openEditor(store.add(new TestFileEditorInput(URI.file('/main'), TEST_EDITOR_ID)), { pinned: true });
		const source = auxiliary.activeGroup;
		source.focus();
		strictEqual(source.scopedContextKeyService === main.scopedContextKeyService, false);
		let terminalParent: IContextKeyService | undefined;
		let disposed = false;
		const onDidFocus = store.add(new Emitter<ITerminalInstance>());
		const transferable: ITerminalInstance = {
			...createTerminalInstance(1),
			hasChildProcesses: true,
			setParentContextKeyService: parent => terminalParent = parent,
		};
		const closable: ITerminalInstance = {
			...createTerminalInstance(2),
			onDidFocus: onDidFocus.event,
			dispose: () => { disposed = true; },
		};
		const active: ITerminalInstance = { ...createTerminalInstance(3), hasChildProcesses: true };
		const open = async (instance: ITerminalInstance) => {
			const input = store.add(terminalEditorService.getInputFromResource(terminalEditorService.resolveResource(instance)));
			await source.openEditor(input, { pinned: true });
			return input;
		};
		const transferredInput = await open(transferable);
		strictEqual(transferredInput.group?.id, source.id);
		strictEqual(terminalParent === source.scopedContextKeyService, true);
		const closedInput = await open(closable);
		await open(active);
		strictEqual(onDidFocus.hasListeners(), true);

		strictEqual(auxiliary.close(), true);
		auxiliary.dispose();
		registration.dispose();
		strictEqual(closedInput.isDisposed(), true);
		strictEqual(disposed, true);
		strictEqual(onDidFocus.hasListeners(), false);
		strictEqual(transferredInput.isDisposed(), false);
		deepStrictEqual(getState(transferable, transferredInput), { instances: [1, 3], trackedInput: true, groups: [{ id: main.id, active: false }] });
		strictEqual(transferredInput.group?.id, main.id);
		strictEqual(terminalParent === main.scopedContextKeyService, true);

		await terminalEditorService.focusInstance(transferable);
		strictEqual(main.activeEditor === transferredInput, true);
	});
});
