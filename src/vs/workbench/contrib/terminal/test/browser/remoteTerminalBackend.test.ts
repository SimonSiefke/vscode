/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IRemoteAgentEnvironment } from '../../../../../platform/remote/common/remoteAgentEnvironment.js';
import { ITerminalLogService, ITerminalProcessOptions } from '../../../../../platform/terminal/common/terminal.js';
import { IPtyProcessIdentity } from '../../../../../platform/terminal/common/terminalProcess.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { RemoteTerminalBackend } from '../../browser/remoteTerminalBackend.js';
import { RemotePty } from '../../browser/remotePty.js';
import { RemoteTerminalChannelClient } from '../../common/remote/remoteTerminalChannel.js';

suite('RemoteTerminalBackend', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('binds creation and attachment identities to settings and returned-client cleanup', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		await configurationService.setUserConfiguration('terminal', { integrated: { detectLocale: 'off', autoReplies: { prompt: 'reply' } } });
		instantiationService.stub(ITerminalLogService, new NullLogService());
		instantiationService.stub(IRemoteAgentService, upcastPartial<IRemoteAgentService>({
			getEnvironment: async () => upcastPartial<IRemoteAgentEnvironment>({ os: OperatingSystem.Linux, userHome: URI.file('/home/test') })
		}));
		const handoffs: Parameters<RemoteTerminalChannelClient['acceptDetachInstanceReply']>[] = [];
		const requestIds: (string | undefined)[] = [];
		const attachmentIds: (string | undefined)[] = [];
		const revivalLookups: number[] = [];
		const shutdowns: { id: number; creationId: string | undefined }[] = [];
		const updates: { id: number; creationId: string | undefined }[] = [];
		const channel = upcastPartial<RemoteTerminalChannelClient>({
			onPtyHostExit: Event.None,
			onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None,
			onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			onProcessData: Event.None,
			onProcessReplay: Event.None,
			onProcessOrphanQuestion: Event.None,
			onDidRequestDetach: Event.None,
			onProcessReady: Event.None,
			onDidChangeProperty: Event.None,
			onProcessExit: Event.None,
			onExecuteCommand: Event.None,
			acceptDetachInstanceReply: async (...args) => { handoffs.push(args); },
			createProcess: async (...args: Parameters<RemoteTerminalChannelClient['createProcess']>) => {
				requestIds.push(args[3].creationId);
				return { persistentTerminalId: requestIds.length, resolvedShellLaunchConfig: {} };
			},
			attachToProcess: async (_id, replies, creationId, expectedCreationId, pid) => {
				deepStrictEqual({ expectedCreationId, pid }, _id === 7
					? { expectedCreationId: 'revived', pid: undefined }
					: { expectedCreationId: 'original', pid: 1234 });
				deepStrictEqual(replies, { prompt: 'reply' });
				attachmentIds.push(creationId);
			},
			getRevivedPtyProcessIdentity: async (id, expectedCreationId) => {
				deepStrictEqual(expectedCreationId, id === 23 ? 'old serialized identity' : 'original');
				revivalLookups.push(id);
				return id === 23 ? { id: 7, creationId: 'revived' } : undefined;
			},
			setAutoReplies: async (id, _replies, creationId) => { updates.push({ id, creationId }); },
			shutdown: async (id, _immediate, creationId) => { shutdowns.push({ id, creationId }); }
		});
		const backend = store.add(instantiationService.createInstance(RemoteTerminalBackend, 'ssh-remote+test', channel));
		backend.setReady();
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
			ok(pty instanceof RemotePty);
			store.add(pty);
			await backend.setAutoReplies(pty.id, {}, pty.creationId);
			await pty.shutdown(true);
		}
		for (const attachment of [
			() => backend.attachToProcess(17, 1234, 'original'),
			() => backend.attachToRevivedProcess(23, 9009, 'old serialized identity'),
			() => backend.attachToRevivedProcess(18, 1234, 'original')
		]) {
			const attached = await attachment();
			ok(attached instanceof RemotePty);
			store.add(attached);
			await backend.setAutoReplies(attached.id, {}, attached.creationId);
			await attached.shutdown(true);
		}
		const identities = [...requestIds, ...attachmentIds];
		deepStrictEqual(identities.map(id => typeof id), Array(5).fill('string'));
		deepStrictEqual(new Set(identities).size, 5);
		deepStrictEqual(shutdowns, [{ id: 1, creationId: identities[0] }, { id: 2, creationId: identities[1] }, { id: 17, creationId: identities[2] }, { id: 7, creationId: identities[3] }, { id: 18, creationId: identities[4] }]);
		deepStrictEqual(updates, shutdowns);
		deepStrictEqual(options.creationId, undefined);
		deepStrictEqual(revivalLookups, [23, 18]);
	});

	for (const revivedId of [1, 7, undefined]) {
		test(`waits for revival publication before ${revivedId === undefined ? 'live fallback' : `restoring ID 1 as ${revivedId}`}`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, store);
			const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
			await configurationService.setUserConfiguration('terminal.integrated.autoReplies', { prompt: 'restored' });
			instantiationService.stub(ITerminalLogService, new NullLogService());
			const revival = new DeferredPromise<IPtyProcessIdentity | undefined>();
			const lookups: number[] = [];
			const requests: { id: number; pid: number | undefined; expectedCreationId: string | undefined; creationId: string | undefined }[] = [];
			const channel = upcastPartial<RemoteTerminalChannelClient>({
				onPtyHostExit: Event.None,
				onPtyHostStart: Event.None,
				onPtyHostUnresponsive: Event.None,
				onPtyHostResponsive: Event.None,
				onPtyHostRequestResolveVariables: Event.None,
				onProcessData: Event.None,
				onProcessReplay: Event.None,
				onProcessOrphanQuestion: Event.None,
				onDidRequestDetach: Event.None,
				onProcessReady: Event.None,
				onDidChangeProperty: Event.None,
				onProcessExit: Event.None,
				onExecuteCommand: Event.None,
				getRevivedPtyProcessIdentity: async (id, expectedCreationId) => { deepStrictEqual(expectedCreationId, 'saved owner'); lookups.push(id); return revival.p; },
				attachToProcess: async (id, replies, creationId, expectedCreationId, pid) => {
					deepStrictEqual(replies, { prompt: 'restored' });
					requests.push({ id, pid, expectedCreationId, creationId });
				}
			});
			const backend = store.add(instantiationService.createInstance(RemoteTerminalBackend, 'ssh-remote+test', channel));
			const published = revivedId === undefined ? undefined : { id: revivedId, creationId: 'revived owner' };
			async function attachAndTrack() {
				const pty = await backend.attachToRevivedProcess(1, 1234, 'saved owner');
				if (pty instanceof RemotePty) {
					store.add(pty);
				}
				return pty;
			}
			const attaching = attachAndTrack();
			try {
				deepStrictEqual({ lookups, requests }, { lookups: [], requests: [] });
				await revival.complete(published);
				backend.setReady();
				const pty = await attaching;
				ok(pty instanceof RemotePty);
				deepStrictEqual({ lookups, requests }, { lookups: [1], requests: [{
					id: revivedId ?? 1,
					pid: revivedId === undefined ? 1234 : undefined,
					expectedCreationId: published?.creationId ?? 'saved owner',
					creationId: pty.creationId
				}] });
				ok(typeof pty.creationId === 'string');
			} finally {
				await revival.complete(published);
				backend.setReady();
				await attaching;
			}
		});
	}

});
