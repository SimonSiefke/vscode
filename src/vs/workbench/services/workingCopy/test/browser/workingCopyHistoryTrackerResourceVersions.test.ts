/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, Limiter } from '../../../../../base/common/async.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { FileOperation, FileOperationEvent } from '../../../../../platform/files/common/files.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { createFileStat, TestContextService, TestFileService, TestWorkingCopy } from '../../../../test/common/workbenchTestServices.js';
import { IWorkingCopyHistoryEntryDescriptor, IWorkingCopyHistoryService } from '../../common/workingCopyHistory.js';
import { WorkingCopyHistoryTracker } from '../../common/workingCopyHistoryTracker.js';
import { WorkingCopyService } from '../../common/workingCopyService.js';

suite('WorkingCopyHistoryTracker resource versions', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createTracker(defaultUriScheme: string = Schemas.file, beforeAddEntry?: () => Promise<void>) {
		const workingCopyService = store.add(new WorkingCopyService());
		const fileService = store.add(new TestFileService());
		const configurationService = new TestConfigurationService();
		store.add(configurationService.onDidChangeConfigurationEmitter);
		const pathService = new TestPathService(undefined, defaultUriScheme);
		const addedEntries: URI[] = [];
		const tracker = store.add(new WorkingCopyHistoryTracker(
			workingCopyService,
			new class extends mock<IWorkingCopyHistoryService>() {
				override async addEntry(descriptor: IWorkingCopyHistoryEntryDescriptor) {
					addedEntries.push(descriptor.resource);
					await beforeAddEntry?.();
					return undefined;
				}

				override async moveEntries(_source: URI, target: URI) {
					return [target];
				}
			},
			store.add(new UriIdentityService(fileService)),
			pathService,
			configurationService,
			new class extends mock<IUndoRedoService>() { },
			new TestContextService(),
			fileService
		));
		const versions = Reflect.get(tracker, 'workingCopyContentVersion') as ResourceMap<number>;
		const limiter = Reflect.get(tracker, 'limiter') as Limiter<void>;
		return { workingCopyService, versions, tracker, pathService, addedEntries, whenIdle: () => limiter.whenIdle() };
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

	for (const initialContentChange of [true, false]) {
		test(`preserves history across workspace scheme changes with initial content change ${initialContentChange}`, async () => {
			const { workingCopyService, pathService, addedEntries, whenIdle } = createTracker();
			const workingCopy = store.add(new TestWorkingCopy(URI.file('/tracked')));
			store.add(workingCopyService.registerWorkingCopy(workingCopy));
			if (initialContentChange) {
				workingCopy.setContent('First contents');
			}
			await workingCopy.save({ source: 'test' });
			await whenIdle();
			pathService.defaultUriScheme = 'other-provider';
			workingCopy.setContent('Edited contents');
			pathService.defaultUriScheme = Schemas.file;
			await workingCopy.save({ source: 'test' });
			await whenIdle();

			assert.deepStrictEqual(addedEntries, [workingCopy.resource, workingCopy.resource]);
		});
	}

	test('preserves edits while a version-zero history save is pending and the workspace scheme changes', async () => {
		const firstEntryStarted = new DeferredPromise<void>();
		const finishFirstEntry = new DeferredPromise<void>();
		let calls = 0;
		const { workingCopyService, pathService, addedEntries, whenIdle } = createTracker(Schemas.file, async () => {
			if (++calls === 1) {
				firstEntryStarted.complete();
				await finishFirstEntry.p;
			}
		});
		const workingCopy = store.add(new TestWorkingCopy(URI.file('/pending')));
		store.add(workingCopyService.registerWorkingCopy(workingCopy));
		try {
			await workingCopy.save({ source: 'test' });
			await firstEntryStarted.p;
			pathService.defaultUriScheme = 'other-provider';
			workingCopy.setContent('Edited during save');
		} finally {
			finishFirstEntry.complete();
			await whenIdle();
		}
		pathService.defaultUriScheme = Schemas.file;
		await workingCopy.save({ source: 'test' });
		await whenIdle();

		assert.deepStrictEqual(addedEntries, [workingCopy.resource, workingCopy.resource]);
	});

	test('preserves edits to moved history without a prior content version across workspace scheme changes', async () => {
		const { workingCopyService, tracker, pathService, addedEntries, whenIdle } = createTracker();
		const resource = URI.file('/moved');
		const event = new FileOperationEvent(URI.file('/original'), FileOperation.MOVE, createFileStat(resource));
		await Reflect.apply(Reflect.get(tracker, 'onDidRunFileOperation'), tracker, [event]);
		const workingCopy = store.add(new TestWorkingCopy(resource));
		store.add(workingCopyService.registerWorkingCopy(workingCopy));
		pathService.defaultUriScheme = 'other-provider';
		workingCopy.setContent('Edited after move');
		pathService.defaultUriScheme = Schemas.file;
		await workingCopy.save({ source: 'test' });
		await whenIdle();

		assert.deepStrictEqual(addedEntries, [resource]);
	});
});
