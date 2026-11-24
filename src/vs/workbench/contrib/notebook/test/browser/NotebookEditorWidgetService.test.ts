/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EditorCloseContext, GroupIdentifier, IEditorCloseEvent, IEditorWillMoveEvent } from '../../../../common/editor.js';
import { NotebookEditorWidget } from '../../browser/notebookEditorWidget.js';
import { NotebookEditorWidgetService } from '../../browser/services/notebookEditorServiceImpl.js';
import { NotebookEditorInput } from '../../common/notebookEditorInput.js';
import { INotebookEditorModelResolverService } from '../../common/notebookEditorModelResolverService.js';
import { INotebookService } from '../../common/notebookService.js';
import { setupInstantiationService } from './testNotebookEditor.js';
import { IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

class TestNotebookEditorWidgetService extends NotebookEditorWidgetService {
	constructor(
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(editorGroupService, editorService, contextKeyService, instantiationService);
	}

	protected override createWidget(): NotebookEditorWidget {
		return new class extends mock<NotebookEditorWidget>() {
			override onWillHide = () => { };
			override getDomNode = () => { return { remove: () => { } } as HTMLElement; };
			override dispose = () => { };
		};
	}
}

function createNotebookInput(path: string, editorType: string) {
	return new class extends mock<NotebookEditorInput>() {
		override resource = URI.parse(path);
		override get typeId() { return editorType; }
	};
}

suite('NotebookEditorWidgetService', () => {
	let disposables: DisposableStore;
	let instantiationService: TestInstantiationService;
	let editorGroup1: IEditorGroup;
	let editorGroup2: IEditorGroup;
	let secondWindowId: number;

	let ondidRemoveGroup: Emitter<IEditorGroup>;
	let onDidCloseEditor: Emitter<IEditorCloseEvent>;
	let onWillMoveEditor: Emitter<IEditorWillMoveEvent>;
	teardown(() => disposables.dispose());

	ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		disposables = new DisposableStore();
		secondWindowId = 0;

		ondidRemoveGroup = new Emitter<IEditorGroup>();
		onDidCloseEditor = new Emitter<IEditorCloseEvent>();
		onWillMoveEditor = new Emitter<IEditorWillMoveEvent>();

		editorGroup1 = new class extends mock<IEditorGroup>() {
			override id = 1;
			override onDidCloseEditor = onDidCloseEditor.event;
			override onWillMoveEditor = onWillMoveEditor.event;
		};
		editorGroup2 = new class extends mock<IEditorGroup>() {
			override id = 2;
			override onDidCloseEditor = Event.None;
			override onWillMoveEditor = Event.None;
		};

		instantiationService = setupInstantiationService(disposables);
		instantiationService.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
			override onDidRemoveGroup = ondidRemoveGroup.event;
			override onDidAddGroup = Event.None;
			override whenReady = Promise.resolve();
			override groups = [editorGroup1, editorGroup2];
			override getPart(group: IEditorGroup | GroupIdentifier): IEditorPart;
			override getPart(container: unknown): IEditorPart;
			override getPart(container: unknown): IEditorPart {
				return { windowId: container === 2 ? secondWindowId : 0 } as IEditorPart;
			}
		});
		instantiationService.stub(IEditorService, new class extends mock<IEditorService>() {
			override onDidEditorsChange = Event.None;
		});
	});

	function createClosingInput(path: string): NotebookEditorInput {
		const inputServices = workbenchInstantiationService(undefined, disposables);
		inputServices.stub(INotebookService, new class extends mock<INotebookService>() {
			override onDidAddNotebookDocument = Event.None;
		});
		inputServices.stub(INotebookEditorModelResolverService, new class extends mock<INotebookEditorModelResolverService>() { });
		return disposables.add(inputServices.createInstance(NotebookEditorInput, URI.parse(path), undefined, 'test-notebook', {}));
	}

	test('Retrieve widget within group', async function () {
		const notebookEditorInput = createNotebookInput('/test.np', 'type1');
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		const widget = notebookEditorService.retrieveWidget(instantiationService, 1, notebookEditorInput);
		const value = widget.value;
		const widget2 = notebookEditorService.retrieveWidget(instantiationService, 1, notebookEditorInput);

		assert.notStrictEqual(widget2.value, undefined, 'should create a widget');
		assert.strictEqual(value, widget2.value, 'should return the same widget');
		assert.strictEqual(widget.value, undefined, 'initial borrow should no longer have widget');
	});

	test('Retrieve independent widgets', async function () {
		const inputType1 = createNotebookInput('/test.np', 'type1');
		const inputType2 = createNotebookInput('/test.np', 'type2');
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		const widget = notebookEditorService.retrieveWidget(instantiationService, 1, inputType1);
		const widgetDiffGroup = notebookEditorService.retrieveWidget(instantiationService, 2, inputType1);
		const widgetDiffType = notebookEditorService.retrieveWidget(instantiationService, 1, inputType2);

		assert.notStrictEqual(widget.value, undefined, 'should create a widget');
		assert.notStrictEqual(widgetDiffGroup.value, undefined, 'should create a widget');
		assert.notStrictEqual(widgetDiffType.value, undefined, 'should create a widget');
		assert.notStrictEqual(widget.value, widgetDiffGroup.value, 'should return a different widget');
		assert.notStrictEqual(widget.value, widgetDiffType.value, 'should return a different widget');
	});

	test('Only relevant widgets get disposed', async function () {
		const inputType1 = createNotebookInput('/test.np', 'type1');
		const inputType2 = createNotebookInput('/test.np', 'type2');
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		const widget = notebookEditorService.retrieveWidget(instantiationService, 1, inputType1);
		const widgetDiffType = notebookEditorService.retrieveWidget(instantiationService, 1, inputType2);
		const widgetDiffGroup = notebookEditorService.retrieveWidget(instantiationService, 2, inputType1);

		ondidRemoveGroup.fire(editorGroup1);

		assert.strictEqual(widget.value, undefined, 'widgets in group should get disposed');
		assert.strictEqual(widgetDiffType.value, undefined, 'widgets in group should get disposed');
		assert.notStrictEqual(widgetDiffGroup.value, undefined, 'other group should not be disposed');

		notebookEditorService.dispose();
	});

	test('Widget should move between groups when editor is moved', async function () {
		const inputType1 = createNotebookInput('/test.np', NotebookEditorInput.ID);
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		const initialValue = notebookEditorService.retrieveWidget(instantiationService, 1, inputType1).value;

		await new Promise(resolve => setTimeout(resolve, 0));

		onWillMoveEditor.fire({
			editor: inputType1,
			groupId: 1,
			target: 2,
		});

		const widgetDiffGroup = notebookEditorService.retrieveWidget(instantiationService, 2, inputType1);
		const widgetFirstGroup = notebookEditorService.retrieveWidget(instantiationService, 1, inputType1);

		assert.notStrictEqual(initialValue, undefined, 'valid widget');
		assert.strictEqual(widgetDiffGroup.value, initialValue, 'widget should be reused in new group');
		assert.notStrictEqual(widgetFirstGroup.value, initialValue, 'should create a new widget in the first group');
	});

	test('moving the last widget releases the resource object from its source group', async function () {
		if (typeof globalThis.gc !== 'function') {
			this.skip(); // Run the Electron suite with --js-flags=--expose-gc.
		}
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		function moveWidget(): WeakRef<URI> {
			const input = createNotebookInput('/moved.np', NotebookEditorInput.ID);
			notebookEditorService.retrieveWidget(instantiationService, 1, input);
			// The move uses an equivalent resource object, as editor inputs can do.
			// The target group owns that object; the source should release this one.
			onWillMoveEditor.fire({ editor: createNotebookInput('/moved.np', NotebookEditorInput.ID), groupId: 1, target: 2 });
			return new WeakRef(input.resource);
		}
		const resource = moveWidget();
		await timeout(0);
		await globalThis.gc!({ type: 'major', execution: 'async' });
		assert.strictEqual(resource.deref() === undefined, true, 'Source group still retains the moved resource');
	});

	test('closing the last widget releases its resource object', async function () {
		if (typeof globalThis.gc !== 'function') {
			this.skip(); // Run the Electron suite with --js-flags=--expose-gc.
		}
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		function closeWidget(): WeakRef<URI> {
			const input = createNotebookInput('/closed.np', NotebookEditorInput.ID);
			notebookEditorService.retrieveWidget(instantiationService, 1, input);
			// Use a separate equivalent URI in the real closing input so disposal
			// tracking of that input cannot keep the previously cached URI alive.
			const closingInput = createClosingInput('/closed.np');
			onDidCloseEditor.fire({ editor: closingInput, groupId: 1, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
			closingInput.dispose();
			return new WeakRef(input.resource);
		}
		const resource = closeWidget();
		await timeout(0);
		await globalThis.gc!({ type: 'major', execution: 'async' });
		assert.strictEqual(resource.deref() === undefined, true, 'Group still retains the closed resource');
	});

	test('closing an editor preserves another editor type for the same resource', async () => {
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		const input = createClosingInput('/shared.np');
		const closed = notebookEditorService.retrieveWidget(instantiationService, 1, input);
		const other = notebookEditorService.retrieveWidget(instantiationService, 1, createNotebookInput('/shared.np', 'other-type'));
		const otherValue = other.value;
		const event = { editor: input, groupId: 1, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false };
		onDidCloseEditor.fire(event);
		onDidCloseEditor.fire(event);
		assert.deepStrictEqual([closed.value, other.value === otherValue, notebookEditorService.retrieveExistingWidgetFromURI(input.resource)?.value === otherValue], [undefined, true, true]);
	});

	test('moving one editor type preserves the other type in its source group', async () => {
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		const input = createNotebookInput('/shared.np', NotebookEditorInput.ID);
		const moving = notebookEditorService.retrieveWidget(instantiationService, 1, input).value;
		const other = notebookEditorService.retrieveWidget(instantiationService, 1, createNotebookInput('/shared.np', 'other-type')).value;
		onWillMoveEditor.fire({ editor: input, groupId: 1, target: 2 });
		assert.deepStrictEqual([
			notebookEditorService.retrieveExistingWidgetFromURI(input.resource)?.value === other,
			notebookEditorService.retrieveWidget(instantiationService, 2, input).value === moving
		], [true, true]);
	});

	test('a widget reopened during disposal remains available', async () => {
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		const input = createClosingInput('/reopened.np');
		const initial = notebookEditorService.retrieveWidget(instantiationService, 1, input).value!;
		let reopened: NotebookEditorWidget | undefined;
		initial.onWillHide = () => {
			reopened = notebookEditorService.retrieveWidget(instantiationService, 1, input).value;
		};
		onDidCloseEditor.fire({ editor: input, groupId: 1, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
		assert.deepStrictEqual([
			reopened !== undefined && reopened !== initial,
			notebookEditorService.retrieveExistingWidgetFromURI(input.resource)?.value === reopened
		], [true, true]);
	});

	test('moving to another window leaves the source widget for normal disposal', async () => {
		secondWindowId = 1;
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		const input = createNotebookInput('/other-window.np', NotebookEditorInput.ID);
		const source = notebookEditorService.retrieveWidget(instantiationService, 1, input).value;
		onWillMoveEditor.fire({ editor: input, groupId: 1, target: 2 });
		assert.deepStrictEqual([
			notebookEditorService.retrieveExistingWidgetFromURI(input.resource)?.value === source,
			notebookEditorService.retrieveWidget(instantiationService, 2, input).value !== source
		], [true, true]);
	});

	test('moving into a group with an existing matching widget preserves both widgets', async () => {
		const notebookEditorService = disposables.add(instantiationService.createInstance(TestNotebookEditorWidgetService));
		await instantiationService.get(IEditorGroupsService).whenReady;
		const input = createNotebookInput('/existing.np', NotebookEditorInput.ID);
		const source = notebookEditorService.retrieveWidget(instantiationService, 1, input).value;
		const target = notebookEditorService.retrieveWidget(instantiationService, 2, input).value;
		onWillMoveEditor.fire({ editor: input, groupId: 1, target: 2 });
		assert.deepStrictEqual([
			notebookEditorService.retrieveWidget(instantiationService, 1, input).value === source,
			notebookEditorService.retrieveWidget(instantiationService, 2, input).value === target
		], [true, true]);
	});

});
