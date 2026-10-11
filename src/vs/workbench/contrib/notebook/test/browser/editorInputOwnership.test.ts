/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { InteractiveDocumentService, IInteractiveDocumentService } from '../../../interactive/browser/interactiveDocumentService.js';
import { InteractiveHistoryService, IInteractiveHistoryService } from '../../../interactive/browser/interactiveHistoryService.js';
import { InteractiveEditorInput } from '../../../interactive/browser/interactiveEditorInput.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { createEditorPart, registerTestEditor, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { NotebookEditorInput } from '../../common/notebookEditorInput.js';
import { NotebookDiffEditorInput } from '../../common/notebookDiffEditorInput.js';
import { INotebookEditorModelResolverService } from '../../common/notebookEditorModelResolverService.js';
import { INotebookService } from '../../common/notebookService.js';
import { NotebookTextModel } from '../../common/model/notebookTextModel.js';

suite('Notebook editor input ownership', () => {
	const disposables = new DisposableStore();
	let instantiationService: TestInstantiationService;
	let notebookAdded: Emitter<NotebookTextModel>;

	setup(() => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		notebookAdded = disposables.add(new Emitter<NotebookTextModel>());
		instantiationService.stub(INotebookService, { onDidAddNotebookDocument: notebookAdded.event, canResolve: async () => false });
		instantiationService.stub(INotebookEditorModelResolverService, {});
	});

	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	function createInput(resource = URI.file('/test.ipynb')) {
		return disposables.add(NotebookEditorInput.getOrCreate(instantiationService, resource, undefined, 'test-notebook'));
	}

	test('37 overlapping notebook opens release every unused input without factory caching', async () => {
		disposables.add(registerTestEditor('TestNotebookOwnershipEditor', [new SyncDescriptor(NotebookEditorInput)]));
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const service = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, service);
		const created: NotebookEditorInput[] = [];
		disposables.add(instantiationService.get(IEditorResolverService).registerEditor('*.ipynb',
			{ id: 'test-notebook', label: 'Test Notebook', priority: RegisteredEditorPriority.default }, {}, {
			createEditorInput: ({ resource }) => {
				const editor = createInput(resource);
				created.push(editor);
				return { editor };
			}
		}));
		for (let iteration = 0; iteration < 37; iteration++) {
			await Promise.all([
				service.openEditor({ resource: URI.file('/test.ipynb'), options: { override: 'test-notebook', pinned: true } }),
				service.openEditor({ resource: URI.file('/test.ipynb'), options: { override: 'test-notebook', pinned: true } })
			]);
			assert.strictEqual(created.filter(input => !input.isDisposed()).length, 1);
			await part.activeGroup.closeAllEditors();
			assert.strictEqual(notebookAdded.hasListeners(), false);
		}
		assert.strictEqual(created.length, 74);
	});

	for (const closePrimary of [false, true]) {
		test(`Interactive document ownership survives ${closePrimary ? 'forced child disposal' : 'unused duplicate disposal'}`, async () => {
			const documents = disposables.add(new InteractiveDocumentService());
			instantiationService.stub(IInteractiveDocumentService, documents);
			instantiationService.stub(IInteractiveHistoryService, disposables.add(new InteractiveHistoryService()));
			const textModel = disposables.add(createTextModel(''));
			const model = new class extends mock<IResolvedTextEditorModel>() {
				override readonly textEditorModel = textModel;
			};
			instantiationService.stub(ITextModelService, 'createModelReference', async () => ({ object: model, dispose() { } }));
			const createInteractive = () => disposables.add(instantiationService.createInstance(InteractiveEditorInput,
				URI.parse('untitled:/test.interactive'), URI.parse('vscode-interactive-input:/test'), undefined, undefined));
			const input = createInteractive();
			const owner = disposables.add(input.acquire());
			await input.resolveInput();
			let removed = 0;
			disposables.add(documents.onWillRemoveInteractiveDocument(() => { removed++; }));
			if (closePrimary) {
				input.notebookEditorInput.dispose();
				assert.strictEqual(input.isDisposed(), true);
			} else {
				const duplicate = createInteractive();
				disposables.add(duplicate.acquire()).dispose();
				assert.strictEqual(removed, 0);
				assert.strictEqual(input.notebookEditorInput.isDisposed(), false);
			}
			owner.dispose();
			input.dispose();
			assert.strictEqual(removed, 1);
		});
	}

	test('disposing a notebook diff releases its privately owned children', () => {
		const diff = disposables.add(NotebookDiffEditorInput.create(instantiationService, URI.file('/modified.ipynb'), undefined, undefined, URI.file('/original.ipynb'), 'test-notebook'));
		const owner = disposables.add(diff.acquire());
		owner.dispose();
		assert.deepStrictEqual([diff.isDisposed(), diff.original.isDisposed(), diff.modified.isDisposed(), notebookAdded.hasListeners()], [true, true, true, false]);
	});
});
