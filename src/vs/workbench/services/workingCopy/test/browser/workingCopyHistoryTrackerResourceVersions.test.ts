/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ResourceMap } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService, TestFileService, TestWorkingCopy } from '../../../../test/common/workbenchTestServices.js';
import { IWorkingCopyHistoryService } from '../../common/workingCopyHistory.js';
import { WorkingCopyHistoryTracker } from '../../common/workingCopyHistoryTracker.js';
import { WorkingCopyService } from '../../common/workingCopyService.js';

suite('WorkingCopyHistoryTracker resource versions', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createTracker(defaultUriScheme: string = Schemas.file) {
		const workingCopyService = store.add(new WorkingCopyService());
		const fileService = store.add(new TestFileService());
		const configurationService = new TestConfigurationService();
		store.add(configurationService.onDidChangeConfigurationEmitter);
		const tracker = store.add(new WorkingCopyHistoryTracker(
			workingCopyService,
			new class extends mock<IWorkingCopyHistoryService>() { },
			store.add(new UriIdentityService(fileService)),
			new TestPathService(undefined, defaultUriScheme),
			configurationService,
			new class extends mock<IUndoRedoService>() { },
			new TestContextService(),
			fileService
		));
		const versions = Reflect.get(tracker, 'workingCopyContentVersion') as ResourceMap<number>;
		return { workingCopyService, versions };
	}

	for (const scheme of [Schemas.untitled, 'unsupported-working-copy', Schemas.vscodeNotebookCell]) {
		test(`does not retain versions of discarded ${scheme} working copies`, () => {
			const { workingCopyService, versions } = createTracker();
			for (let index = 0; index < 17; index++) {
				const workingCopy = store.add(new TestWorkingCopy(URI.from({ scheme, path: `/discarded-${index}` })));
				const registration = store.add(workingCopyService.registerWorkingCopy(workingCopy));
				workingCopy.setContent('First contents');
				workingCopy.setContent('Edited contents');
				registration.dispose();
				workingCopy.dispose();
			}

			assert.strictEqual(versions.size, 0);
		});
	}

	for (const defaultUriScheme of [Schemas.file, Schemas.vscodeRemote]) {
		for (const scheme of [defaultUriScheme, Schemas.vscodeUserData, Schemas.inMemory]) {
			test(`preserves ${scheme} content versions with workspace scheme ${defaultUriScheme}`, () => {
				const { workingCopyService, versions } = createTracker(defaultUriScheme);
				const resource = URI.from({ scheme, path: '/tracked' });
				const workingCopy = store.add(new TestWorkingCopy(resource));
				store.add(workingCopyService.registerWorkingCopy(workingCopy));
				workingCopy.setContent('First contents');
				workingCopy.setContent('Edited contents');

				assert.deepStrictEqual({ entries: versions.size, version: versions.get(resource) }, { entries: 1, version: 2 });
			});
		}
	}
});
