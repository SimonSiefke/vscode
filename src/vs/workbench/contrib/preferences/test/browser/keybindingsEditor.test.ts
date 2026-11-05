/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Dimension } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Action } from '../../../../../base/common/actions.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ResolvedKeybindingItem } from '../../../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { WorkbenchTable } from '../../../../../platform/list/browser/listService.js';
import { KeybindingsEditorInput } from '../../../../services/preferences/browser/keybindingsEditorInput.js';
import { IKeybindingEditingService } from '../../../../services/keybinding/common/keybindingEditing.js';
import { IKeybindingItemEntry } from '../../../../services/preferences/common/preferences.js';
import { IExtensionsWorkbenchService } from '../../../extensions/common/extensions.js';
import { TestEditorGroupView, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { KeybindingsEditor } from '../../browser/keybindingsEditor.js';

suite('KeybindingsEditor lifecycle', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const context = { newInGroup: true };

	teardown(() => sinon.restore());

	function createEditor() {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const bindings = Array.from({ length: 25 }, (_, index) => new ResolvedKeybindingItem(undefined, `test.command.${index.toString().padStart(2, '0')}`, undefined, ContextKeyExpr.equals('test.context', 'value'), true, null, false));
		instantiationService.stub(IKeybindingService, new class extends MockKeybindingService {
			override getKeybindings(): ResolvedKeybindingItem[] { return bindings; }
			override getDefaultKeybindings(): ResolvedKeybindingItem[] { return bindings; }
		});
		instantiationService.stub(IKeybindingEditingService, {});
		instantiationService.stub(IExtensionsWorkbenchService, {});
		const editor = store.add(instantiationService.createInstance(KeybindingsEditor, new TestEditorGroupView(1)));
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		editor.create(container);
		editor.setVisible(true);
		editor.layout(new Dimension(900, 320));
		const table = Reflect.get(editor, 'keybindingsTable') as WorkbenchTable<IKeybindingItemEntry>;
		const whenChanged = Reflect.get(editor, '_onDefineWhenExpression') as Emitter<IKeybindingItemEntry>;
		const createInput = () => store.add(instantiationService.createInstance(KeybindingsEditorInput));
		return { editor, table, whenChanged, createInput };
	}

	function assertCleared(editor: KeybindingsEditor, table: WorkbenchTable<IKeybindingItemEntry>, whenChanged: Emitter<IKeybindingItemEntry>): void {
		const entries = Reflect.get(editor, 'tableEntries') as IKeybindingItemEntry[];
		assert.deepStrictEqual({ hasModel: Reflect.get(editor, 'keybindingsEditorModel') !== null, entries: entries.length, rows: table.length, rowListeners: whenChanged.hasListeners() }, {
			hasModel: false, entries: 0, rows: 0, rowListeners: false
		});
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

	test('preserves compact search, selection and scroll state when reopened', async () => {
		const { editor, table, createInput } = createEditor();
		const input = createInput();
		await editor.setInput(input, undefined, context, CancellationToken.None);
		const clock = sinon.useFakeTimers();
		try {
			editor.search('test.command');
			await clock.tickAsync(300);
			const sort = Reflect.get(editor, 'sortByPrecedenceAction') as Action;
			sort.checked = true;
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
		} finally {
			clock.restore();
		}
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

		editor.clearInput();
		input.dispose();
		resolved.complete(input.keybindingsModel);
		await opening;

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

		assert.strictEqual(Reflect.get(editor, 'keybindingsEditorModel') === next.keybindingsModel, true);
	});
});
