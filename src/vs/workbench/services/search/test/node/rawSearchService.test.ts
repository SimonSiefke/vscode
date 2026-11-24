/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileQuery, IProgressMessage, IRawFileMatch, ISearchEngine, ISearchEngineSuccess, QueryType } from '../../common/search.js';
import { SearchService } from '../../node/rawSearchService.js';

suite('RawSearchService cancellation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('a canceled request does not start a file search', async () => {
		let searches = 0;
		class Engine implements ISearchEngine<IRawFileMatch> {
			search(onResult: (match: IRawFileMatch) => void, _onProgress: (progress: IProgressMessage) => void, done: (error: Error | null, complete: ISearchEngineSuccess) => void): void {
				searches++;
				onResult({ base: '/workspace', relativePath: 'file.json', searchPath: undefined });
				done(null, { limitHit: false, stats: { fileWalkTime: 0, cmdTime: 0, directoriesWalked: 1, filesWalked: 1 }, messages: [] });
			}
			cancel(): void { }
		}

		const service = new SearchService();
		const query: IFileQuery = {
			type: QueryType.File,
			folderQueries: [{ folder: URI.file('/workspace') }],
			cacheKey: 'disposed-quick-open',
			sortByScore: true,
			filePattern: ''
		};
		try {
			await service.clearCache(query.cacheKey!);
			// A request already sent over RPC can arrive after its picker was
			// canceled and its cache was cleared.
			await assert.rejects(service.doFileSearchWithEngine(Engine, query, () => { }, CancellationToken.Cancelled), isCancellationError);
			assert.strictEqual(searches, 0);
		} finally {
			await service.clearCache(query.cacheKey!);
		}
	});

});
