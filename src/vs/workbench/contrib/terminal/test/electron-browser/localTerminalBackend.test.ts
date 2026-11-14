/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ExtensionIdentifier, type IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { EnvironmentVariableMutatorType, type ISerializableEnvironmentVariableCollections } from '../../../../../platform/terminal/common/environmentVariable.js';
import { ILocalPtyService, IPtyService, ITerminalBackend, ITerminalChildProcess, ITerminalLogService, type ITerminalProcessOptions, type ISerializedTerminalState } from '../../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IConfigurationResolverService } from '../../../../services/configurationResolver/common/configurationResolver.js';
import { IHistoryService } from '../../../../services/history/common/history.js';
import { IEnvironmentVariableService } from '../../common/environmentVariable.js';
import { EnvironmentVariableService } from '../../common/environmentVariableService.js';
import { ITerminalProfileResolverService } from '../../common/terminal.js';
import { TerminalStorageKeys } from '../../common/terminalStorageKeys.js';
import { TestContextService, TestHistoryService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { LocalPty } from '../../electron-browser/localPty.js';
import { LocalTerminalBackend } from '../../electron-browser/localTerminalBackend.js';
import { ITerminalInstanceService, ITerminalService } from '../../browser/terminal.js';
import { TerminalProcessManager } from '../../browser/terminalProcessManager.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IShellEnvironmentService } from '../../../../services/environment/electron-browser/shellEnvironmentService.js';

class RecordingLogService extends NullLogService {
	readonly warnings: { message: string; args: unknown[] }[] = [];

	override warn(message: string, ...args: unknown[]): void {
		this.warnings.push({ message, args });
	}
}

suite('LocalTerminalBackend', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const disposeDuringSetup of [true, false]) {
		test(`local pty ${disposeDuringSetup ? 'does not start after default disposal during setup' : 'starts and then shuts down normally'}`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, store);
			const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
			await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
			await configurationService.setUserConfiguration('terminal', { integrated: { fontFamily: 'bar', enablePersistentSessions: true, shellIntegration: { enabled: false } } });
			const setupStarted = new DeferredPromise<void>();
			const setupComplete = new DeferredPromise<void>();
			const calls: string[] = [];
			const proxy = new class extends mock<IPtyService>() {
				override async start(id: number): Promise<undefined> {
					calls.push(`start ${id}`);
					return undefined;
				}
				override async shutdown(id: number, immediate: boolean, creationId?: string): Promise<void> {
					deepStrictEqual(creationId, 'creation');
					// Non-immediate host shutdown leaves the allocation live until its exit timer.
					// Deliberately keep start callable so only the manager guard prevents a late spawn.
					calls.push(`shutdown ${id} ${immediate}`);
				}
			};
			const pty = store.add(new LocalPty(42, false, proxy, 'creation'));
			instantiationService.stub(ITerminalInstanceService, new class extends mock<ITerminalInstanceService>() {
				override async getBackend(): Promise<ITerminalBackend> {
					return upcastPartial<ITerminalBackend>({
						onPtyHostUnresponsive: Event.None,
						onPtyHostResponsive: Event.None,
						onPtyHostRestart: Event.None,
						createProcess: async () => pty,
						getShellEnvironment: async () => ({}),
						getLatency: async () => [],
						setAutoReplies: async () => {
							await setupStarted.complete();
							await setupComplete.p;
						}
					});
				}
			});
			instantiationService.stub(ITerminalService, upcastPartial<ITerminalService>({ setNextCommandId: async () => { } }));
			const manager = store.add(instantiationService.createInstance(TerminalProcessManager, 1, undefined, undefined, undefined));
			const creation = manager.createProcess({}, 80, 24, false);
			try {
				await setupStarted.p;
				if (disposeDuringSetup) {
					manager.dispose();
					deepStrictEqual(calls, ['shutdown 42 false']);
				}
				await setupComplete.complete();
				await creation;
				if (!disposeDuringSetup) {
					manager.dispose();
				}
				deepStrictEqual(calls, disposeDuringSetup ? ['shutdown 42 false'] : ['start 42', 'shutdown 42 false']);
			} finally {
				await setupComplete.complete();
				await creation;
			}
		});
	}

	test('binds distinct allocation identities to the host request and returned client cleanup', async () => {
		const handoffs: Parameters<ILocalPtyService['acceptDetachInstanceReply']>[] = [];
		const creationIds: (string | undefined)[] = [];
		const shutdowns: { id: number; creationId: string | undefined }[] = [];
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(ITerminalLogService, new NullLogService());
		instantiationService.stub(ILabelService, upcastPartial<ILabelService>({ getWorkspaceLabel: () => 'Workspace' }));
		instantiationService.stub(IShellEnvironmentService, upcastPartial<IShellEnvironmentService>({ getShellEnv: async () => ({}) }));
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			createProcess: async (...args: Parameters<ILocalPtyService['createProcess']>) => {
				creationIds.push(args[7].creationId);
				return creationIds.length;
			},
			acceptDetachInstanceReply: async (...args) => { handoffs.push(args); },
			shutdown: async (id, _immediate, creationId) => { shutdowns.push({ id, creationId }); }
		}));
		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		const connected = new DeferredPromise<void>();
		await connected.complete();
		Reflect.set(backend, '_directProxyClientEventually', connected);
		await backend.acceptDetachInstanceReply(7, 1, 'source');
		deepStrictEqual(handoffs, [[7, 1, 'source']]);
		const options: ITerminalProcessOptions = {
			shellIntegration: { enabled: false, suggestEnabled: false, nonce: 'shell nonce' },
			windowsUseConptyDll: false,
			environmentVariableCollections: undefined,
			workspaceFolder: undefined,
			isScreenReaderOptimized: false
		};
		for (let index = 0; index < 2; index++) {
			const pty = await backend.createProcess({}, '/tmp', 80, 24, '6', {}, options, false);
			ok(pty instanceof LocalPty);
			store.add(pty);
			await pty.shutdown(true);
		}
		deepStrictEqual(creationIds.map(id => typeof id), ['string', 'string']);
		ok(creationIds[0] !== creationIds[1]);
		deepStrictEqual(shutdowns, [{ id: 1, creationId: creationIds[0] }, { id: 2, creationId: creationIds[1] }]);
		deepStrictEqual(options.creationId, undefined);
	});

	test('attachToRevivedProcess only falls back to the original process when it still has the saved pid', async () => {
		const livePids = new Map([[1, 101], [2, 202], [3, 303]]);
		const revivedIds = new Map([[7, 1], [2, 2], [8, 5]]);
		const attachRequests: [id: number, pid: number | undefined][] = [];
		const autoReplyWrites: { id: number; replies: Readonly<Record<string, string | null>> }[] = [];
		const attachmentOwners = new Map<number, string>();
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('terminal.integrated.autoReplies', { prompt: 'restored reply' });

		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(ITerminalLogService, new NullLogService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			getRevivedPtyProcessIdentity: async (_workspaceId: string, id: number, expectedCreationId?: string) => {
				deepStrictEqual(expectedCreationId, id === 3 ? attachmentOwners.get(3) : undefined);
				const newId = revivedIds.get(id);
				return newId === undefined ? undefined : { id: newId, creationId: attachmentOwners.get(newId) };
			},
			attachToProcess: async (id: number, pid?: number, replies?: Readonly<Record<string, string | null>>, creationId?: string, expectedCreationId?: string) => {
				attachRequests.push([id, pid]);
				const livePid = livePids.get(id);
				if (livePid === undefined) {
					throw new Error(`Could not find pty ${id} on pty host`);
				}
				if (pid !== undefined && pid !== livePid) {
					throw new Error(`Pty ${id} has pid ${livePid}, expected ${pid}`);
				}
				if (attachmentOwners.get(id) !== expectedCreationId) {
					throw new Error('Allocation has changed');
				}
				ok(typeof creationId === 'string');
				attachmentOwners.set(id, creationId);
				if (replies !== undefined) {
					autoReplyWrites.push({ id, replies });
				}
			}
		}));
		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		// Treat the pty host as connected so requests go to the local pty service stub
		const connected = new DeferredPromise<void>();
		await connected.complete();
		Reflect.set(backend, '_directProxyClientEventually', connected);

		async function attach(attachToProcess: () => Promise<ITerminalChildProcess | undefined>) {
			attachRequests.length = 0;
			const pty = await attachToProcess();
			if (pty instanceof LocalPty) {
				deepStrictEqual(pty.creationId, attachmentOwners.get(pty.id));
				store.add(pty);
			}
			return { attachedId: pty?.id, isRevived: pty?.isRevived, requests: [...attachRequests] };
		}

		deepStrictEqual({
			revivedWithNewId: await attach(() => backend.attachToRevivedProcess(7, 7007)),
			revivedWithSameId: await attach(() => backend.attachToRevivedProcess(2, 2002)),
			revivedButMissing: await attach(() => backend.attachToRevivedProcess(8, 8008)),
			originalWithSavedPid: await attach(() => backend.attachToRevivedProcess(3, 303, attachmentOwners.get(3))),
			originalWithOtherPid: await attach(() => backend.attachToRevivedProcess(3, 9009, attachmentOwners.get(3))),
			originalWithUnknownPid: await attach(() => backend.attachToRevivedProcess(3, 0, attachmentOwners.get(3))),
			originalWithNegativePid: await attach(() => backend.attachToRevivedProcess(3, -1, attachmentOwners.get(3))),
			originalMissing: await attach(() => backend.attachToRevivedProcess(4, 404)),
			attachById: await attach(() => backend.attachToProcess(3, undefined, attachmentOwners.get(3))),
		}, {
			revivedWithNewId: { attachedId: 1, isRevived: true, requests: [[1, undefined]] },
			revivedWithSameId: { attachedId: 2, isRevived: true, requests: [[2, undefined]] },
			revivedButMissing: { attachedId: undefined, isRevived: undefined, requests: [[5, undefined]] },
			originalWithSavedPid: { attachedId: 3, isRevived: false, requests: [[3, 303]] },
			originalWithOtherPid: { attachedId: undefined, isRevived: undefined, requests: [[3, 9009]] },
			originalWithUnknownPid: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
			originalWithNegativePid: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
			originalMissing: { attachedId: undefined, isRevived: undefined, requests: [[4, 404]] },
			attachById: { attachedId: 3, isRevived: false, requests: [[3, undefined]] },
		});
		deepStrictEqual(autoReplyWrites, [1, 2, 3, 3, 3, 3].map(id => ({ id, replies: { prompt: 'restored reply' } })));
	});

	test('revival refreshes both the environment and collection options before sending persisted state to the pty host', async () => {
		let revivedState: ISerializedTerminalState[] | undefined;
		const instantiationService = store.add(new TestInstantiationService());
		const storageService = store.add(new TestStorageService());
		const logService = new RecordingLogService();
		const registeredExtensions: readonly IExtensionDescription[] = [
			upcastPartial<IExtensionDescription>({
				identifier: new ExtensionIdentifier('foreign.extension')
			})
		];
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(ITerminalLogService, logService);
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(IExtensionService, upcastPartial<IExtensionService>({
			whenInstalledExtensionsRegistered: async () => true,
			onDidChangeExtensions: Event.None,
			extensions: registeredExtensions
		}));
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IConfigurationResolverService, upcastPartial<IConfigurationResolverService>({
			resolveWithEnvironment: async (_environment, _folder, value) => value
		}));
		instantiationService.stub(IHistoryService, new TestHistoryService());
		instantiationService.stub(IProductService, upcastPartial<IProductService>({ version: 'test' }));
		instantiationService.stub(ITerminalProfileResolverService, upcastPartial<ITerminalProfileResolverService>({
			getEnvironment: async () => ({ PATH: '/base/bin' })
		}));
		const environmentVariableService = store.add(instantiationService.createInstance(EnvironmentVariableService));
		const foreignCollection = {
			remoteAuthority: 'ssh-remote+foreign-host',
			map: new Map([
				['foreign-path', { variable: 'PATH', value: '/foreign/bin:', type: EnvironmentVariableMutatorType.Prepend }],
				['shared-value', { variable: 'SHARED_VALUE', value: 'available', type: EnvironmentVariableMutatorType.Replace }]
			])
		};
		environmentVariableService.set('foreign.extension', { ...foreignCollection, persistent: false });
		instantiationService.stub(IEnvironmentVariableService, environmentVariableService);
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			getEnvironment: async () => ({ PATH: '/base/bin' }),
			reviveTerminalProcesses: async (_workspaceId, state) => {
				revivedState = state;
			},
			getTerminalLayoutInfo: async () => undefined
		}));

		const staleOptions: ISerializableEnvironmentVariableCollections = [[
			'foreign.extension',
			[['foreign-path', { variable: 'PATH', value: '/foreign/bin:', type: EnvironmentVariableMutatorType.Prepend }]],
			[]
		]];
		storageService.store(TerminalStorageKeys.TerminalBufferState, JSON.stringify({
			version: 1,
			state: [{
				id: 1,
				shellLaunchConfig: {},
				processLaunchConfig: {
					env: { PATH: '/stale/bin:/foreign/bin' },
					executableEnv: {},
					options: {
						shellIntegration: { enabled: false, suggestEnabled: false, nonce: '' },
						windowsUseConptyDll: false,
						environmentVariableCollections: staleOptions,
						isScreenReaderOptimized: false
					}
				}
			}]
		}), StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		await backend.getTerminalLayoutInfo();
		deepStrictEqual({
			revivedStateLength: revivedState?.length,
			warnings: logService.warnings
		}, {
			revivedStateLength: 1,
			warnings: []
		});
		if (!revivedState) {
			throw new Error('Expected persisted terminal state to be revived');
		}

		deepStrictEqual({
			env: {
				PATH: revivedState[0].processLaunchConfig.env.PATH,
				SHARED_VALUE: revivedState[0].processLaunchConfig.env.SHARED_VALUE
			},
			collections: revivedState[0].processLaunchConfig.options.environmentVariableCollections
		}, {
			env: { PATH: '/base/bin', SHARED_VALUE: 'available' },
			collections: [[
				'foreign.extension',
				[['shared-value', { variable: 'SHARED_VALUE', value: 'available', type: EnvironmentVariableMutatorType.Replace }]],
				[]
			]]
		});
	});
});
