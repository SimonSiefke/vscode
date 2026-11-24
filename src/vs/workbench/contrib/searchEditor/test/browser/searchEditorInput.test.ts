/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { stub } from 'sinon';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestServiceAccessor, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { SearchEditorInput } from '../../browser/searchEditorInput.js';
import { searchEditorModelFactory } from '../../browser/searchEditorModel.js';
import { defaultSearchConfig, serializeSearchConfiguration } from '../../browser/searchEditorSerialization.js';

suite('SearchEditorInput', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Save As to the backing file keeps the existing input and working copy', async () => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		const resource = URI.from({ scheme: 'search-editor', fragment: 'same-file-save-as' });
		const target = URI.file('/saved.code-search');
		const config = defaultSearchConfig();
		const contents = serializeSearchConfiguration(config) + '\nsearch results';
		instantiationService.invokeFunction(accessor => searchEditorModelFactory.initializeModelFromRawData(accessor, resource, config, 'search results'));
		const source = disposables.add(instantiationService.createInstance(SearchEditorInput, resource, target));
		const { resultsModel } = await source.resolveModels();
		source.setDirty(true);

		accessor.fileDialogService.setPickFileToSave(URI.file(target.fsPath));
		const workingCopies = accessor.workingCopyService.workingCopies;
		const modelUris = [...searchEditorModelFactory.models.keys()];
		const createStub = stub(accessor.textFileService, 'create').resolves([]);
		const readStub = stub(accessor.textFileService, 'read').resolves({
			resource: target, name: 'saved.code-search', size: 0, mtime: 0, ctime: 0, etag: '', readonly: false,
			locked: false, executable: false, encoding: 'utf8', value: contents
		});
		try {
			const saved = await source.saveAs(0);
			if (saved && saved !== source) {
				disposables.add(saved);
			}

			assert.strictEqual(createStub.firstCall.args[0][0].value, contents);
			assert.strictEqual(source.isDirty(), false);
			assert.ok(saved === source, 'Save As must keep the original input');
			assert.strictEqual(readStub.called, false);
			assert.deepStrictEqual(accessor.workingCopyService.workingCopies, workingCopies);
			assert.deepStrictEqual([...searchEditorModelFactory.models.keys()], modelUris);

			source.dispose();
			assert.strictEqual(resultsModel.isDisposed(), true);
			assert.strictEqual(accessor.workingCopyService.has(resource), false);
			assert.strictEqual(searchEditorModelFactory.models.has(resource), false);
		} finally {
			createStub.restore();
			readStub.restore();
		}
	});

	test('disposing during backup lookup prevents an orphan results model', async () => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		const resource = URI.from({ scheme: 'search-editor', fragment: 'disposed-restore' });
		instantiationService.invokeFunction(accessor => searchEditorModelFactory.initializeModelFromExistingModel(accessor, resource, defaultSearchConfig()));
		const input = disposables.add(instantiationService.createInstance(SearchEditorInput, resource, URI.file('/restored.code-search')));
		const lookupStarted = new DeferredPromise<void>();
		const completeLookup = new DeferredPromise<void>();
		const backupStub = stub(accessor.workingCopyBackupService, 'resolve').callsFake(async () => {
			await lookupStarted.complete();
			await completeLookup.p;
			return undefined;
		});
		const restore = input.setMatchRanges([]);
		try {
			await lookupStarted.p;
			input.dispose();
			await completeLookup.complete();
			await restore;

			assert.strictEqual(accessor.modelService.getModel(resource) === null, true);
			assert.strictEqual(searchEditorModelFactory.models.has(resource), false);
			assert.strictEqual(accessor.workingCopyService.has(resource), false);
		} finally {
			await completeLookup.complete();
			await restore;
			accessor.modelService.destroyModel(resource);
			backupStub.restore();
		}
	});

	test('Save As waits for a pending destination read before handing off ownership', async () => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		const resource = URI.from({ scheme: 'search-editor', fragment: 'save-as-source' });
		const config = defaultSearchConfig();
		instantiationService.invokeFunction(accessor => searchEditorModelFactory.initializeModelFromRawData(accessor, resource, config, 'search results'));
		const source = disposables.add(instantiationService.createInstance(SearchEditorInput, resource, undefined));
		const target = URI.file('/saved.code-search');
		accessor.fileDialogService.setPickFileToSave(target);
		const readStarted = new DeferredPromise<void>();
		const finishRead = new DeferredPromise<void>();
		const createStub = stub(accessor.textFileService, 'create').resolves([]);
		const readStub = stub(accessor.textFileService, 'read').callsFake(async () => {
			await readStarted.complete();
			await finishRead.p;
			return { resource: target, name: 'saved.code-search', size: 0, mtime: 0, ctime: 0, etag: '', readonly: false, locked: false, executable: false, encoding: 'utf8', value: serializeSearchConfiguration(config) + '\nsearch results' };
		});
		let returned = false;
		const save = source.saveAs(0).then(input => {
			returned = true;
			return input;
		});
		try {
			await readStarted.p;
			assert.strictEqual(returned, false);
			await finishRead.complete();
			const candidate = await save;
			assert.ok(candidate instanceof SearchEditorInput);
			disposables.add(candidate);
			const { resultsModel } = await candidate.resolveModels();
			assert.strictEqual(resultsModel.getValue(), 'search results');
			disposables.add(candidate.acquire()).dispose();
			assert.deepStrictEqual({
				disposed: candidate.isDisposed(),
				modelDisposed: resultsModel.isDisposed(),
				registered: searchEditorModelFactory.models.has(candidate.modelUri),
				workingCopy: accessor.workingCopyService.has(candidate.modelUri)
			}, { disposed: true, modelDisposed: true, registered: false, workingCopy: false });
		} finally {
			await finishRead.complete();
			const candidate = await save;
			candidate?.dispose();
			createStub.restore();
			readStub.restore();
		}
	});
});
