/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IFileQuery, ISearchResultProvider, QueryType, SearchProviderType } from '../../common/search.js';
import { SearchService } from '../../common/searchService.js';

suite('SearchService cache disposal', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const query: IFileQuery = { type: QueryType.File, folderQueries: [{ folder: URI.file('/workspace') }], cacheKey: 'picker-cache' };

	function createService(activation = Promise.resolve(), exists: () => Promise<boolean> = async () => true) {
		const events: string[] = [];
		const service = disposables.add(new SearchService(
			new class extends mock<IModelService>() { },
			new class extends mock<IEditorService>() { },
			NullTelemetryService,
			disposables.add(new NullLogService()),
			new class extends mock<IExtensionService>() {
				override activateByEvent(): Promise<void> { return activation; }
				override async whenInstalledExtensionsRegistered(): Promise<boolean> { return true; }
			},
			new class extends mock<IFileService>() {
				override exists(): Promise<boolean> { return exists(); }
			},
			new class extends mock<IUriIdentityService>() { },
		));
		disposables.add(service.registerSearchResultProvider('file', SearchProviderType.file, new class extends mock<ISearchResultProvider>() {
			override async fileSearch() {
				events.push('search');
				return { results: [], messages: [] };
			}
			override async clearCache() { events.push('clear'); }
		}));
		return { service, events };
	}

	test('clears after a search still waiting for extension activation', async () => {
		const activation = new DeferredPromise<void>();
		const { service, events } = createService(activation.p);
		const search = service.fileSearch(query);
		const clearing = service.clearCache(query.cacheKey!);
		await activation.complete();
		await Promise.all([search, clearing]);
		assert.deepStrictEqual(events, ['search', 'clear']);
	});

	test('clears after the provider work even when the caller has already canceled', async () => {
		const checkingFolder = new DeferredPromise<void>();
		const folderExists = new DeferredPromise<boolean>();
		const { service, events } = createService(Promise.resolve(), () => {
			checkingFolder.complete();
			return folderExists.p;
		});
		const tokenSource = disposables.add(new CancellationTokenSource());
		const search = service.fileSearch(query, tokenSource.token);
		await checkingFolder.p;
		tokenSource.cancel();
		await assert.rejects(search, isCancellationError);
		const clearing = service.clearCache(query.cacheKey!);
		await folderExists.complete(true);
		await clearing;
		assert.deepStrictEqual(events, ['search', 'clear']);
	});

	test('still clears when a pending search fails', async () => {
		const activation = new DeferredPromise<void>();
		const { service, events } = createService(activation.p);
		const search = service.fileSearch(query);
		const rejected = assert.rejects(search, /activation failed/);
		const clearing = service.clearCache(query.cacheKey!);
		await activation.error(new Error('activation failed'));
		await Promise.all([rejected, clearing]);
		assert.deepStrictEqual(events, ['clear']);
	});
});
