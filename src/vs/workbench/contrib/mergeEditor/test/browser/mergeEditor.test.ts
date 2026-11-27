/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { stub } from 'sinon';
import { Dimension } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { IDocumentDiff, IDocumentDiffProviderOptions } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { TestEditorWorkerService } from '../../../../../editor/test/common/services/testEditorWorkerService.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { TestEditorGroupView, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { MergeEditorInput, MergeEditorInputData } from '../../browser/mergeEditorInput.js';
import { IMergeEditorInputModel } from '../../browser/mergeEditorInputModel.js';
import { MergeDiffComputer } from '../../browser/model/diffComputer.js';
import { MergeEditorModel } from '../../browser/model/mergeEditorModel.js';
import { MergeEditorTelemetry } from '../../browser/telemetry.js';
import { MergeEditor } from '../../browser/view/mergeEditor.js';

suite('Merge Editor pane', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createPane() {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const modelService = instantiationService.get(IModelService);
		instantiationService.stub(IUserInteractionService, new MockUserInteractionService(false));
		instantiationService.stub(IEditorWorkerService, new class extends TestEditorWorkerService {
			override async computeDiff(original: URI, modified: URI, options: IDocumentDiffProviderOptions): Promise<IDocumentDiff> {
				const diff = linesDiffComputers.getDefault().computeDiff(modelService.getModel(original)!.getLinesContent(), modelService.getModel(modified)!.getLinesContent(), options);
				return { identical: diff.changes.length === 0, quitEarly: diff.hitTimeout, changes: diff.changes, moves: diff.moves };
			}
		}());

		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const pane = disposables.add(instantiationService.createInstance(MergeEditor, new TestEditorGroupView(1)));
		pane.create(container);
		pane.setVisible(true);
		/* eslint-disable local/code-no-bracket-notation-for-identifiers -- Dispose the pane's existing factories on fixture teardown without exposing test-only APIs. */
		const zoneComputer = pane['viewZoneComputer'];
		disposables.add(zoneComputer['conflictActionsFactoryInput1']);
		disposables.add(zoneComputer['conflictActionsFactoryInput2']);
		disposables.add(zoneComputer['conflictActionsFactoryResult']);
		/* eslint-enable local/code-no-bracket-notation-for-identifiers */
		const codeEditorService = instantiationService.get(ICodeEditorService);
		for (const editor of codeEditorService.listCodeEditors()) {
			disposables.add(editor);
		}
		pane.layout(new Dimension(1000, 600));

		function createInput(name: string) {
			const resource = (part: string) => URI.from({ scheme: 'test-merge', path: `/${name}/${part}` });
			const base = disposables.add(modelService.createModel('line one\noriginal\nline three', null, resource('base')));
			const input1 = disposables.add(modelService.createModel('line one\nleft\nline three', null, resource('left')));
			const input2 = disposables.add(modelService.createModel('line one\nright\nline three', null, resource('right')));
			const result = disposables.add(modelService.createModel('line one\noriginal\nline three', null, resource('result')));
			const data = (uri: URI) => new MergeEditorInputData(uri, undefined, undefined, undefined);
			const input = disposables.add(instantiationService.createInstance(MergeEditorInput, base.uri, data(input1.uri), data(input2.uri), result.uri));
			const model = disposables.add(instantiationService.createInstance(
				MergeEditorModel, base, { textModel: input1, title: undefined, description: undefined, detail: undefined },
				{ textModel: input2, title: undefined, description: undefined, detail: undefined }, result,
				instantiationService.createInstance(MergeDiffComputer), { resetResult: false }, new MergeEditorTelemetry(NullTelemetryService),
			));
			const inputModel = new class extends mock<IMergeEditorInputModel>() {
				override readonly resultUri = result.uri;
				override readonly model = model;
				override readonly isDirty = constObservable(false);
			};
			return { input, inputModel, model };
		}

		return { container, pane, createInput, codeEditorService };
	}

	test('releases the closed session and rebinds the cached pane on reopen', async () => {
		const { container, pane, createInput, codeEditorService } = createPane();
		const conflictAction = () => container.querySelector<HTMLElement>('.result .detail .action-label');
		const first = createInput('first');
		stub(first.input, 'resolve').resolves(first.inputModel);
		await first.model.onInitialized;
		await pane.setInput(first.input, undefined, {}, CancellationToken.None);
		pane.setLayout({ kind: 'mixed', showBase: true, showBaseAtTop: true });

		assert.ok(pane.viewModel.get());
		assert.ok(pane.inputModel.get() === first.inputModel);
		assert.ok(conflictAction());
		const baseEditor = codeEditorService.listCodeEditors().find(editor => editor.getModel() === first.model.base);
		assert.ok(baseEditor);
		disposables.add(baseEditor);
		pane.clearInput();
		assert.deepStrictEqual({
			viewModelCleared: pane.viewModel.get() === undefined,
			inputModelCleared: pane.inputModel.get() === undefined,
			baseModelDetached: baseEditor.getModel() === null,
			conflictActionRemoved: conflictAction() === null,
		}, { viewModelCleared: true, inputModelCleared: true, baseModelDetached: true, conflictActionRemoved: true });

		const second = createInput('second');
		stub(second.input, 'resolve').resolves(second.inputModel);
		await second.model.onInitialized;
		await pane.setInput(second.input, undefined, {}, CancellationToken.None);
		assert.ok(pane.viewModel.get()?.model === second.model);
		assert.ok(pane.inputModel.get() === second.inputModel);
		assert.ok(baseEditor.getModel() === second.model.base);
		const resultEditor = codeEditorService.listCodeEditors().find(editor => editor.getModel() === second.model.resultTextModel);
		assert.ok(resultEditor);
		resultEditor.setPosition({ lineNumber: 1, column: 1 });
		const action = conflictAction();
		assert.ok(action);
		action.click();
		assert.strictEqual(resultEditor.getPosition()?.lineNumber, 2);
		pane.clearInput();
	});

	test('does not repopulate a cleared pane when its input finishes with cancellation', async () => {
		const { pane, createInput } = createPane();
		const { input } = createInput('pending');
		const started = new DeferredPromise<void>();
		const pending = new DeferredPromise<IMergeEditorInputModel>();
		stub(input, 'resolve').callsFake(() => {
			void started.complete();
			return pending.p;
		});
		const cancellation = disposables.add(new CancellationTokenSource());
		const opening = pane.setInput(input, undefined, {}, cancellation.token);
		await started.p;
		cancellation.cancel();
		pane.clearInput();
		input.dispose();
		await pending.error(new CancellationError());
		await opening;
		assert.ok(pane.viewModel.get() === undefined && pane.inputModel.get() === undefined);
	});
});
