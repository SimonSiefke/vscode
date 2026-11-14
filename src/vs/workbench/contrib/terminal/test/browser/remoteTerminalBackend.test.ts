/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
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
		const requestIds: (string | undefined)[] = [];
		const attachmentIds: (string | undefined)[] = [];
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
			createProcess: async (...args: Parameters<RemoteTerminalChannelClient['createProcess']>) => {
				requestIds.push(args[3].creationId);
				return { persistentTerminalId: requestIds.length, resolvedShellLaunchConfig: {} };
			},
			attachToProcess: async (_id, replies, creationId) => {
				deepStrictEqual(replies, { prompt: 'reply' });
				attachmentIds.push(creationId);
			},
			setAutoReplies: async (id, _replies, creationId) => { updates.push({ id, creationId }); },
			shutdown: async (id, _immediate, creationId) => { shutdowns.push({ id, creationId }); }
		});
		const backend = store.add(instantiationService.createInstance(RemoteTerminalBackend, 'ssh-remote+test', channel));
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
		const attached = await backend.attachToProcess(17);
		ok(attached instanceof RemotePty);
		store.add(attached);
		await backend.setAutoReplies(attached.id, {}, attached.creationId);
		await attached.shutdown(true);
		const identities = [...requestIds, ...attachmentIds];
		deepStrictEqual(identities.map(id => typeof id), ['string', 'string', 'string']);
		deepStrictEqual(new Set(identities).size, 3);
		deepStrictEqual(shutdowns, [{ id: 1, creationId: identities[0] }, { id: 2, creationId: identities[1] }, { id: 17, creationId: identities[2] }]);
		deepStrictEqual(updates, shutdowns);
		deepStrictEqual(options.creationId, undefined);
	});
});
