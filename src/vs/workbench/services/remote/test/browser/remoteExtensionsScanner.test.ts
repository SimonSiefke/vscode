/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { IndexedDB } from '../../../../../base/browser/indexedDB.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { getSingletonServiceDescriptors } from '../../../../../platform/instantiation/common/extensions.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IRemoteExtensionsScannerService } from '../../../../../platform/remote/common/remoteExtensionsScanner.js';
import { IUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { IWorkbenchExtensionManagementService } from '../../../extensionManagement/common/extensionManagement.js';
import { IActiveLanguagePackService } from '../../../localization/common/locale.js';
import { IUserDataProfileService } from '../../../userDataProfile/common/userDataProfile.js';
import { IRemoteAgentConnection, IRemoteAgentService } from '../../common/remoteAgentService.js';
import { IRemoteUserDataProfilesService } from '../../../userDataProfile/common/remoteUserDataProfiles.js';
import '../../browser/remoteExtensionsScanner.js';

suite('RemoteExtensionsScanner cache', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const extensions = [{ identifier: { value: 'test.extension' }, name: 'extension', publisher: 'test', version: '1.0.0', extensionLocation: URI.parse('vscode-remote://test/extensions/test') }] as IExtensionDescription[];
	let db: IndexedDB;
	let calls: { command: string; args: readonly unknown[] }[];
	let response: (command: string, args: readonly unknown[]) => Promise<unknown>;
	let service: IRemoteExtensionsScannerService;

	setup(async () => {
		db = await IndexedDB.create(`remote-scan-test-${generateUuid()}`, 1, ['scopes', 'contents']);
		sinon.stub(IndexedDB, 'create').resolves(db);
		calls = [];
		response = async (command, args) => {
			if (command === 'scanExtensions') {
				return extensions;
			}
			return args[5] === 'hash' ? { type: 'hit', contentHash: 'hash' } : { type: 'miss', contentHash: 'hash', extensions };
		};
		const channel = new class extends mock<IChannel>() {
			override async call<T>(command: string, args: readonly unknown[]): Promise<T> {
				calls.push({ command, args });
				return await response(command, args) as T;
			}
		}();
		const connection = new class extends mock<IRemoteAgentConnection>() {
			override readonly remoteAuthority = 'test';
			override withChannel<T extends IChannel, R>(_name: string, callback: (channel: T) => Promise<R>): Promise<R> {
				return callback(channel as T);
			}
		}();
		const instantiation = disposables.add(new TestInstantiationService());
		instantiation.stub(IRemoteAgentService, new class extends mock<IRemoteAgentService>() {
			override getConnection(): IRemoteAgentConnection { return connection; }
		}());
		instantiation.stub(IWorkbenchEnvironmentService, new class extends mock<IWorkbenchEnvironmentService>() {
			override readonly extensionDevelopmentLocationURI = undefined;
		}());
		instantiation.stub(IUserDataProfileService, new class extends mock<IUserDataProfileService>() {
			override readonly currentProfile = { isDefault: true } as IUserDataProfile;
		}());
		instantiation.stub(IRemoteUserDataProfilesService, new class extends mock<IRemoteUserDataProfilesService>() { }());
		instantiation.stub(IActiveLanguagePackService, new class extends mock<IActiveLanguagePackService>() {
			override async getExtensionIdProvidingCurrentLocale(): Promise<undefined> { return undefined; }
		}());
		instantiation.stub(IWorkbenchExtensionManagementService, new class extends mock<IWorkbenchExtensionManagementService>() {
			override getInstalledWorkspaceExtensionLocations(): URI[] { return []; }
		}());
		instantiation.stub(ILogService, new NullLogService());
		const descriptor = getSingletonServiceDescriptors().find(([id]) => id === IRemoteExtensionsScannerService)?.[1];
		assert.ok(descriptor);
		service = disposables.add(instantiation.createInstance(descriptor.ctor) as IRemoteExtensionsScannerService & IDisposable);
	});

	teardown(() => {
		sinon.restore();
		db.close();
	});

	function snapshot(result: IExtensionDescription[]) {
		return { extensions: result.map(extension => ({ id: extension.identifier.value, location: extension.extensionLocation.toString() })), calls: calls.map(call => ({ command: call.command, knownHash: call.args[5] })) };
	}

	const resultExtensions = [{ id: 'test.extension', location: 'vscode-remote://test/extensions/test' }];

	test('stores misses and reuses a server-confirmed hit', async () => {
		const first = snapshot(await service.scanExtensions());
		calls.length = 0;
		const second = snapshot(await service.scanExtensions());
		assert.deepStrictEqual({ first, second }, {
			first: { extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }] },
			second: { extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: 'hash' }] }
		});
	});

	for (const store of ['contents', 'scopes']) {
		test(`returns a fresh miss when ${store} persistence fails`, async () => {
			sinon.stub(db, 'runInTransaction').callThrough().withArgs(store, 'readwrite', sinon.match.func).rejects(new Error('QuotaExceededError'));
			assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
				extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }]
			});
		});
	}

	for (const store of ['contents', 'scopes']) {
		test(`returns a cached hit when ${store} bookkeeping fails`, async () => {
			await service.scanExtensions();
			calls.length = 0;
			sinon.stub(db, 'runInTransaction').callThrough().withArgs(store, 'readwrite', sinon.match.func).rejects(new Error('Transaction failed'));
			assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
				extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: 'hash' }]
			});
		});
	}

	test('returns fresh content when pruning old entries fails', async () => {
		sinon.stub(db, 'getKeyValues').rejects(new Error('Maintenance failed'));
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});

	test('returns repaired content when persisting the repair fails', async () => {
		await service.scanExtensions();
		await db.runInTransaction('contents', 'readwrite', store => store.clear());
		calls.length = 0;
		sinon.stub(db, 'runInTransaction').callThrough().withArgs('contents', 'readwrite', sinon.match.func).rejects(new Error('QuotaExceededError'));
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: 'hash' }, { command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});

	test('reads the server without a known hash when the scope read fails', async () => {
		sinon.stub(db, 'runInTransaction').callThrough().withArgs('scopes', 'readonly', sinon.match.func).rejects(new Error('Read failed'));
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});

	test('repairs unreadable cached content', async () => {
		await service.scanExtensions();
		calls.length = 0;
		sinon.stub(db, 'runInTransaction').callThrough().withArgs('contents', 'readonly', sinon.match.func).rejects(new Error('Read failed'));
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: 'hash' }, { command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});

	test('repairs malformed cached manifest content', async () => {
		await service.scanExtensions();
		await db.runInTransaction('contents', 'readwrite', store => store.put({ contentHash: 'hash', extensions: [null], lastUsed: 0 }, 'hash'));
		calls.length = 0;
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: 'hash' }, { command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});

	test('falls back for an older server', async () => {
		response = async command => {
			if (command === 'scanExtensionsWithCache') {
				throw new Error('Invalid call');
			}
			return extensions;
		};
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }, { command: 'scanExtensions', knownHash: undefined }]
		});
	});

	test('falls back for malformed cache protocol data', async () => {
		response = async command => command === 'scanExtensionsWithCache' ? { type: 'miss', contentHash: 'hash' } : extensions;
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: resultExtensions, calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }, { command: 'scanExtensions', knownHash: undefined }]
		});
	});

	test('does not retry a disconnected RPC as a legacy scan', async () => {
		response = async () => { throw new Error('Disconnected'); };
		assert.deepStrictEqual(snapshot(await service.scanExtensions()), {
			extensions: [], calls: [{ command: 'scanExtensionsWithCache', knownHash: undefined }]
		});
	});
});
