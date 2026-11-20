/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroupsService, IEditorWorkingSet } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { SCMWorkingSetController } from '../../browser/workingSet.js';
import { ISCMHistoryItemRef, ISCMHistoryProvider } from '../../common/history.js';
import { ISCMProvider, ISCMRepository, ISCMService } from '../../common/scm.js';

suite('SCM working sets', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('releases replaced and disabled branch layouts', async () => {
		const ref = observableValue<ISCMHistoryItemRef>('history item ref', { id: 'a', name: 'a' });
		const history = new class extends mock<ISCMHistoryProvider>() {
			override readonly historyItemRef = ref;
		}();
		const provider = new class extends mock<ISCMProvider>() {
			override readonly providerId = 'test';
			override readonly label = 'test';
			override readonly historyProvider = observableValue<ISCMHistoryProvider | undefined>('history provider', history);
		}();
		const repository = new class extends mock<ISCMRepository>() {
			override readonly provider = provider;
		}();
		const scmService = new class extends mock<ISCMService>() {
			override readonly repositories = [repository];
			override readonly onDidAddRepository = Event.None;
			override readonly onDidRemoveRepository = Event.None;
		}();
		const saved: IEditorWorkingSet[] = [];
		const applied: IEditorWorkingSet[] = [];
		const deleted: IEditorWorkingSet[] = [];
		const deletedBatches: (readonly IEditorWorkingSet[])[] = [];
		const editorGroupsService = new class extends mock<IEditorGroupsService>() {
			override saveWorkingSet(name: string): IEditorWorkingSet {
				const workingSet = { id: String(saved.length), name };
				saved.push(workingSet);
				return workingSet;
			}
			override async applyWorkingSet(workingSet: IEditorWorkingSet | 'empty'): Promise<boolean> {
				assert.ok(workingSet !== 'empty');
				applied.push(workingSet);
				return true;
			}
			override deleteWorkingSet(workingSet: IEditorWorkingSet): void {
				deleted.push(workingSet);
			}
			override deleteWorkingSets(workingSets: readonly IEditorWorkingSet[]): void {
				deletedBatches.push(workingSets);
			}
		}();
		const layoutService = new class extends mock<IWorkbenchLayoutService>() {
			override hasFocus(): boolean { return false; }
		}();
		const storage = disposables.add(new TestStorageService());
		const configuration = new TestConfigurationService({ 'scm.workingSets.enabled': true });
		disposables.add(new SCMWorkingSetController(configuration, editorGroupsService, scmService, storage, layoutService));

		ref.set({ id: 'b', name: 'b' }, undefined);
		ref.set({ id: 'a', name: 'a' }, undefined);
		ref.set({ id: 'b', name: 'b' }, undefined);

		assert.deepStrictEqual({
			saved: saved.map(workingSet => workingSet.name),
			applied: applied.map(workingSet => workingSet.id),
			deleted: deleted.map(workingSet => workingSet.id),
			stored: JSON.parse(storage.get('scm.workingSets', StorageScope.WORKSPACE, '[]'))[0].editorWorkingSets
		}, {
			saved: ['a', 'b', 'a'],
			applied: ['0', '1'],
			deleted: ['0'],
			stored: [['a', { id: '2', name: 'a' }], ['b', { id: '1', name: 'b' }]]
		});

		const persisted = JSON.parse(storage.get('scm.workingSets', StorageScope.WORKSPACE, '[]'));
		persisted[0].editorWorkingSets.push(['damaged', null]);
		storage.store('scm.workingSets', JSON.stringify(persisted), StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const key = 'scm.workingSets.enabled';
		await configuration.setUserConfiguration(key, false);
		configuration.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set([key]),
			change: { keys: [key], overrides: [] },
			affectsConfiguration: section => section === key
		});
		assert.deepStrictEqual(deletedBatches.map(batch => batch.map(workingSet => workingSet.id)), [['2', '1']]);
		assert.strictEqual(storage.get('scm.workingSets', StorageScope.WORKSPACE), undefined);
	});
});
