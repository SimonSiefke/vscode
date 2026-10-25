/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Barrier, DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IQuickDiffService } from '../../../contrib/scm/common/quickDiff.js';
import { ISCMInput, ISCMProvider, ISCMRepository, ISCMService, ISCMViewService } from '../../../contrib/scm/common/scm.js';
import { MainThreadSCM } from '../../browser/mainThreadSCM.js';
import { ExtHostSCMShape } from '../../common/extHost.protocol.js';
import { AnyCallRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadSCM registration barriers', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(pendingModel?: DeferredPromise<IReference<IResolvedTextEditorModel>>) {
		let modelDisposals = 0;
		let repositoryDisposals = 0;
		const repositories: ISCMRepository[] = [];
		const modelReference: IReference<IResolvedTextEditorModel> = {
			object: new class extends mock<IResolvedTextEditorModel>() {
				override readonly textEditorModel = new class extends mock<ITextModel>() { };
			},
			dispose: () => { modelDisposals++; }
		};
		const scm = new class extends mock<ISCMService>() {
			override registerSCMProvider(provider: ISCMProvider): ISCMRepository {
				const repository = new class extends mock<ISCMRepository>() {
					override readonly provider = provider;
					override readonly input = new class extends mock<ISCMInput>() {
						override readonly value = '';
						override readonly onDidChange = Event.None;
					};
					override dispose(): void { repositoryDisposals++; provider.dispose(); }
				};
				repositories.push(repository);
				return repository;
			}
		};
		const service = store.add(new MainThreadSCM(
			AnyCallRPCProtocol<ExtHostSCMShape>(), scm,
			new class extends mock<ISCMViewService>() {
				override readonly focusedRepository = undefined;
				override readonly onDidFocusRepository = Event.None;
			},
			new class extends mock<ILanguageService>() { },
			new class extends mock<IModelService>() { },
			new class extends mock<ITextModelService>() {
				override registerTextModelContentProvider() { return toDisposable(() => { }); }
				override createModelReference(): Promise<IReference<IResolvedTextEditorModel>> {
					return pendingModel?.p ?? Promise.resolve(modelReference);
				}
			},
			new class extends mock<IQuickDiffService>() { },
			new class extends mock<IUriIdentityService>() { },
			new class extends mock<IWorkspaceContextService>() { },
		));
		const barriers: ReadonlyMap<number, Barrier> = Reflect.get(service, '_repositoryBarriers');
		const register = (handle: number) => service.$registerSourceControl(handle, undefined, 'owned', 'Owned', undefined, undefined, undefined, URI.parse(`vscode-scm:owned/${handle}`));
		return { service, barriers, register, repositories, modelReference, disposals: () => ({ modelDisposals, repositoryDisposals }) };
	}

	test('retains an opened barrier while its registration is live', async () => {
		const { barriers, register } = createService();
		await register(1);
		assert.deepStrictEqual([...barriers].map(([handle, barrier]) => [handle, barrier.isOpen()]), [[1, true]]);
	});

	test('releases the barrier when its source control is unregistered', async () => {
		const { service, barriers, register, disposals } = createService();
		await register(1);
		await service.$unregisterSourceControl(1);
		assert.deepStrictEqual({ handles: [...barriers.keys()], ...disposals() }, { handles: [], modelDisposals: 1, repositoryDisposals: 1 });
	});

	test('preserves an unrelated live registration', async () => {
		const { service, barriers, register } = createService();
		await register(1);
		await register(2);
		await service.$unregisterSourceControl(1);
		assert.deepStrictEqual([...barriers.keys()], [2]);
	});

	test('repeated unregister does not dispose resources twice', async () => {
		const { service, barriers, register, disposals } = createService();
		await register(1);
		await service.$unregisterSourceControl(1);
		await service.$unregisterSourceControl(1);
		await service.$unregisterSourceControl(99);
		assert.deepStrictEqual({ handles: [...barriers.keys()], ...disposals() }, { handles: [], modelDisposals: 1, repositoryDisposals: 1 });
	});

	test('does not accumulate barriers across repeated source controls', async () => {
		const { service, barriers, register } = createService();
		for (let handle = 0; handle < 37; handle++) {
			await register(handle);
			await service.$unregisterSourceControl(handle);
		}
		assert.strictEqual(barriers.size, 0);
	});

	test('clears completed registrations on extension-host disposal', async () => {
		const { service, barriers, register } = createService();
		await register(1);
		await register(2);
		service.dispose();
		assert.strictEqual(barriers.size, 0);
	});

	test('preserves updates queued while the model reference is pending', async () => {
		const pendingModel = new DeferredPromise<IReference<IResolvedTextEditorModel>>();
		const { service, barriers, register, repositories, modelReference } = createService(pendingModel);
		const registration = register(1);
		const update = service.$updateSourceControl(1, { count: 5 });
		assert.strictEqual(barriers.get(1)?.isOpen(), false);
		await pendingModel.complete(modelReference);
		await registration;
		await update;
		assert.strictEqual(repositories[0].provider.count.get(), 5);
	});
	for (const queuedUnregister of [false, true]) {
		test(`disposal releases a pending registration (queued unregister: ${queuedUnregister})`, async () => {
			const pendingModel = new DeferredPromise<IReference<IResolvedTextEditorModel>>();
			const { service, barriers, register, repositories, modelReference, disposals } = createService(pendingModel);
			const registration = register(1);
			const barrier = barriers.get(1)!;
			let unregisterSettled = !queuedUnregister;
			const unregister = queuedUnregister ? service.$unregisterSourceControl(1).then(() => { unregisterSettled = true; }) : Promise.resolve();
			service.dispose();
			await pendingModel.complete(modelReference);
			await registration;
			await Promise.resolve();
			try {
				assert.deepStrictEqual({ unregisterSettled, repositories: repositories.length, barriers: barriers.size, ...disposals() }, {
					unregisterSettled: true, repositories: 0, barriers: 0, modelDisposals: 1, repositoryDisposals: 0
				});
			} finally {
				barrier.open();
				await unregister;
				await service.$unregisterSourceControl(1);
			}
		});
	}

	test('model resolution failure releases queued unregister', async () => {
		const pendingModel = new DeferredPromise<IReference<IResolvedTextEditorModel>>();
		const { service, barriers, register } = createService(pendingModel);
		const error = new Error('model failed');
		const registration = assert.rejects(register(1), error);
		const barrier = barriers.get(1)!;
		let settled = false;
		const unregister = service.$unregisterSourceControl(1).then(() => { settled = true; });
		await pendingModel.error(error);
		await registration;
		await Promise.resolve();
		try {
			assert.strictEqual(settled, true);
		} finally {
			barrier.open();
			await unregister;
		}
	});

	test('registration after disposal does not acquire a model or repository', async () => {
		const { service, barriers, register, repositories, disposals } = createService();
		service.dispose();
		await register(1);
		assert.deepStrictEqual({ repositories: repositories.length, barriers: barriers.size, ...disposals() }, {
			repositories: 0, barriers: 0, modelDisposals: 0, repositoryDisposals: 0
		});
	});

});
