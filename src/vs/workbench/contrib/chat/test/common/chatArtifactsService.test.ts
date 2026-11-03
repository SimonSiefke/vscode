/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Memento } from '../../../../common/memento.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { IChatModel, IChatRequestModel, IChatResponseModel, IResponse } from '../../common/model/chatModel.js';
import { chatSessionResourceToId, LocalChatSessionUri } from '../../common/model/chatUri.js';
import { ChatArtifactsService, IChatArtifact } from '../../common/tools/chatArtifactsService.js';

suite('ChatArtifactsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const artifact: IChatArtifact = { label: 'Plan', uri: 'file:///plan.md', type: 'plan' };

	setup(() => Memento.clear(StorageScope.WORKSPACE));
	teardown(() => Memento.clear(StorageScope.WORKSPACE));

	function createService(model?: IChatModel, storage = disposables.add(new InMemoryStorageService())) {
		const disposed = disposables.add(new Emitter<{ readonly sessionResources: readonly URI[]; readonly reason: 'cleared' | 'disposed' }>());
		const chatService = new class extends mock<IChatService>() {
			override readonly onDidDisposeSession = disposed.event;
			override readonly onDidCreateModel = Event.None;
			override getSession() { return model; }
		}();
		const configuration = new TestConfigurationService();
		disposables.add(configuration.onDidChangeConfigurationEmitter);
		const service = disposables.add(new ChatArtifactsService(storage, chatService, configuration));
		return { service, disposed, storage };
	}

	function restoredModel(): IChatModel {
		return upcastPartial<IChatModel>({
			onDidChange: Event.None,
			getRequests: () => [upcastPartial<IChatRequestModel>({
				response: upcastPartial<IChatResponseModel>({
					id: 'restored-response',
					onDidChange: Event.None,
					response: upcastPartial<IResponse>({ value: [{ kind: 'codeblockUri', uri: URI.parse('file:///document.md') }] }),
				}),
			})],
		});
	}

	for (const resource of [LocalChatSessionUri.forSession('artifacts'), URI.parse('agent-host-copilotcli:/artifacts')]) {
		test(`preserves ${resource.scheme} rules across repeated model unloads`, () => {
			const { service, disposed } = createService(restoredModel());
			service.getArtifacts(resource).setRuleOverrides({ byFilePath: { '**/*.md': { groupName: 'Documents' } } });
			const expected = service.getArtifacts(resource).artifactGroups.get();
			assert.strictEqual(expected[0].artifacts[0].groupName, 'Documents');

			for (let i = 0; i < 3; i++) {
				disposed.fire({ sessionResources: [resource], reason: 'disposed' });
				assert.deepStrictEqual(service.getArtifacts(resource).artifactGroups.get(), expected);
			}
		});

		test(`preserves ${resource.scheme} subagent source order and deduplication after unload`, () => {
			const { service, disposed } = createService();
			const instance = service.getArtifacts(resource);
			const parentArtifact = { ...artifact, uri: 'file:///parent.md' };
			instance.setSubagentArtifacts('child', 'Child', [artifact]);
			instance.setAgentArtifacts([artifact, parentArtifact]);
			const expected = [
				{ source: { kind: 'subagent', invocationId: 'child', name: 'Child' }, artifacts: [artifact] },
				{ source: { kind: 'agent' }, artifacts: [parentArtifact] },
			];

			disposed.fire({ sessionResources: [resource], reason: 'disposed' });
			const reopened = service.getArtifacts(resource);
			reopened.setSubagentArtifacts('later', undefined, [{ ...artifact, uri: 'file:///later.md' }]);

			assert.deepStrictEqual(reopened.artifactGroups.get(), [
				...expected,
				{ source: { kind: 'subagent', invocationId: 'later', name: undefined }, artifacts: [{ ...artifact, uri: 'file:///later.md' }] },
			]);
		});

		test(`deletes uncached ${resource.scheme} rules and subagent artifacts when cleared`, () => {
			const { service, disposed } = createService(restoredModel());
			const instance = service.getArtifacts(resource);
			instance.setRuleOverrides({ byFilePath: { '**/*.md': { groupName: 'Documents' } } });
			instance.setSubagentArtifacts('child', 'Child', [artifact]);
			instance.setAgentArtifacts([{ ...artifact, uri: 'file:///parent.md' }]);
			disposed.fire({ sessionResources: [resource], reason: 'disposed' });

			disposed.fire({ sessionResources: [resource], reason: 'cleared' });

			assert.deepStrictEqual(service.getArtifacts(resource).artifactGroups.get(), []);
		});

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

	test('restores full session state from serialized storage after service recreation', () => {
		const { service, storage } = createService(restoredModel());
		const resource = LocalChatSessionUri.forSession('serialized');
		const instance = service.getArtifacts(resource);
		instance.setRuleOverrides({ byFilePath: { '**/*.md': { groupName: 'Documents' } } });
		instance.setSubagentArtifacts('child', 'Child', [artifact]);
		instance.setAgentArtifacts([{ ...artifact, uri: 'file:///parent.md' }]);
		const expected = instance.artifactGroups.get();
		service.dispose();
		Memento.clear(StorageScope.WORKSPACE);

		const recreated = createService(restoredModel(), storage).service;

		assert.deepStrictEqual(recreated.getArtifacts(resource).artifactGroups.get(), expected);
	});

	test('does not restore rules or artifacts removed before unloading', () => {
		const { service, disposed } = createService(restoredModel());
		const resource = LocalChatSessionUri.forSession('removed');
		const instance = service.getArtifacts(resource);
		instance.setRuleOverrides({ byFilePath: { '**/*.md': { groupName: 'Documents' } } });
		instance.setSubagentArtifacts('child', 'Child', [artifact]);
		instance.setAgentArtifacts([artifact]);
		instance.clearAgentArtifacts();
		instance.clearSubagentArtifacts('child');
		instance.setRuleOverrides(undefined);

		disposed.fire({ sessionResources: [resource], reason: 'disposed' });

		assert.deepStrictEqual(service.getArtifacts(resource).artifactGroups.get(), []);
	});

	test('restores legacy persisted agent artifact arrays', () => {
		const { service, storage } = createService();
		const resource = LocalChatSessionUri.forSession('legacy');
		storage.store('memento/chat-artifacts', { [chatSessionResourceToId(resource)]: [artifact] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);

		assert.deepStrictEqual(service.getArtifacts(resource).artifactGroups.get(), [{ source: { kind: 'agent' }, artifacts: [artifact] }]);
	});

	test('keeps migrated artifacts on the target after both models unload', () => {
		const { service, disposed } = createService();
		const original = LocalChatSessionUri.forSession('original');
		const target = LocalChatSessionUri.forSession('target');
		service.getArtifacts(original).setAgentArtifacts([artifact]);
		service.getArtifacts(original).migrate(service.getArtifacts(target));

		disposed.fire({ sessionResources: [original, target], reason: 'disposed' });

		assert.deepStrictEqual({
			original: service.getArtifacts(original).artifactGroups.get(),
			target: service.getArtifacts(target).artifactGroups.get(),
		}, {
			original: [],
			target: [{ source: { kind: 'agent' }, artifacts: [artifact] }],
		});
	});

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
