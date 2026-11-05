/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SearchEditorModel, searchEditorModelFactory } from '../../browser/searchEditorModel.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { newWriteableStream } from '../../../../../base/common/stream.js';
import { TestServiceAccessor, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { UntitledTextEditorService } from '../../../../services/untitled/common/untitledTextEditorService.js';
import { defaultSearchConfig, serializeSearchConfiguration } from '../../browser/searchEditorSerialization.js';

suite('SearchEditorModel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const resource = URI.from({ scheme: 'search-editor', fragment: 'test' });

	teardown(() => searchEditorModelFactory.models.delete(resource));

	function createServices() {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		store.add(accessor.untitledTextEditorService as UntitledTextEditorService);
		store.add(toDisposable(() => accessor.modelService.destroyModel(resource)));
		return { instantiationService, accessor };
	}

	for (const source of ['raw contents', 'existing model', 'existing file']) {
		test(`disposing while resolving ${source} does not create a text model`, async () => {
			const { instantiationService, accessor } = createServices();
			instantiationService.invokeFunction(services => {
				if (source === 'raw contents') {
					searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), 'Discarded search contents');
				} else if (source === 'existing model') {
					searchEditorModelFactory.initializeModelFromExistingModel(services, resource, defaultSearchConfig());
				} else {
					searchEditorModelFactory.initializeModelFromExistingFile(services, resource, URI.file('/discarded.code-search'));
				}
			});
			const model = store.add(new SearchEditorModel(resource));
			const resolving = model.resolve();
			model.dispose();

			await assert.rejects(resolving, isCancellationError);
			assert.strictEqual(accessor.modelService.getModel(resource), null);
		});
	}

	test('disposed models do not resolve', async () => {
		const { instantiationService, accessor } = createServices();
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), 'Discarded search contents'));
		const model = store.add(new SearchEditorModel(resource));
		model.dispose();

		await assert.rejects(model.resolve(), isCancellationError);
		assert.strictEqual(accessor.modelService.getModel(resource), null);
	});

	test('disposing while reading a backup does not create a text model', async () => {
		const { instantiationService, accessor } = createServices();
		const reading = new DeferredPromise<void>();
		const stream = newWriteableStream<VSBuffer>(chunks => {
			void reading.complete();
			return VSBuffer.concat(chunks);
		});
		store.add(toDisposable(() => stream.destroy()));
		stream.write(VSBuffer.fromString(serializeSearchConfiguration(defaultSearchConfig()) + '\nDiscarded backup contents'));
		const stub = sinon.stub(accessor.workingCopyBackupService, 'resolve').resolves({ value: stream });
		store.add(toDisposable(() => stub.restore()));
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), undefined));
		const model = store.add(new SearchEditorModel(resource));
		const resolving = model.resolve();
		const canceled = assert.rejects(resolving, isCancellationError);
		await reading.p;
		model.dispose();
		stream.end();

		await canceled;
		assert.strictEqual(accessor.modelService.getModel(resource), null);
	});

	test('an obsolete resolution preserves the replacement model', async () => {
		const { instantiationService, accessor } = createServices();
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), 'Discarded contents'));
		const model = store.add(new SearchEditorModel(resource));
		const canceled = assert.rejects(model.resolve(), isCancellationError);
		model.dispose();
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, defaultSearchConfig(), 'Replacement contents'));
		const replacement = store.add(new SearchEditorModel(resource));
		const data = await replacement.resolve();
		await canceled;

		assert.deepStrictEqual({
			current: accessor.modelService.getModel(resource) === data.resultsModel,
			contents: data.resultsModel.getValue()
		}, { current: true, contents: 'Replacement contents' });
	});

	test('concurrent resolutions share the live text model and configuration', async () => {
		const { instantiationService } = createServices();
		instantiationService.invokeFunction(services => searchEditorModelFactory.initializeModelFromRawData(services, resource, { ...defaultSearchConfig(), query: 'query' }, 'Search contents'));
		const model = store.add(new SearchEditorModel(resource));
		const [first, second] = await Promise.all([model.resolve(), model.resolve()]);

		assert.deepStrictEqual({
			same: first === second,
			contents: first.resultsModel.getValue(),
			query: first.configurationModel.config.query
		}, { same: true, contents: 'Search contents', query: 'query' });
	});

	test('does not delete a replacement model when disposed', () => {
		const modelReference = { resolve: () => Promise.reject(new Error('Not implemented')) };
		searchEditorModelFactory.models.set(resource, modelReference);
		const model = new SearchEditorModel(resource);

		const replacementModelReference = { resolve: () => Promise.reject(new Error('Not implemented')) };
		searchEditorModelFactory.models.set(resource, replacementModelReference);
		model.dispose();

		assert.strictEqual(searchEditorModelFactory.models.get(resource), replacementModelReference);
	});
});
