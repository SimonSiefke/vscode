/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { assertReturnsDefined } from '../../../../../base/common/types.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationError, errorHandler, setUnexpectedErrorHandler } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
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

const conflictText = '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n';

suite('Merge Editor input model factories', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createInput(options: {
		useWorkingCopy?: boolean;
		resultContent?: string;
		beforeRead?: (uri: URI) => Promise<void>;
		beforeSave?: (text: string) => Promise<void>;
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
			override async save(): Promise<boolean> {
				await options.beforeSave?.(result.getValue());
				return true;
			}
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
		return { input, result, references, modelService };
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

	for (const hasMarkers of [false, true]) {
		test(`closing during initialization ${hasMarkers ? 'with' : 'without'} conflict markers preserves a later edit`, async () => {
			const started = new DeferredPromise<void>();
			const allowDiff = new DeferredPromise<void>();
			const { input, result, references } = createInput({
				resultContent: hasMarkers ? conflictText : 'original',
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
	}

	for (const useWorkingCopy of [false, true]) {
		test(`closing a ${useWorkingCopy ? 'temporary' : 'workspace'} merge cancels the open while a provider is held`, async () => {
			const started = new DeferredPromise<void>();
			const heldRead = new DeferredPromise<void>();
			const { input, references } = createInput({
				useWorkingCopy,
				async beforeRead(uri) {
					if (uri.path === '/right') {
						void started.complete();
						await heldRead.p;
					}
				},
			});
			const opening = assert.rejects(input.resolve(), CancellationError);
			const matching = assert.rejects(input.resolve(), CancellationError);
			await started.p;
			input.dispose();

			try {
				await Promise.all([opening, matching]);
				assert.ok(!heldRead.isSettled);
				assert.strictEqual(references.length, 3);
				assert.ok(references.every(ref => ref.disposals === 1));
			} finally {
				await heldRead.error(new Error('Provider failed after close'));
			}
		});
	}

	test('closing during the workspace save cancels the open while the save is held', async () => {
		const started = new DeferredPromise<void>();
		const heldSave = new DeferredPromise<void>();
		const { input, references } = createInput({
			async beforeSave() {
				void started.complete();
				await heldSave.p;
			},
		});
		const opening = assert.rejects(input.resolve(), CancellationError);
		await started.p;
		input.dispose();

		try {
			await opening;
			assert.ok(!heldSave.isSettled);
			assert.strictEqual(references.length, 4);
			assert.ok(references.every(ref => ref.disposals === 1));
		} finally {
			await heldSave.error(new Error('Save failed after close'));
		}
	});

	test('a failed reset diff leaves the rollback text and undo history intact on retry', async () => {
		const failure = new Error('Prepared result diff failed');
		const saved: string[] = [];
		let fail = true;
		const { input, result, modelService } = createInput({
			resultContent: conflictText,
			async beforeSave(text) { saved.push(text); },
			async beforeDiff(modified) {
				if (modified.scheme === Schemas.inMemory && fail) {
					throw failure;
				}
			},
		});

		await assert.rejects(input.resolve(), error => error === failure);
		assert.strictEqual(result.getValue(), conflictText);
		assert.strictEqual(result.canUndo(), false);
		assert.ok(modelService.getModels().every(model => model.uri.scheme !== Schemas.inMemory));
		fail = false;
		const { model } = await input.resolve();
		assert.ok(model.isUpToDate.get());
		assert.strictEqual(model.baseResultDiffs.get().length, 0);
		assert.strictEqual(result.getValue(), 'original');
		assert.deepStrictEqual(saved, [conflictText, conflictText]);
		assert.ok(modelService.getModels().every(model => model.uri.scheme !== Schemas.inMemory));
		input.dispose();
	});

	test('does not overwrite edits made while the reset diff is pending', async () => {
		const started = new DeferredPromise<void>();
		const preparedDiff = new DeferredPromise<void>();
		const { input, result } = createInput({
			resultContent: conflictText,
			async beforeDiff(modified) {
				if (modified.scheme === Schemas.inMemory) {
					void started.complete();
					await preparedDiff.p;
				}
			},
		});
		const opening = assert.rejects(input.resolve(), CancellationError);
		await started.p;
		const edited = 'Edited during the pending reset';
		result.setValue(edited);
		await preparedDiff.complete();
		await opening;

		assert.strictEqual(result.getValue(), edited);
	});

	test('reports a current diff worker failure after the model is live', async () => {
		const failure = new Error('Live result diff failed');
		const reported = new DeferredPromise<unknown>();
		let fail = false;
		const { input, result } = createInput({
			async beforeDiff(modified) {
				if (fail && modified.path === '/result') {
					throw failure;
				}
			},
		});

		await input.resolve();
		const previous = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler(error => {
			if (error === failure) {
				void reported.complete(error);
			} else {
				previous(error);
			}
		});
		try {
			fail = true;
			result.setValue('Edited after successful initialization');
			assert.ok((await reported.p) === failure);
		} finally {
			setUnexpectedErrorHandler(previous);
			input.dispose();
		}
	});
});
