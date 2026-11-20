/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Dimension } from '../../../../../base/browser/dom.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeyCodeChord } from '../../../../../base/common/keybindings.js';
import { OS } from '../../../../../base/common/platform.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ResolvedKeybindingItem } from '../../../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { WorkbenchTable } from '../../../../../platform/list/browser/listService.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { Memento } from '../../../../common/memento.js';
import { KeybindingsEditorInput } from '../../../../services/preferences/browser/keybindingsEditorInput.js';
import { IKeybindingEditingService } from '../../../../services/keybinding/common/keybindingEditing.js';
import { IKeybindingItemEntry } from '../../../../services/preferences/common/preferences.js';
import { IExtensionsWorkbenchService } from '../../../extensions/common/extensions.js';
import { TestEditorGroupView, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { KeybindingsEditor } from '../../browser/keybindingsEditor.js';

suite('KeybindingsEditor lifecycle', () => {
	/* eslint-disable local/code-no-bracket-notation-for-identifiers -- Inspect private lifecycle state without widening the editor or widget API. */

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const context = { newInGroup: true };

	teardown(() => {
		sinon.restore();
		Memento.clear(StorageScope.PROFILE);
	});

	function createEditor() {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IUserInteractionService, new MockUserInteractionService());
		const bindings = Array.from({ length: 25 }, (_, index) => new ResolvedKeybindingItem(undefined, `test.command.${index.toString().padStart(2, '0')}`, undefined, ContextKeyExpr.equals('test.context', 'value'), true, null, false));
		instantiationService.stub(IKeybindingService, new class extends MockKeybindingService {
			override getKeybindings(): ResolvedKeybindingItem[] { return bindings; }
			override getDefaultKeybindings(): ResolvedKeybindingItem[] { return bindings; }
		});
		const editing = { editKeybinding: sinon.stub(), removeKeybinding: sinon.stub(), resetKeybinding: sinon.stub() };
		instantiationService.stub(IKeybindingEditingService, editing);
		instantiationService.stub(IExtensionsWorkbenchService, {});
		const editor = store.add(instantiationService.createInstance(KeybindingsEditor, new TestEditorGroupView(1)));
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		editor.create(container);
		editor.setVisible(true);
		editor.layout(new Dimension(900, 320));
		const table = editor['keybindingsTable'];
		const whenChanged = editor['_onDefineWhenExpression'];
		const createInput = () => store.add(instantiationService.createInstance(KeybindingsEditorInput));
		return { editor, table, whenChanged, createInput, bindings, editing, container };
	}

	function assertCleared(editor: KeybindingsEditor, table: WorkbenchTable<IKeybindingItemEntry>, whenChanged: Emitter<IKeybindingItemEntry>): void {
		const entries = editor['tableEntries'];
		assert.deepStrictEqual({ hasModel: editor['keybindingsEditorModel'] !== null, entries: entries.length, rows: table.length, rowListeners: whenChanged.hasListeners() }, {
			hasModel: false, entries: 0, rows: 0, rowListeners: false
		});
	}

	function addBoundCommand(bindings: ResolvedKeybindingItem[]): string {
		const command = 'test.command.bound';
		const keybinding = new USLayoutResolvedKeybinding([new KeyCodeChord(true, false, false, false, KeyCode.KeyA)], OS);
		bindings.push(new ResolvedKeybindingItem(keybinding, command, undefined, undefined, true, null, false));
		return command;
	}

	test('clears closed pane rows, model and pooled row listeners', async () => {
		const { editor, table, whenChanged, createInput } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		assert.ok(table.length > 0 && whenChanged.hasListeners());

		editor.clearInput();
		input.dispose();

		assertCleared(editor, table, whenChanged);
	});

	test('cleans up live When inputs and actions when a bound row closes', async () => {
		const { editor, table, whenChanged, createInput, bindings, container } = createEditor();
		const command = addBoundCommand(bindings);
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const entry = editor['tableEntries'].find(entry => entry.keybindingItem.command === command);
		assert.ok(entry);
		editor.defineWhenExpression(entry);

		const when = container.querySelector('.when.input-mode');
		const whenInput = when?.querySelector('.when-input-container');
		const actions = when?.closest('.monaco-list-row')?.querySelector('.monaco-action-bar .actions-container');
		assert.ok(when && whenInput?.childElementCount && actions?.childElementCount);
		assert.ok(editor['_onAcceptWhenExpression'].hasListeners() && editor['_onRejectWhenExpression'].hasListeners());

		editor.clearInput();
		input.dispose();

		assertCleared(editor, table, whenChanged);
		assert.deepStrictEqual({
			inputMode: when.classList.contains('input-mode'),
			inputs: whenInput.childElementCount,
			actions: actions.childElementCount,
			accept: editor['_onAcceptWhenExpression'].hasListeners(),
			reject: editor['_onRejectWhenExpression'].hasListeners(),
		}, { inputMode: false, inputs: 0, actions: 0, accept: false, reject: false });

		await editor.setInput(createInput(), undefined, context, CancellationToken.None);
		const reopened = editor['tableEntries'].find(entry => entry.keybindingItem.command === command);
		assert.ok(reopened);
		editor.defineWhenExpression(reopened);
		assert.ok(container.querySelector('.when.input-mode .when-input-container')?.childElementCount);
		editor.rejectWhenExpression(reopened);
		assert.strictEqual(container.querySelector('.when.input-mode'), null);
	});

	test('cancels a shortcut dialog when the pane closes before its input focuses', async () => {
		const { editor, createInput } = createEditor();
		await editor.setInput(createInput(), undefined, context, CancellationToken.None);
		const widget = editor['defineKeybindingWidget'];
		let settled = false;
		void editor.defineKeybinding(editor['tableEntries'][0], false).then(() => { settled = true; });
		assert.strictEqual(widget.domNode.style.display, 'block');
		assert.ok(widget['_focusScheduler'].isScheduled());

		editor.clearInput();
		await timeout(0);
		assert.deepStrictEqual({
			settled,
			dialog: widget.domNode.style.display,
			overlay: editor['overlayContainer'].style.display,
			focusScheduled: widget['_focusScheduler'].isScheduled(),
		}, { settled: true, dialog: 'none', overlay: 'none', focusScheduled: false });
	});

	test('preserves compact search, selection and scroll state when reopened', async () => {
		const { editor, table, createInput } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const filtering = sinon.spy(editor['delayedFiltering'], 'trigger');
		editor.search('test.command');
		await filtering.lastCall.returnValue;
		editor.toggleSortByPrecedence();
		assert.ok(table.length > 5);
		table.setSelection([5]);
		table.setFocus([5]);
		table.scrollTop = 120;
		const before = { selection: table.getSelection(), focus: table.getFocus(), scrollTop: table.scrollTop };

		editor.clearInput();
		input.dispose();
		const next = createInput();
		await editor.setInput(next, { preserveFocus: true }, context, CancellationToken.None);

		assert.deepStrictEqual({ selection: table.getSelection(), focus: table.getFocus(), scrollTop: table.scrollTop, search: next.searchOptions?.searchValue, sort: next.searchOptions?.sortByPrecedence }, {
			...before, search: 'test.command', sort: true
		});
	});

	test('does not restore a closed pane when input resolution finishes late', async () => {
		const { editor, table, whenChanged, createInput } = createEditor();
		const input = createInput();
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<typeof input.keybindingsModel>();
		sinon.stub(input, 'resolve').callsFake(() => {
			started.complete();
			return resolved.p;
		});
		const opening = editor.setInput(input, undefined, context, CancellationToken.None);
		await started.p;

		const resolveModel = sinon.spy(input.keybindingsModel, 'resolve');
		editor.clearInput();
		input.dispose();
		resolved.complete(input.keybindingsModel);
		await opening;

		sinon.assert.notCalled(resolveModel);
		assert.deepStrictEqual(input.keybindingsModel.fetch(''), []);
		assertCleared(editor, table, whenChanged);
	});

	test('does not restore a closed pane when model resolution finishes late', async () => {
		const { editor, table, whenChanged, createInput } = createEditor();
		const input = createInput();
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<void>();
		sinon.stub(input.keybindingsModel, 'resolve').callsFake(() => {
			started.complete();
			return resolved.p;
		});
		const opening = editor.setInput(input, undefined, context, CancellationToken.None);
		await started.p;

		editor.clearInput();
		input.dispose();
		resolved.complete();
		await opening;

		assertCleared(editor, table, whenChanged);
	});

	test('keeps the newest input when an earlier input finishes loading', async () => {
		const { editor, createInput } = createEditor();
		const first = createInput();
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<typeof first.keybindingsModel>();
		sinon.stub(first, 'resolve').callsFake(() => {
			started.complete();
			return resolved.p;
		});
		const opening = editor.setInput(first, undefined, context, CancellationToken.None);
		await started.p;
		const next = createInput();
		await editor.setInput(next, undefined, context, CancellationToken.None);

		resolved.complete(first.keybindingsModel);
		await opening;

		assert.strictEqual(editor['keybindingsEditorModel'], next.keybindingsModel);
	});

	test('keeps the table view state across an interrupted reopen', async () => {
		const { editor, table, createInput } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		assert.ok(table.length > 5);
		table.setSelection([5]);
		table.setFocus([5]);
		table.scrollTop = 120;
		const before = { selection: table.getSelection(), focus: table.getFocus(), scrollTop: table.scrollTop };

		editor.clearInput();
		const interrupted = createInput();
		const resolveInput = sinon.spy(interrupted, 'resolve');
		const opening = editor.setInput(interrupted, undefined, context, CancellationToken.None);
		editor.clearInput();
		await opening;
		sinon.assert.notCalled(resolveInput);

		await editor.setInput(input, { preserveFocus: true }, context, CancellationToken.None);
		assert.deepStrictEqual({ selection: table.getSelection(), focus: table.getFocus(), scrollTop: table.scrollTop }, before);
	});

	test('restores the focused and selected entries after the binding order changes while hidden', async () => {
		const { editor, table, createInput, bindings } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		editor.toggleSortByPrecedence();
		assert.ok(table.length > 5);
		table.setSelection([5]);
		table.setFocus([5]);
		const entryId = table.getFocusedElements()[0].id;

		editor.clearInput();
		bindings.unshift(new ResolvedKeybindingItem(undefined, 'test.command.inserted', undefined, undefined, true, null, false));
		await editor.setInput(input, { preserveFocus: false }, context, CancellationToken.None);

		assert.deepStrictEqual({
			selection: table.getSelectedElements().map(entry => entry.id),
			focus: table.getFocusedElements().map(entry => entry.id),
			index: table.getFocus(),
		}, { selection: [entryId], focus: [entryId], index: [6] });
	});

	test('skips a stale resolve when the same input reopens', async () => {
		const { editor, createInput } = createEditor();
		const input = createInput();
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<typeof input.keybindingsModel>();
		const resolveInput = sinon.stub(input, 'resolve');
		resolveInput.onFirstCall().callsFake(() => {
			started.complete();
			return resolved.p;
		});
		resolveInput.onSecondCall().resolves(input.keybindingsModel);
		const resolveModel = sinon.spy(input.keybindingsModel, 'resolve');
		const opening = editor.setInput(input, undefined, context, CancellationToken.None);
		await started.p;

		editor.clearInput();
		await editor.setInput(input, { preserveFocus: true }, context, CancellationToken.None);
		resolved.complete(input.keybindingsModel);
		await opening;

		sinon.assert.calledOnce(resolveModel);
	});

	test('does not publish an earlier model resolve after the same input reopens', async () => {
		const { editor, createInput } = createEditor();
		const input = createInput();
		const model = input.keybindingsModel;
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<void>();
		const fetch = sinon.spy(model, 'fetch');
		sinon.stub(model, 'resolve').onFirstCall().callsFake(() => {
			started.complete();
			return resolved.p;
		});
		const opening = editor.setInput(input, undefined, context, CancellationToken.None);
		await started.p;

		editor.clearInput();
		await editor.setInput(input, { preserveFocus: true }, context, CancellationToken.None);
		const renders = fetch.callCount;
		assert.ok(renders > 0);
		resolved.complete();
		await opening;

		assert.strictEqual(fetch.callCount, renders);
	});

	test('skips a late model resolve after the pane is disposed while the input remains live', async () => {
		const { editor, createInput } = createEditor();
		const input = createInput();
		const started = new DeferredPromise<void>();
		const resolved = new DeferredPromise<typeof input.keybindingsModel>();
		sinon.stub(input, 'resolve').callsFake(() => {
			started.complete();
			return resolved.p;
		});
		const resolveModel = sinon.spy(input.keybindingsModel, 'resolve');
		const opening = editor.setInput(input, undefined, context, CancellationToken.None);
		await started.p;

		editor.dispose();
		assert.strictEqual(input.keybindingsModel.isDisposed(), false);
		resolved.complete(input.keybindingsModel);
		await opening;

		sinon.assert.notCalled(resolveModel);
	});

	test('does not hide a newer shortcut dialog when an old save finishes', async () => {
		const { editor, createInput, editing, table } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const oldRow = editor['tableEntries'][0];
		const widget = editor['defineKeybindingWidget'];
		const nextChoice = new DeferredPromise<string | null>();
		const define = sinon.stub(widget, 'define');
		define.onFirstCall().resolves('ctrl+alt+f9');
		define.onSecondCall().returns(nextChoice.p);
		const started = new DeferredPromise<void>();
		const saved = new DeferredPromise<void>();
		editing.editKeybinding.callsFake(() => {
			started.complete();
			return saved.p;
		});
		const updating = editor.defineKeybinding(oldRow, false);
		await started.p;

		editor.clearInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const nextRow = editor['tableEntries'][1];
		const defining = editor.defineKeybinding(nextRow, false);
		saved.complete();
		await updating;

		assert.deepStrictEqual({
			overlay: editor['overlayContainer'].style.display,
			selected: table.getSelectedElements().map(entry => entry.id),
		}, { overlay: 'block', selected: [nextRow.id] });

		nextChoice.complete(null);
		await defining;
	});

	test('does not refocus the reopened pane when an old removal completes', async () => {
		const { editor, createInput, bindings, editing } = createEditor();
		const command = addBoundCommand(bindings);
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const entry = editor['tableEntries'].find(entry => entry.keybindingItem.command === command);
		assert.ok(entry?.keybindingItem.keybinding);
		const saved = new DeferredPromise<void>();
		editing.removeKeybinding.returns(saved.p);
		const removing = editor.removeKeybinding(entry);
		sinon.assert.calledOnce(editing.removeKeybinding);

		editor.clearInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const focus = sinon.spy(editor, 'focus');
		saved.complete();
		await removing;

		sinon.assert.notCalled(focus);
	});

	for (const action of ['editKeybinding', 'resetKeybinding'] as const) {
		test(`discards a pending ${action} reveal after the pane closes`, async () => {
			const { editor, createInput, editing } = createEditor();
			const input = createInput();
			await editor.setInput(input, undefined, context, CancellationToken.None);
			const entry = editor['tableEntries'][0];
			assert.ok(entry && !entry.keybindingItem.keybinding);
			const saved = new DeferredPromise<void>();
			editing[action].returns(saved.p);
			const operation = action === 'editKeybinding' ? editor.updateKeybinding(entry, 'ctrl+alt+f9', undefined) : editor.resetKeybinding(entry);
			sinon.assert.calledOnce(editing[action]);

			editor.clearInput();
			saved.complete();
			await operation;

			assert.strictEqual(editor['unAssignedKeybindingItemToRevealAndFocus'], null);
		});
	}
	/* eslint-enable local/code-no-bracket-notation-for-identifiers */
});
