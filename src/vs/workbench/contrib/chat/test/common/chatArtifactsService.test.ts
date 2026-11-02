/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { Memento } from '../../../../common/memento.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { LocalChatSessionUri } from '../../common/model/chatUri.js';
import { ChatArtifactsService, IChatArtifact } from '../../common/tools/chatArtifactsService.js';

suite('ChatArtifactsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const artifact: IChatArtifact = { label: 'Plan', uri: 'file:///plan.md', type: 'plan' };

	setup(() => Memento.clear(StorageScope.WORKSPACE));
	teardown(() => Memento.clear(StorageScope.WORKSPACE));

	function createService() {
		const disposed = disposables.add(new Emitter<{ readonly sessionResources: readonly URI[]; readonly reason: 'cleared' | 'disposed' }>());
		const storage = disposables.add(new InMemoryStorageService());
		const chatService = new class extends mock<IChatService>() {
			override readonly onDidDisposeSession = disposed.event;
			override readonly onDidCreateModel = Event.None;
			override getSession() { return undefined; }
		}();
		const service = disposables.add(new ChatArtifactsService(storage, chatService, new TestConfigurationService()));
		return { service, disposed };
	}

	for (const resource of [LocalChatSessionUri.forSession('artifacts'), URI.parse('agent-host-copilotcli:/artifacts')]) {
		for (const reason of ['disposed', 'cleared'] as const) {
			test(`evicts ${resource.scheme} artifacts when a session is ${reason}`, () => {
				const { service, disposed } = createService();
				const otherResource = LocalChatSessionUri.forSession('other');
				const instance = service.getArtifacts(resource);
				const other = service.getArtifacts(otherResource);
				instance.setAgentArtifacts([artifact]);
				assert.strictEqual(service.getArtifacts(resource), instance);

				disposed.fire({ sessionResources: [resource], reason });

				const reopened = service.getArtifacts(resource);
				assert.notStrictEqual(reopened, instance);
				assert.strictEqual(service.getArtifacts(otherResource), other);
				assert.deepStrictEqual(reopened.artifactGroups.get(), reason === 'disposed'
					? [{ source: { kind: 'agent' }, artifacts: [artifact] }]
					: []);
			});
		}
	}

	test('clears persisted artifacts even when the session is not cached', () => {
		const { service, disposed } = createService();
		const resource = LocalChatSessionUri.forSession('persisted');
		service.getArtifacts(resource).setAgentArtifacts([artifact]);
		disposed.fire({ sessionResources: [resource], reason: 'disposed' });

		disposed.fire({ sessionResources: [resource], reason: 'cleared' });

		assert.deepStrictEqual(service.getArtifacts(resource).artifactGroups.get(), []);
	});

	test('evicts every session in a disposal event', () => {
		const { service, disposed } = createService();
		const resources = [LocalChatSessionUri.forSession('first'), LocalChatSessionUri.forSession('second')];
		const instances = resources.map(resource => service.getArtifacts(resource));

		disposed.fire({ sessionResources: resources, reason: 'disposed' });

		for (let i = 0; i < resources.length; i++) {
			assert.notStrictEqual(service.getArtifacts(resources[i]), instances[i]);
		}
	});
});
