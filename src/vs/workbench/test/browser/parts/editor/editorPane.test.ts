/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { stub } from 'sinon';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { EditorGroupView } from '../../../../browser/parts/editor/editorGroupView.js';
import { EditorPane, EditorMemento } from '../../../../browser/parts/editor/editorPane.js';
import { EditorPanes } from '../../../../browser/parts/editor/editorPanes.js';
import { WorkspaceTrustRequiredPlaceholderEditor } from '../../../../browser/parts/editor/editorPlaceholder.js';
import { IEditorSerializer, IEditorFactoryRegistry, EditorExtensions, EditorInputCapabilities, IEditorDescriptor, IEditorOpenContext, IEditorPane } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { workbenchInstantiationService, TestEditorGroupView, TestEditorGroupsService, registerTestResourceEditor, TestEditorInput, createEditorPart, TestTextResourceConfigurationService } from '../../workbenchTestServices.js';
import { TextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { URI } from '../../../../../base/common/uri.js';
import { EditorPaneDescriptor, EditorPaneRegistry } from '../../../../browser/editor.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { TestStorageService, TestWorkspaceTrustManagementService } from '../../../common/workbenchTestServices.js';
import { extUri } from '../../../../../base/common/resources.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

const NullThemeService = new TestThemeService();

const editorRegistry: EditorPaneRegistry = Registry.as(EditorExtensions.EditorPane);
const editorInputRegistry: IEditorFactoryRegistry = Registry.as(EditorExtensions.EditorFactory);

class TestEditor extends EditorPane {

	constructor(group: IEditorGroup,) {
		const disposables = new DisposableStore();
		super('TestEditor', group, NullTelemetryService, NullThemeService, disposables.add(new TestStorageService()));

		this._register(disposables);
	}

	override getId(): string { return 'testEditor'; }
	layout(): void { }
	protected createEditor(): any { }
}

class OtherTestEditor extends EditorPane {

	constructor(group: IEditorGroup,) {
		const disposables = new DisposableStore();
		super('testOtherEditor', group, NullTelemetryService, NullThemeService, disposables.add(new TestStorageService()));

		this._register(disposables);
	}

	override getId(): string { return 'testOtherEditor'; }

	layout(): void { }
	protected createEditor(): any { }
}

class TestInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: EditorInput): string {
		return input.toString();
	}

	deserialize(instantiationService: IInstantiationService, raw: string): EditorInput {
		return {} as EditorInput;
	}
}

class TestInput extends EditorInput {

	readonly resource = undefined;

	override prefersEditorPane<T extends IEditorDescriptor<IEditorPane>>(editors: T[]): T | undefined {
		return editors[1];
	}

	override get typeId(): string {
		return 'testInput';
	}

	override resolve(): any {
		return null;
	}
}

class OtherTestInput extends EditorInput {

	readonly resource = undefined;

	override get typeId(): string {
		return 'otherTestInput';
	}

	override resolve(): any {
		return null;
	}
}
class TestResourceEditorInput extends TextResourceEditorInput { }

