/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { assertReturnsDefined } from '../../../../../base/common/types.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDocumentDiff, IDocumentDiffProviderOptions } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { TestEditorWorkerService } from '../../../../../editor/test/common/services/testEditorWorkerService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IResolvedTextFileEditorModel, ITextFileEditorModel, ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { MergeEditorInput, MergeEditorInputData } from '../../browser/mergeEditorInput.js';

suite('Merge Editor input model factories', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createInput(options: {
		useWorkingCopy?: boolean;
		resultContent?: string;
		beforeRead?: (uri: URI) => Promise<void>;
		beforeDiff?: (modified: URI) => Promise<void>;
	} = {}) {
		const services = workbenchInstantiationService({
			configurationService: () => new TestConfigurationService({ 'mergeEditor.useWorkingCopy': options.useWorkingCopy ?? false }),
		}, disposables);
		const modelService = services.get(IModelService);
		const makeModel = (name: string, content: string) => disposables.add(modelService.createModel(content, null, URI.from({ scheme: 'test-merge', path: `/${name}` })));
		const base = makeModel('base', 'original');
		const left = makeModel('left', 'left');
		const right = makeModel('right', 'right');
		const result = makeModel('result', options.resultContent ?? 'original');

		const references: { uri: URI; disposals: number }[] = [];
		services.stub(ITextModelService, {
			async createModelReference(uri) {
				await options.beforeRead?.(uri);
				const textEditorModel = assertReturnsDefined(modelService.getModel(uri));
				const record = { uri, disposals: 0 };
				references.push(record);
				return {
					object: new class extends mock<IResolvedTextEditorModel>() {
						override readonly textEditorModel = textEditorModel;
					},
					dispose: () => { record.disposals++; },
				};
			}
		});
		const file = new class extends mock<ITextFileEditorModel>() {
			override readonly resource = result.uri;
			override readonly textEditorModel = result;
			override readonly onDidChangeDirty = Event.None;
			override readonly onDidSaveError = Event.None;
			override isDirty(): this is IResolvedTextFileEditorModel { return false; }
			override async save(): Promise<boolean> { return true; }
		};
		services.stub(ITextFileService, {
			files: new class extends mock<ITextFileEditorModelManager>() {
				override readonly models = [file];
			},
		});
		services.stub(IEditorWorkerService, new class extends TestEditorWorkerService {
			override async computeDiff(original: URI, modified: URI, diffOptions: IDocumentDiffProviderOptions): Promise<IDocumentDiff> {
				await options.beforeDiff?.(modified);
				const diff = linesDiffComputers.getDefault().computeDiff(modelService.getModel(original)!.getLinesContent(), modelService.getModel(modified)!.getLinesContent(), diffOptions);
				return { identical: diff.changes.length === 0, quitEarly: diff.hitTimeout, changes: diff.changes, moves: diff.moves };
			}
		}());

		const data = (uri: URI) => new MergeEditorInputData(uri, undefined, undefined, undefined);
		const input = disposables.add(services.createInstance(MergeEditorInput, base.uri, data(left.uri), data(right.uri), result.uri));
		return { input, result, references };
	}

	for (const useWorkingCopy of [false, true]) {
		test(`releases references before and after a failed ${useWorkingCopy ? 'temporary' : 'workspace'} read`, async () => {
			const failure = new Error('Result read failed');
			const allowRight = new DeferredPromise<void>();
			let firstAttempt = true;
			const { input, references } = createInput({
				useWorkingCopy,
				async beforeRead(uri) {
					if (firstAttempt && uri.path === '/result') {
						throw failure;
					}
					if (firstAttempt && uri.path === '/right') {
						await allowRight.p;
					}
				},
			});

			await assert.rejects(input.resolve(), error => error === failure);
			assert.deepStrictEqual(references.map(ref => [ref.uri.path, ref.disposals]), [['/base', 1], ['/left', 1]]);
			await allowRight.complete();
			firstAttempt = false;
			await input.resolve();
			input.dispose();

			assert.deepStrictEqual(
				references.map(ref => ref.uri.path).sort(),
				['/base', '/base', '/left', '/left', '/result', '/right', '/right'],
			);
			assert.ok(references.every(ref => ref.disposals === 1));
		});
	}

	test('retries a live input after the initial diff worker fails', async () => {
		const failure = new Error('Initial diff failed');
		let computeCalls = 0;
		const { input, references } = createInput({
			async beforeDiff() {
				if (++computeCalls === 1) {
					throw failure;
				}
			},
		});

		await assert.rejects(input.resolve(), error => error === failure);
		assert.strictEqual(references.length, 4);
		assert.ok(references.every(ref => ref.disposals === 1));

		const model = await input.resolve();
		assert.ok(!model.model.isDisposed());
		assert.strictEqual(computeCalls, 6);
		input.dispose();
		assert.strictEqual(references.length, 8);
		assert.ok(references.every(ref => ref.disposals === 1));
	});

	test('closing the input during initialization preserves a later edit to the result', async () => {
		const started = new DeferredPromise<void>();
		const allowDiff = new DeferredPromise<void>();
		const { input, result, references } = createInput({
			resultContent: '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n',
			async beforeDiff(modified) {
				if (modified.path === '/left') {
					void started.complete();
					await allowDiff.p;
				}
			},
		});
		const opening = assert.rejects(input.resolve(), CancellationError);
		await started.p;
		assert.strictEqual(input.closeHandler.showConfirm(), false);
		input.dispose();

		const edited = 'Edit made after closing the merge';
		result.setValue(edited);
		await allowDiff.complete();
		await opening;

		assert.strictEqual(result.getValue(), edited);
		assert.strictEqual(references.length, 4);
		assert.ok(references.every(ref => ref.disposals === 1));
	});
});
