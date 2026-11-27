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
import { transaction } from '../../../../../base/common/observable.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IDocumentDiff, IDocumentDiffProviderOptions } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { shouldSynchronizeModel } from '../../../../../editor/common/model.js';
import { DiffAlgorithmName, IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { TestEditorWorkerService } from '../../../../../editor/test/common/services/testEditorWorkerService.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IResolvedTextFileEditorModel, ITextFileEditorModel, ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { MergeEditorInput, MergeEditorInputData } from '../../browser/mergeEditorInput.js';
import { ModifiedBaseRangeState } from '../../browser/model/modifiedBaseRange.js';

const conflictText = '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n';

suite('Merge Editor input model factories', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createInput(options: {
		useWorkingCopy?: boolean;
		resultContent?: string;
		beforeRead?: (uri: URI) => Promise<void>;
		beforeSave?: (text: string) => Promise<void>;
		beforeDiff?: (modified: URI, algorithm: DiffAlgorithmName) => Promise<void>;
		onReadModel?: (uri: URI) => void;
	} = {}) {
		const configuration = new TestConfigurationService({ 'mergeEditor.useWorkingCopy': options.useWorkingCopy ?? false });
		const services = workbenchInstantiationService({ configurationService: () => configuration }, disposables);
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
						override get textEditorModel() {
							options.onReadModel?.(uri);
							return textEditorModel;
						}
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
			override async computeDiff(original: URI, modified: URI, diffOptions: IDocumentDiffProviderOptions, algorithm: DiffAlgorithmName): Promise<IDocumentDiff> {
				await options.beforeDiff?.(modified, algorithm);
				const diff = linesDiffComputers.getDefault().computeDiff(modelService.getModel(original)!.getLinesContent(), modelService.getModel(modified)!.getLinesContent(), diffOptions);
				return { identical: diff.changes.length === 0, quitEarly: diff.hitTimeout, changes: diff.changes, moves: diff.moves };
			}
		}());

		const data = (uri: URI) => new MergeEditorInputData(uri, undefined, undefined, undefined);
		const input = disposables.add(services.createInstance(MergeEditorInput, base.uri, data(left.uri), data(right.uri), result.uri));
		return { input, base, left, right, result, references, modelService, configuration };
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
			const leftOwned = new DeferredPromise<void>();
			const heldRead = new DeferredPromise<void>();
			const { input, references } = createInput({
				useWorkingCopy,
				async beforeRead(uri) {
					if (uri.path === '/right') {
						await heldRead.p;
					}
				},
				onReadModel(uri) {
					// The successful providers return in call order. Reading the
					// left model starts after its reference and both earlier ones
					// have been registered with the construction attempt.
					if (uri.path === '/left') {
						void leftOwned.complete();
					}
				},
			});
			const opening = assert.rejects(input.resolve(), CancellationError);
			const matching = assert.rejects(input.resolve(), CancellationError);
			await leftOwned.p;
			assert.strictEqual(references.length, 3);
			input.dispose();

			try {
				assert.ok(references.every(ref => ref.disposals === 1));
				await Promise.all([opening, matching]);
				assert.ok(!heldRead.isSettled);
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

	test('refreshes a live preparation after a source-only edit', async () => {
		const started = new DeferredPromise<void>();
		const firstPreparedDiff = new DeferredPromise<void>();
		let preparations = 0;
		const { input, left, result } = createInput({
			resultContent: conflictText,
			async beforeDiff(modified) {
				if (modified.scheme === Schemas.inMemory && ++preparations === 1) {
					void started.complete();
					await firstPreparedDiff.p;
				}
			},
		});
		const opening = input.resolve();
		await started.p;
		left.setValue('original');
		await firstPreparedDiff.complete();

		const { model } = await opening;
		assert.strictEqual(preparations, 2);
		assert.ok(model.isUpToDate.get());
		assert.strictEqual(result.getValue(), 'right');
		input.dispose();
	});

	test('a new diff algorithm failure preserves the rollback text and undo history', async () => {
		const setting = 'mergeEditor.diffAlgorithm';
		const advancedStarted = new DeferredPromise<void>();
		const legacyStarted = new DeferredPromise<void>();
		const heldAdvanced = new DeferredPromise<void>();
		const heldLegacy = new DeferredPromise<void>();
		const failure = new Error('Legacy input diff failed');
		const saves: string[] = [];
		const preparedAlgorithms: DiffAlgorithmName[] = [];
		let holdLegacy = true;
		const { input, result, configuration } = createInput({
			resultContent: conflictText,
			async beforeSave(text) { saves.push(text); },
			async beforeDiff(modified, algorithm) {
				if (modified.scheme === Schemas.inMemory) {
					preparedAlgorithms.push(algorithm);
					if (algorithm === 'advanced') {
						void advancedStarted.complete();
						await heldAdvanced.p;
					}
				}
				if (modified.path === '/left' && algorithm === 'legacy' && holdLegacy) {
					holdLegacy = false;
					void legacyStarted.complete();
					await heldLegacy.p;
				}
			},
		});
		const opening = assert.rejects(input.resolve(), error => error === failure);
		await advancedStarted.p;

		await configuration.setUserConfiguration(setting, 'legacy');
		configuration.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set([setting]),
			change: { keys: [setting], overrides: [] },
			affectsConfiguration: section => section === setting,
		});
		await legacyStarted.p;
		await heldAdvanced.complete();
		await heldLegacy.error(failure);
		await opening;

		assert.strictEqual(result.getValue(), conflictText);
		assert.strictEqual(result.canUndo(), false);
		const { model } = await input.resolve();
		assert.ok(model.isUpToDate.get());
		assert.deepStrictEqual(preparedAlgorithms, ['advanced', 'legacy']);
		assert.deepStrictEqual(saves, [conflictText, conflictText]);
		input.dispose();
	});

	test('preserves literal leading U+FEFF and keeps preparation out of document synchronization', async () => {
		const { input, base, result, modelService } = createInput({ resultContent: conflictText });
		base.applyEdits([{ range: new Range(1, 1, 1, 1), text: '\uFEFF' }]);
		const eligible: boolean[] = [];
		disposables.add(modelService.onModelAdded(model => {
			if (model.uri.scheme === Schemas.inMemory) {
				eligible.push(shouldSynchronizeModel(model));
			}
		}));

		const { model } = await input.resolve();
		assert.strictEqual(result.getValue(), '\uFEFForiginal');
		assert.strictEqual(model.baseResultDiffs.get().length, 0);
		assert.deepStrictEqual(eligible, [false]);
		assert.ok(modelService.getModels().every(model => model.uri.scheme !== Schemas.inMemory));
		input.dispose();
	});

	test('projects nonempty prepared mappings onto the live result before accepting a conflict', async () => {
		const { input, base, left, right, result, modelService } = createInput({ resultContent: conflictText });
		base.setValue('first\nshared\noriginal\nlast');
		left.setValue('left-only\nshared\nleft\nlast');
		right.setValue('first\nshared\nright\nlast');

		const { model } = await input.resolve();
		assert.strictEqual(result.getValue(), 'left-only\nshared\noriginal\nlast');
		const [change] = model.baseResultDiffs.get();
		assert.strictEqual(model.baseResultDiffs.get().length, 1);
		assert.ok(change.outputTextModel === result);
		assert.deepStrictEqual(change.getLineEdit().newLines, ['left-only']);
		assert.ok(modelService.getModels().every(model => model.uri.scheme !== Schemas.inMemory));

		const conflict = model.modifiedBaseRanges.get().find(range => range.isConflicting);
		assert.ok(conflict);
		transaction(tx => model.setState(conflict, ModifiedBaseRangeState.base.withInputValue(2, true), true, tx));
		assert.strictEqual(result.getValue(), 'left-only\nshared\nright\nlast');
		assert.strictEqual(model.unhandledConflictsCount.get(), 0);
		input.dispose();
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