suite('EditorPane', () => {

	const disposables = new DisposableStore();

	teardown(() => {
		disposables.clear();
	});

	test('EditorPane API', async () => {
		const group = new TestEditorGroupView(1);
		const editor = new TestEditor(group);
		assert.ok(editor.group);
		const input = disposables.add(new OtherTestInput());
		const options = {};

		assert(!editor.isVisible());
		assert(!editor.input);

		await editor.setInput(input, options, Object.create(null), CancellationToken.None);
		// eslint-disable-next-line local/code-no-any-casts
		assert.strictEqual(<any>input, editor.input);
		editor.setVisible(true);
		assert(editor.isVisible());
		editor.dispose();
		editor.clearInput();
		editor.setVisible(false);
		assert(!editor.isVisible());
		assert(!editor.input);
		assert(!editor.getControl());
	});

	test('EditorPaneDescriptor', () => {
		const editorDescriptor = EditorPaneDescriptor.create(TestEditor, 'id', 'name');
		assert.strictEqual(editorDescriptor.typeId, 'id');
		assert.strictEqual(editorDescriptor.name, 'name');
	});

	test('Editor Pane Registration', function () {
		const editorDescriptor1 = EditorPaneDescriptor.create(TestEditor, 'id1', 'name');
		const editorDescriptor2 = EditorPaneDescriptor.create(OtherTestEditor, 'id2', 'name');

		const oldEditorsCnt = editorRegistry.getEditorPanes().length;
		const oldInputCnt = editorRegistry.getEditors().length;

		disposables.add(editorRegistry.registerEditorPane(editorDescriptor1, [new SyncDescriptor(TestInput)]));
		disposables.add(editorRegistry.registerEditorPane(editorDescriptor2, [new SyncDescriptor(TestInput), new SyncDescriptor(OtherTestInput)]));

		assert.strictEqual(editorRegistry.getEditorPanes().length, oldEditorsCnt + 2);
		assert.strictEqual(editorRegistry.getEditors().length, oldInputCnt + 3);

		assert.strictEqual(editorRegistry.getEditorPane(disposables.add(new TestInput())), editorDescriptor2);
		assert.strictEqual(editorRegistry.getEditorPane(disposables.add(new OtherTestInput())), editorDescriptor2);

		assert.strictEqual(editorRegistry.getEditorPaneByType('id1'), editorDescriptor1);
		assert.strictEqual(editorRegistry.getEditorPaneByType('id2'), editorDescriptor2);
		assert(!editorRegistry.getEditorPaneByType('id3'));
	});

	test('Editor Pane Lookup favors specific class over superclass (match on specific class)', function () {
		const d1 = EditorPaneDescriptor.create(TestEditor, 'id1', 'name');

		disposables.add(registerTestResourceEditor());
		disposables.add(editorRegistry.registerEditorPane(d1, [new SyncDescriptor(TestResourceEditorInput)]));

		const inst = workbenchInstantiationService(undefined, disposables);

		const group = new TestEditorGroupView(1);

		const editor = disposables.add(editorRegistry.getEditorPane(disposables.add(inst.createInstance(TestResourceEditorInput, URI.file('/fake'), 'fake', '', undefined, undefined)))!.instantiate(inst, group));
		assert.strictEqual(editor.getId(), 'testEditor');

		const otherEditor = disposables.add(editorRegistry.getEditorPane(disposables.add(inst.createInstance(TextResourceEditorInput, URI.file('/fake'), 'fake', '', undefined, undefined)))!.instantiate(inst, group));
		assert.strictEqual(otherEditor.getId(), 'workbench.editors.textResourceEditor');
	});

	test('Editor Pane Lookup favors specific class over superclass (match on super class)', function () {
		const inst = workbenchInstantiationService(undefined, disposables);

		const group = new TestEditorGroupView(1);

		disposables.add(registerTestResourceEditor());
		const editor = disposables.add(editorRegistry.getEditorPane(disposables.add(inst.createInstance(TestResourceEditorInput, URI.file('/fake'), 'fake', '', undefined, undefined)))!.instantiate(inst, group));

		assert.strictEqual('workbench.editors.textResourceEditor', editor.getId());
	});

	test('Editor Input Serializer', function () {
		const testInput = disposables.add(new TestEditorInput(URI.file('/fake'), 'testTypeId'));
		workbenchInstantiationService(undefined, disposables).invokeFunction(accessor => editorInputRegistry.start(accessor));
		disposables.add(editorInputRegistry.registerEditorSerializer(testInput.typeId, TestInputSerializer));

		let factory = editorInputRegistry.getEditorSerializer('testTypeId');
		assert(factory);

		factory = editorInputRegistry.getEditorSerializer(testInput);
		assert(factory);

		// throws when registering serializer for same type
		assert.throws(() => editorInputRegistry.registerEditorSerializer(testInput.typeId, TestInputSerializer));
	});

	test('EditorMemento - basics', function () {
		const testGroup0 = new TestEditorGroupView(0);
		const testGroup1 = new TestEditorGroupView(1);
		const testGroup4 = new TestEditorGroupView(4);

		const configurationService = new TestTextResourceConfigurationService();

		const editorGroupService = new TestEditorGroupsService([
			testGroup0,
			testGroup1,
			new TestEditorGroupView(2)
		]);

		interface TestViewState {
			line: number;
		}

		const rawMemento = Object.create(null);
		let memento = disposables.add(new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, editorGroupService, configurationService));

		let res = memento.loadEditorState(testGroup0, URI.file('/A'));
		assert.ok(!res);

		memento.saveEditorState(testGroup0, URI.file('/A'), { line: 3 });
		res = memento.loadEditorState(testGroup0, URI.file('/A'));
		assert.ok(res);
		assert.strictEqual(res.line, 3);

		memento.saveEditorState(testGroup1, URI.file('/A'), { line: 5 });
		res = memento.loadEditorState(testGroup1, URI.file('/A'));
		assert.ok(res);
		assert.strictEqual(res.line, 5);

		// Ensure capped at 3 elements
		memento.saveEditorState(testGroup0, URI.file('/B'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/C'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/D'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/E'), { line: 1 });

		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/A')));
		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/B')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/E')));

		// Save at an unknown group
		memento.saveEditorState(testGroup4, URI.file('/E'), { line: 1 });
		assert.ok(memento.loadEditorState(testGroup4, URI.file('/E'))); // only gets removed when memento is saved
		memento.saveEditorState(testGroup4, URI.file('/C'), { line: 1 });
		assert.ok(memento.loadEditorState(testGroup4, URI.file('/C'))); // only gets removed when memento is saved

		memento.saveState();

		memento = disposables.add(new EditorMemento('id', 'key', rawMemento, 3, editorGroupService, configurationService));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/E')));

		// Check on entries no longer there from invalid groups
		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/E')));
		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/C')));

		memento.clearEditorState(URI.file('/C'), testGroup4);
		memento.clearEditorState(URI.file('/E'));

		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/E')));
	});

	test('EditorMemento - move', function () {
		const testGroup0 = new TestEditorGroupView(0);

		const configurationService = new TestTextResourceConfigurationService();
		const editorGroupService = new TestEditorGroupsService([testGroup0]);

		interface TestViewState { line: number }

		const rawMemento = Object.create(null);
		const memento = disposables.add(new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, editorGroupService, configurationService));

		memento.saveEditorState(testGroup0, URI.file('/some/folder/file-1.txt'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/some/folder/file-2.txt'), { line: 2 });
		memento.saveEditorState(testGroup0, URI.file('/some/other/file.txt'), { line: 3 });

		memento.moveEditorState(URI.file('/some/folder/file-1.txt'), URI.file('/some/folder/file-moved.txt'), extUri);

		let res = memento.loadEditorState(testGroup0, URI.file('/some/folder/file-1.txt'));
		assert.ok(!res);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder/file-moved.txt'));
		assert.strictEqual(res?.line, 1);

		memento.moveEditorState(URI.file('/some/folder'), URI.file('/some/folder-moved'), extUri);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-moved.txt'));
		assert.strictEqual(res?.line, 1);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-2.txt'));
		assert.strictEqual(res?.line, 2);
	});

	test('EditoMemento - use with editor input', function () {
		const testGroup0 = new TestEditorGroupView(0);

		interface TestViewState {
			line: number;
		}

		class TestEditorInput extends EditorInput {
			constructor(public resource: URI, private id = 'testEditorInputForMementoTest') {
				super();
			}
			override get typeId() { return 'testEditorInputForMementoTest'; }
			override async resolve(): Promise<IDisposable | null> { return null; }

			override matches(other: TestEditorInput): boolean {
				return other && this.id === other.id && other instanceof TestEditorInput;
			}
		}

		const rawMemento = Object.create(null);
		const memento = disposables.add(new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, new TestEditorGroupsService(), new TestTextResourceConfigurationService()));

		const testInputA = disposables.add(new TestEditorInput(URI.file('/A')));

		let res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputA, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);
		assert.strictEqual(res.line, 3);

		// State removed when input gets disposed
		testInputA.dispose();
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);
	});

	test('EditoMemento - clear on editor dispose', function () {
		const testGroup0 = new TestEditorGroupView(0);

		interface TestViewState {
			line: number;
		}

		class TestEditorInput extends EditorInput {
			constructor(public resource: URI, private id = 'testEditorInputForMementoTest') {
				super();
			}
			override get typeId() { return 'testEditorInputForMementoTest'; }
			override async resolve(): Promise<IDisposable | null> { return null; }

			override matches(other: TestEditorInput): boolean {
				return other && this.id === other.id && other instanceof TestEditorInput;
			}
		}

		const rawMemento = Object.create(null);
		const memento = disposables.add(new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, new TestEditorGroupsService(), new TestTextResourceConfigurationService()));

		const testInputA = disposables.add(new TestEditorInput(URI.file('/A')));

		let res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputA.resource, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);
		assert.strictEqual(res.line, 3);

		// State not yet removed when input gets disposed
		// because we used resource
		testInputA.dispose();
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);

		const testInputB = disposables.add(new TestEditorInput(URI.file('/B')));

		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputB.resource, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(res);
		assert.strictEqual(res.line, 3);

		memento.clearEditorStateOnDispose(testInputB.resource, testInputB);

		// State removed when input gets disposed
		testInputB.dispose();
		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(!res);
	});

	test('EditorMemento - workbench.editor.sharedViewState', function () {
		const testGroup0 = new TestEditorGroupView(0);
		const testGroup1 = new TestEditorGroupView(1);

		const configurationService = new TestTextResourceConfigurationService(new TestConfigurationService({
			workbench: {
				editor: {
					sharedViewState: true
				}
			}
		}));
		const editorGroupService = new TestEditorGroupsService([testGroup0]);

		interface TestViewState { line: number }

		const rawMemento = Object.create(null);
		const memento = disposables.add(new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, editorGroupService, configurationService));

		const resource = URI.file('/some/folder/file-1.txt');
		memento.saveEditorState(testGroup0, resource, { line: 1 });

		let res = memento.loadEditorState(testGroup0, resource);
		assert.strictEqual(res!.line, 1);

		res = memento.loadEditorState(testGroup1, resource);
		assert.strictEqual(res!.line, 1);

		memento.saveEditorState(testGroup0, resource, { line: 3 });

		res = memento.loadEditorState(testGroup1, resource);
		assert.strictEqual(res!.line, 3);

		memento.saveEditorState(testGroup1, resource, { line: 1 });

		res = memento.loadEditorState(testGroup1, resource);
		assert.strictEqual(res!.line, 1);

		memento.clearEditorState(resource, testGroup0);
		memento.clearEditorState(resource, testGroup1);

		res = memento.loadEditorState(testGroup1, resource);
		assert.strictEqual(res!.line, 1);

		memento.clearEditorState(resource);

		res = memento.loadEditorState(testGroup1, resource);
		assert.ok(!res);
	});

	for (const { name, close, withMatchingOpen, error, reportsFailure } of [
		{ name: 'closing the last editor cancels a pending open', close: 'close', withMatchingOpen: false, error: new CancellationError(), reportsFailure: false },
		{ name: 'closing the last editor cancels its matching pending open', close: 'close', withMatchingOpen: true, error: new CancellationError(), reportsFailure: false },
		{ name: 'closing the last editor suppresses a late error for both pending opens', close: 'close', withMatchingOpen: true, error: new Error('Failed to load input'), reportsFailure: false },
		{ name: 'disposing the input cancels both pending opens before the scheduled close', close: 'dispose', withMatchingOpen: true, error: new CancellationError(), reportsFailure: false },
		{ name: 'reports an error from a pending open that is still current', close: undefined, withMatchingOpen: false, error: new Error('Failed to load input'), reportsFailure: true },
	]) {
		test(name, async () => {
			class PendingEditorInput extends EditorInput {
				readonly resource = URI.file('/pending.txt');
				readonly started = new DeferredPromise<void>();
				readonly finished = new DeferredPromise<void>();
				override get typeId() { return 'pendingEditorInput'; }
			}

			let focusCalls = 0;
			let openCalls = 0;
			class PendingEditor extends TestEditor {
				override getId() { return 'pendingEditor'; }
				override focus() { focusCalls++; }
				override async setInput(input: PendingEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken) {
					openCalls++;
					await super.setInput(input, options, context, token);
					await input.started.complete();
					try {
						await input.finished.p;
					} catch (error) {
						if (!(error instanceof CancellationError) || (!token.isCancellationRequested && !input.isDisposed())) {
							throw error;
						}
					}
				}
			}

			const instantiationService = workbenchInstantiationService(undefined, disposables);
			const part = await createEditorPart(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, part);
			const group = part.activeGroup as EditorGroupView;
			const descriptor = EditorPaneDescriptor.create(PendingEditor, 'pendingEditor', 'Pending Editor');
			disposables.add(editorRegistry.registerEditorPane(descriptor, [new SyncDescriptor(PendingEditorInput)]));

			const failed: EditorInput[] = [];
			const activated: EditorInput[] = [];
			disposables.add(group.onDidOpenEditorFail(editor => failed.push(editor)));
			disposables.add(group.onDidActiveEditorChange(({ editor }) => { if (editor) { activated.push(editor); } }));
			const input = disposables.add(new PendingEditorInput());
			const opening = group.openEditor(input, reportsFailure ? { ignoreError: true } : undefined);
			await input.started.p;
			const matchingOpen = withMatchingOpen ? group.openEditor(input) : undefined;
			if (close === 'close') {
				assert.strictEqual(await group.closeEditor(input), true);
			} else if (close === 'dispose') {
				input.dispose();
			}
			await input.finished.error(error);

			assert.deepStrictEqual({
				opened: (await opening) !== undefined,
				matchingOpened: (await matchingOpen) !== undefined,
				openCalls,
				focusCalls,
				failures: failed.length,
				activations: activated.length,
			}, { opened: false, matchingOpened: false, openCalls: 1, focusCalls: 0, failures: reportsFailure ? 1 : 0, activations: 0 });
			if (close === 'dispose') {
				assert.ok(group.activeEditor === input, 'the disposal close has not run yet');
				assert.strictEqual(await group.closeEditor(input), true);
			}
			assert.strictEqual(group.activeEditorPane, undefined);
			assert.strictEqual(group.activeEditor, null);
		});
	}

	for (const fail of [false, true]) {
		test(`a superseded open does not publish ${fail ? 'its load error' : 'focus'} after loading completes`, async () => {
			class PendingPublicationInput extends EditorInput {
				readonly finished = new DeferredPromise<void>();
				readonly progressStopped = new DeferredPromise<void>();

				constructor(readonly resource: URI) {
					super();
				}

				override get typeId() { return 'pendingPublicationInput'; }
			}

			const focused: EditorInput[] = [];
			class PendingPublicationEditor extends TestEditor {
				override getId() { return 'pendingPublicationEditor'; }

				override focus(): void {
					if (this.input) {
						focused.push(this.input);
					}
				}

				override setInput(input: PendingPublicationInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
					void super.setInput(input, options, context, token);
					disposables.add(token.onCancellationRequested(() => void input.progressStopped.complete()));
					return input.finished.p;
				}
			}

			const instantiationService = workbenchInstantiationService(undefined, disposables);
			const part = await createEditorPart(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, part);
			const group = part.activeGroup;
			const descriptor = EditorPaneDescriptor.create(PendingPublicationEditor, 'pendingPublicationEditor', 'Pending Publication Editor');
			disposables.add(editorRegistry.registerEditorPane(descriptor, [new SyncDescriptor(PendingPublicationInput)]));

			const failureEvents: EditorInput[] = [];
			const activationEvents: EditorInput[] = [];
			disposables.add(group.onDidOpenEditorFail(input => failureEvents.push(input)));
			disposables.add(group.onDidActiveEditorChange(({ editor }) => { if (editor) { activationEvents.push(editor); } }));
			const first = disposables.add(new PendingPublicationInput(URI.file('/pending-first.txt')));
			const second = disposables.add(new PendingPublicationInput(URI.file('/pending-second.txt')));
			const opening = group.openEditor(first, { pinned: true });
			assert.ok(group.activeEditorPane?.input === first);

			if (fail) {
				void first.finished.error(new Error('Failed to load input'));
			} else {
				void first.finished.complete();
			}

			// Progress stops after the load settles but before its result is applied to the pane.
			await first.progressStopped.p;
			const replacing = group.openEditor(second, { pinned: true });
			await second.finished.complete();

			assert.deepStrictEqual({
				oldOpenReturnedPane: (await opening) !== undefined,
				newOpenReturnedPane: (await replacing)?.input === second,
				oldInputAlive: !first.isDisposed(),
				activeInputIsReplacement: group.activeEditor === second,
				visibleInputIsReplacement: group.activeEditorPane?.input === second,
				focusCalls: focused.length,
				focusedReplacement: focused[0] === second,
				oldInputActivated: activationEvents.includes(first),
				failures: failureEvents.length,
			}, {
				oldOpenReturnedPane: false,
				newOpenReturnedPane: true,
				oldInputAlive: true,
				activeInputIsReplacement: true,
				visibleInputIsReplacement: true,
				focusCalls: 1,
				focusedReplacement: true,
				oldInputActivated: false,
				failures: 0,
			});
		});
	}

	test('preserves a newer open when the previous pane creation fails', async () => {
		const creating = new DeferredPromise<void>();

		class FailingInput extends TestInput { }
		class FailingEditor extends TestEditor {
			protected override createEditor(): void {
				void creating.complete();
				throw new Error('Pane creation failed');
			}
		}

		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const group = part.activeGroup;
		disposables.add(editorRegistry.registerEditorPane(
			EditorPaneDescriptor.create(FailingEditor, 'testFailingEditor', 'Failing Editor'), [new SyncDescriptor(FailingInput)]));
		disposables.add(editorRegistry.registerEditorPane(
			EditorPaneDescriptor.create(OtherTestEditor, 'testOtherEditor', 'Replacement Editor'), [new SyncDescriptor(OtherTestInput)]));

		const first = disposables.add(new FailingInput());
		const second = disposables.add(new OtherTestInput());
		const failures: EditorInput[] = [];
		disposables.add(group.onDidOpenEditorFail(input => failures.push(input)));
		const replacing = creating.p.then(() => group.openEditor(second, { pinned: true }));
		const opening = group.openEditor(first, { pinned: true });

		assert.deepStrictEqual({
			oldOpenReturnedPane: (await opening) !== undefined,
			newOpenReturnedPane: (await replacing)?.input === second,
			activeInputIsReplacement: group.activeEditor === second,
			visibleInputIsReplacement: group.activeEditorPane?.input === second,
			oldInputAlive: !first.isDisposed(),
			failures: failures.length,
		}, {
			oldOpenReturnedPane: false,
			newOpenReturnedPane: true,
			activeInputIsReplacement: true,
			visibleInputIsReplacement: true,
			oldInputAlive: true,
			failures: 0,
		});
	});

	for (const forceReload of [false, true]) {
		test(`checks ownership before the group publishes ${forceReload ? 'an input reloaded in place' : 'a replaced preview'}`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, disposables);
			const part = await createEditorPart(instantiationService, disposables);
			instantiationService.stub(IEditorGroupsService, part);
			const group = part.activeGroup;
			disposables.add(editorRegistry.registerEditorPane(
				EditorPaneDescriptor.create(TestEditor, 'testEditor', 'Test Editor'), [new SyncDescriptor(TestInput)]));

			const first = disposables.add(new TestInput());
			const next = forceReload ? first : disposables.add(new TestInput());
			const firstResult = new DeferredPromise<void>();
			const originalOpen = EditorPanes.prototype.openEditor;
			let observeFirst = true;
			const controlledOpen = stub(EditorPanes.prototype, 'openEditor').callsFake(async function (this: EditorPanes, ...args: Parameters<EditorPanes['openEditor']>) {
				const result = await originalOpen.apply(this, args);
				if (observeFirst && args[0] === first) {
					observeFirst = false;
					assert.ok(result.pane?.input === first && !result.cancelled);
					void firstResult.complete();
				}
				return result;
			});

			try {
				const activations: { editor: EditorInput; isExplicit: boolean | undefined }[] = [];
				disposables.add(group.onDidActiveEditorChange(({ editor, isExplicit }) => {
					if (editor) {
						activations.push({ editor, isExplicit });
					}
				}));
				// Start the next open after the pane accepts the first result, before the group receives it.
				const replacing = firstResult.p.then(() => group.openEditor(next, { forceReload, isExplicit: true }));
				const opening = group.openEditor(first);

				assert.deepStrictEqual({
					oldOpenReturnedPane: (await opening) !== undefined,
					newOpenReturnedPane: (await replacing)?.input === next,
					activeInputIsCurrent: group.activeEditor === next,
					visibleInputIsCurrent: group.activeEditorPane?.input === next,
					activationCount: activations.length,
					publishedExplicitReplacement: activations[0]?.editor === next && activations[0].isExplicit,
				}, {
					oldOpenReturnedPane: false,
					newOpenReturnedPane: true,
					activeInputIsCurrent: true,
					visibleInputIsCurrent: true,
					activationCount: 1,
					publishedExplicitReplacement: true,
				});
			} finally {
				controlledOpen.restore();
			}
		});
	}

	test('WorkspaceTrustRequiredEditor', async function () {

		class TrustRequiredTestEditor extends EditorPane {
			constructor(group: IEditorGroup, @ITelemetryService telemetryService: ITelemetryService) {
				super('TestEditor', group, NullTelemetryService, NullThemeService, disposables.add(new TestStorageService()));
			}

			override getId(): string { return 'trustRequiredTestEditor'; }
			layout(): void { }
			protected createEditor(): any { }
		}

		class TrustRequiredTestInput extends EditorInput {

			readonly resource = undefined;

			override get typeId(): string {
				return 'trustRequiredTestInput';
			}

			override get capabilities(): EditorInputCapabilities {
				return EditorInputCapabilities.RequiresTrust;
			}

			override resolve(): any {
				return null;
			}
		}

		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const workspaceTrustService = disposables.add(instantiationService.createInstance(TestWorkspaceTrustManagementService));
		instantiationService.stub(IWorkspaceTrustManagementService, workspaceTrustService);
		workspaceTrustService.setWorkspaceTrust(false);

		const editorPart = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, editorPart);

		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);

		const group = editorPart.activeGroup;

		const editorDescriptor = EditorPaneDescriptor.create(TrustRequiredTestEditor, 'id1', 'name');
		disposables.add(editorRegistry.registerEditorPane(editorDescriptor, [new SyncDescriptor(TrustRequiredTestInput)]));

		const testInput = disposables.add(new TrustRequiredTestInput());

		await group.openEditor(testInput);
		assert.strictEqual(group.activeEditorPane?.getId(), WorkspaceTrustRequiredPlaceholderEditor.ID);

		const getEditorPaneIdAsync = () => new Promise(resolve => {
			disposables.add(editorService.onDidActiveEditorChange(() => {
				resolve(group.activeEditorPane?.getId());
			}));
		});

		workspaceTrustService.setWorkspaceTrust(true);

		assert.strictEqual(await getEditorPaneIdAsync(), 'trustRequiredTestEditor');

		workspaceTrustService.setWorkspaceTrust(false);
		assert.strictEqual(await getEditorPaneIdAsync(), WorkspaceTrustRequiredPlaceholderEditor.ID);

		await group.closeAllEditors();
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
