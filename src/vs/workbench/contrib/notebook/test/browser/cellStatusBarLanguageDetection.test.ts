/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILanguageDetectionService } from '../../../../services/languageDetection/common/languageDetectionWorkerService.js';
import { CellStatusBarLanguageDetectionProvider } from '../../browser/contrib/cellStatusBar/statusBarProviders.js';
import { NotebookTextModel } from '../../common/model/notebookTextModel.js';
import { CellKind } from '../../common/notebookCommon.js';
import { INotebookKernel, INotebookKernelService } from '../../common/notebookKernelService.js';
import { INotebookService } from '../../common/notebookService.js';
import { setupInstantiationService } from './testNotebookEditor.js';

suite('Notebook cell language detection lifetime', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let provider: CellStatusBarLanguageDetectionProvider;
	let notebook: NotebookTextModel;
	let detections: number;
	let detectionResult: Promise<string>;
	let configuration: TestConfigurationService;

	setup(() => {
		instantiationService = setupInstantiationService(disposables);
		configuration = new TestConfigurationService({ workbench: { editor: { languageDetectionHints: { notebookEditors: true } } } });
		disposables.add(configuration.onDidChangeConfigurationEmitter);
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(IKeybindingService, new MockKeybindingService());
		instantiationService.stub(INotebookService, new class extends mock<INotebookService>() {
			override getNotebookTextModel(): NotebookTextModel { return notebook; }
		});
		instantiationService.stub(INotebookKernelService, new class extends mock<INotebookKernelService>() {
			override getSelectedOrSuggestedKernel(): INotebookKernel {
				return new class extends mock<INotebookKernel>() { override supportedLanguages = ['plaintext', 'python']; };
			}
		});
		detections = 0;
		detectionResult = Promise.resolve('python');
		instantiationService.stub(ILanguageDetectionService, new class extends mock<ILanguageDetectionService>() {
			override async detectLanguage(): Promise<string> { detections++; return detectionResult; }
		});
		provider = instantiationService.createInstance(CellStatusBarLanguageDetectionProvider);
	});

	function openNotebook(path = 'language'): NotebookTextModel {
		const model = disposables.add(instantiationService.createInstance(NotebookTextModel, 'test-notebook', URI.parse(`test:///${path}`), [{ source: 'sample', language: 'plaintext', mime: undefined, cellKind: CellKind.Code, outputs: [] }], {}, {
			transientOutputs: false, transientCellMetadata: {}, transientDocumentMetadata: {}, cellContentMetadata: {}
		}));
		model.cells[0].textModel = disposables.add(createTextModel('sample', 'plaintext', undefined, model.cells[0].uri));
		notebook = model;
		return model;
	}

	test('reopening the same URI does not reuse a closed cell language hint', async () => {
		const first = openNotebook();
		await provider.provideCellStatusBarItems(first.uri, 0, CancellationToken.None);
		first.cells[0].textModel!.setValue('print(42)');
		const detected = await provider.provideCellStatusBarItems(first.uri, 0, CancellationToken.None);
		first.dispose();
		const second = openNotebook();
		const reopened = await provider.provideCellStatusBarItems(second.uri, 0, CancellationToken.None);
		assert.deepStrictEqual([detected?.items.length, reopened?.items.length, detections], [1, 0, 1]);
	});

	test('unchanged live cells reuse their detected language', async () => {
		const model = openNotebook();
		model.cells[0].textModel!.setValue('print(42)');
		const first = await provider.provideCellStatusBarItems(model.uri, 0, CancellationToken.None);
		const second = await provider.provideCellStatusBarItems(model.uri, 0, CancellationToken.None);
		assert.deepStrictEqual([first?.items.length, second?.items.length, detections], [1, 1, 1]);
	});

	test('another notebook does not inherit a language hint', async () => {
		const first = openNotebook();
		first.cells[0].textModel!.setValue('print(42)');
		await provider.provideCellStatusBarItems(first.uri, 0, CancellationToken.None);
		const second = openNotebook('other');
		const result = await provider.provideCellStatusBarItems(second.uri, 0, CancellationToken.None);
		assert.deepStrictEqual([result?.items.length, detections], [0, 1]);
	});

	test('disabled hints do not request language detection', async () => {
		const model = openNotebook();
		model.cells[0].textModel!.setValue('print(42)');
		await configuration.setUserConfiguration('workbench.editor.languageDetectionHints', { notebookEditors: false });
		const result = await provider.provideCellStatusBarItems(model.uri, 0, CancellationToken.None);
		assert.deepStrictEqual([result, detections], [undefined, 0]);
	});

	test('a late language detection cannot populate a reopened cell cache', async () => {
		const pending = new DeferredPromise<string>();
		detectionResult = pending.p;
		const first = openNotebook();
		first.cells[0].textModel!.setValue('print(42)');
		const request = provider.provideCellStatusBarItems(first.uri, 0, CancellationToken.None);
		first.dispose();
		const second = openNotebook();
		await provider.provideCellStatusBarItems(second.uri, 0, CancellationToken.None);
		await pending.complete('python');
		const original = await request;
		const reopened = await provider.provideCellStatusBarItems(second.uri, 0, CancellationToken.None);
		assert.deepStrictEqual([original?.items.length, reopened?.items.length, detections], [1, 0, 1]);
	});
});
