/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { NullOpenerService } from '../../../../../platform/opener/test/common/nullOpenerService.js';
import { IEditorProgressService } from '../../../../../platform/progress/common/progress.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IEditorMemento } from '../../../../common/editor.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IReplaceService } from '../../../search/browser/replace.js';
import { INotebookSearchService } from '../../../search/common/notebookSearch.js';
import { INotebookEditorService } from '../../../notebook/browser/services/notebookEditorService.js';
import { TestEditorGroupView, TestServiceAccessor, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { UntitledTextEditorService } from '../../../../services/untitled/common/untitledTextEditorService.js';
import { SearchEditor } from '../../browser/searchEditor.js';
import { SearchEditorInput } from '../../browser/searchEditorInput.js';
import { SearchEditorData, searchEditorModelFactory } from '../../browser/searchEditorModel.js';
import { defaultSearchConfig } from '../../browser/searchEditorSerialization.js';

class TestSearchEditor extends SearchEditor {
	protected override getEditorMemento<T>(): IEditorMemento<T> {
		return {
			saveEditorState() { },
			loadEditorState() { return undefined; },
			clearEditorState() { },
			clearEditorStateOnDispose() { },
			moveEditorState() { }
		};
	}
}

suite('SearchEditor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.from({ scheme: 'search-editor', fragment: 'pending-editor-test' });

	teardown(() => {
		sinon.restore();
		searchEditorModelFactory.models.delete(resource);
	});

	function createEditor() {
		const configurationService = new TestConfigurationService({ search: { searchOnType: false, searchEditor: {} } });
		store.add(configurationService.onDidChangeConfigurationEmitter);
		const instantiationService = workbenchInstantiationService({ configurationService: () => configurationService }, store);
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		store.add(accessor.untitledTextEditorService as UntitledTextEditorService);
		instantiationService.stub(IUserInteractionService, new MockUserInteractionService());
		instantiationService.stub(ICommandService, {});
		instantiationService.stub(IOpenerService, { ...NullOpenerService });
		instantiationService.stub(IEditorProgressService, {});
		instantiationService.stub(IReplaceService, new class extends mock<IReplaceService>() { }());
		instantiationService.stub(INotebookSearchService, new class extends mock<INotebookSearchService>() { }());
		instantiationService.stub(INotebookEditorService, new class extends mock<INotebookEditorService>() {
			override onDidAddNotebookEditor = Event.None;
		}());
		const root = append(mainWindow.document.body, $('.monaco-workbench'));
		store.add(toDisposable(() => root.remove()));
		const editor = store.add(instantiationService.createInstance(TestSearchEditor, new TestEditorGroupView(1)));
		editor.create(root);
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), 'Pending contents'));
		const input = store.add(instantiationService.createInstance(SearchEditorInput, resource, undefined));
		store.add(toDisposable(() => accessor.modelService.destroyModel(resource)));
		return { accessor, editor, input };
	}

	test('resolves and shows the current input', async () => {
		const { editor, input } = createEditor();
		await editor.setInput(input, { preserveFocus: true }, { newInGroup: true }, CancellationToken.None);
		assert.deepStrictEqual({ input: editor.input === input, contents: editor.getControl().getModel()?.getValue() }, { input: true, contents: 'Pending contents' });
	});

	for (const cancel of ['open token', 'input'] as const) {
		test(`ignores obsolete model cancellation after canceling the ${cancel}`, async () => {
			const { accessor, editor, input } = createEditor();
			const entered = new DeferredPromise<void>();
			const backup = new DeferredPromise<undefined>();
			sinon.stub(accessor.workingCopyBackupService, 'resolve').callsFake(() => {
				void entered.complete();
				return backup.p;
			});
			const token = store.add(new CancellationTokenSource());
			const opening = editor.setInput(input, { preserveFocus: true }, { newInGroup: true }, token.token);
			await entered.p;
			if (cancel === 'open token') {
				token.cancel();
				input.model.dispose();
			} else {
				input.dispose();
			}
			assert.deepStrictEqual({ tokenCanceled: token.token.isCancellationRequested, inputDisposed: input.isDisposed() }, { tokenCanceled: cancel === 'open token', inputDisposed: cancel === 'input' });
			await backup.complete(undefined);
			await opening;
			assert.deepStrictEqual({ model: accessor.modelService.getModel(resource), registered: searchEditorModelFactory.models.has(resource) }, { model: null, registered: false });
		});
	}

	for (const canceled of [false, true]) {
		test(`propagates genuine model errors with canceled token ${canceled}`, async () => {
			const { editor, input } = createEditor();
			const entered = new DeferredPromise<void>();
			const resolving = new DeferredPromise<SearchEditorData>();
			sinon.stub(input, 'resolveModels').callsFake(() => {
				void entered.complete();
				return resolving.p;
			});
			const token = store.add(new CancellationTokenSource());
			const opening = editor.setInput(input, { preserveFocus: true }, { newInGroup: true }, token.token);
			const failure = new Error('Saved search read failed');
			const rejected = assert.rejects(opening, error => error === failure);
			await entered.p;
			if (canceled) {
				token.cancel();
				input.dispose();
			}
			await resolving.error(failure);
			await rejected;
		});
	}

	test('propagates model cancellation for a live input', async () => {
		const { editor, input } = createEditor();
		const failure = new CancellationError();
		sinon.stub(input, 'resolveModels').rejects(failure);
		await assert.rejects(editor.setInput(input, undefined, { newInGroup: true }, CancellationToken.None), error => error === failure);
	});
});
