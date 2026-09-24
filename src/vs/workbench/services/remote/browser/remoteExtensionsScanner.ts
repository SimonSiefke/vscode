/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRemoteAgentService } from '../common/remoteAgentService.js';
import { getRemoteExtensionsScanCacheScopeKey, IRemoteExtensionsScanCacheScope, IRemoteExtensionsScannerService, RemoteExtensionsScanCacheResult, RemoteExtensionsScannerChannelName, toUriComponents } from '../../../../platform/remote/common/remoteExtensionsScanner.js';
import * as platform from '../../../../base/common/platform.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IUserDataProfileService } from '../../userDataProfile/common/userDataProfile.js';
import { IRemoteUserDataProfilesService } from '../../userDataProfile/common/remoteUserDataProfiles.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IActiveLanguagePackService } from '../../localization/common/locale.js';
import { IWorkbenchExtensionManagementService } from '../../extensionManagement/common/extensionManagement.js';
import { Mutable } from '../../../../base/common/types.js';
import { InstallExtensionSummary } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IndexedDB } from '../../../../base/browser/indexedDB.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

type StoredRemoteExtensionDescription = Mutable<IExtensionDescription> & { extensionLocation: UriComponents };

interface IRemoteExtensionsScanCacheEntry {
	readonly contentHash: string;
	readonly extensions: readonly StoredRemoteExtensionDescription[];
	readonly lastUsed: number;
}

const enum RemoteExtensionsScanCacheStore {
	Scopes = 'scopes',
	Contents = 'contents'
}

class RemoteExtensionsScannerService extends Disposable implements IRemoteExtensionsScannerService {

	declare readonly _serviceBrand: undefined;

	private readonly scanCache: RemoteExtensionsScanIndexedDBCache;

	constructor(
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IRemoteUserDataProfilesService private readonly remoteUserDataProfilesService: IRemoteUserDataProfilesService,
		@IActiveLanguagePackService private readonly activeLanguagePackService: IActiveLanguagePackService,
		@IWorkbenchExtensionManagementService private readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.scanCache = this._register(new RemoteExtensionsScanIndexedDBCache(this.logService));
	}

	whenExtensionsReady(): Promise<InstallExtensionSummary> {
		return this.withChannel(
			channel => channel.call<InstallExtensionSummary>('whenExtensionsReady'),
			{ failed: [] }
		);
	}

	async scanExtensions(): Promise<IExtensionDescription[]> {
		try {
			const languagePack = await this.activeLanguagePackService.getExtensionIdProvidingCurrentLocale();
			return await this.withChannel(
				async (channel) => {
					const profileLocation = this.userDataProfileService.currentProfile.isDefault ? undefined : (await this.remoteUserDataProfilesService.getRemoteProfile(this.userDataProfileService.currentProfile)).extensionsResource;
					const workspaceExtensionLocations = this.extensionManagementService.getInstalledWorkspaceExtensionLocations();
					const extensionDevelopmentLocations = this.environmentService.extensionDevelopmentLocationURI;
					const scanArgs = [
						platform.language,
						profileLocation,
						workspaceExtensionLocations,
						extensionDevelopmentLocations,
						languagePack
					];

					const scope: IRemoteExtensionsScanCacheScope = {
						remoteAuthority: this.remoteAgentService.getConnection()?.remoteAuthority,
						language: platform.language,
						profileLocation: toUriComponents(profileLocation),
						workspaceExtensionLocations: workspaceExtensionLocations.map(location => location.toJSON()),
						extensionDevelopmentLocations: extensionDevelopmentLocations?.map(location => location.toJSON()) ?? [],
						languagePackId: languagePack
					};
					const scopeKey = getRemoteExtensionsScanCacheScopeKey(scope);

					try {
						const knownContentHash = await this.scanCache.getContentHash(scopeKey);
						const result = await channel.call<RemoteExtensionsScanCacheResult>('scanExtensionsWithCache', [...scanArgs, knownContentHash]);
						if (result.type === 'hit') {
							const cached = await this.scanCache.getExtensions(result.contentHash);
							if (cached) {
								this.logService.trace('Remote extensions scan cache hit', result.contentHash);
								await this.scanCache.updateScope(scopeKey, result.contentHash);
								return reviveExtensions(cached);
							}
							this.logService.trace('Remote extensions scan cache miss: content not found', result.contentHash);
							const repairedResult = await channel.call<RemoteExtensionsScanCacheResult>('scanExtensionsWithCache', [...scanArgs, undefined]);
							if (repairedResult.type === 'miss') {
								const scannedExtensions = repairedResult.extensions as readonly StoredRemoteExtensionDescription[];
								await this.scanCache.store(scopeKey, repairedResult.contentHash, scannedExtensions);
								this.logService.trace('Remote extensions scan cache repaired', repairedResult.contentHash);
								return reviveExtensions(scannedExtensions);
							}
						} else {
							const scannedExtensions = result.extensions as readonly StoredRemoteExtensionDescription[];
							await this.scanCache.store(scopeKey, result.contentHash, scannedExtensions);
							this.logService.trace('Remote extensions scan cache stored', result.contentHash);
							return reviveExtensions(scannedExtensions);
						}
					} catch (error) {
						this.logService.debug('Remote extensions scan cache failed, falling back to full scan', error);
					}

					const scannedExtensions = await channel.call<StoredRemoteExtensionDescription[]>('scanExtensions', scanArgs);
					return reviveExtensions(scannedExtensions);
				},
				[]
			);
		} catch (error) {
			this.logService.error(error);
			return [];
		}
	}

	private withChannel<R>(callback: (channel: IChannel) => Promise<R>, fallback: R): Promise<R> {
		const connection = this.remoteAgentService.getConnection();
		if (!connection) {
			return Promise.resolve(fallback);
		}
		return connection.withChannel(RemoteExtensionsScannerChannelName, (channel) => callback(channel));
	}
}

function reviveExtensions(scannedExtensions: readonly StoredRemoteExtensionDescription[]): IExtensionDescription[] {
	return scannedExtensions.map(extension => {
		const revivedExtension = extension as Mutable<IExtensionDescription>;
		revivedExtension.extensionLocation = URI.revive(extension.extensionLocation);
		return revivedExtension;
	});
}

class RemoteExtensionsScanIndexedDBCache extends Disposable {

	private static readonly DB_NAME = 'vscode-remote-extensions-scan-cache';
	private static readonly DB_VERSION = 1;
	private static readonly MAX_CONTENT_ENTRIES = 5;

	private databasePromise: Promise<IndexedDB | undefined> | undefined;

	constructor(private readonly logService: ILogService) {
		super();
	}

	async getContentHash(scopeKey: string): Promise<string | undefined> {
		const db = await this.getDatabase();
		if (!db) {
			return undefined;
		}
		return db.runInTransaction<string | undefined>(RemoteExtensionsScanCacheStore.Scopes, 'readonly', store => store.get(scopeKey));
	}

	async getExtensions(contentHash: string): Promise<readonly StoredRemoteExtensionDescription[] | undefined> {
		const db = await this.getDatabase();
		if (!db) {
			return undefined;
		}
		const entry = await db.runInTransaction<IRemoteExtensionsScanCacheEntry | undefined>(RemoteExtensionsScanCacheStore.Contents, 'readonly', store => store.get(contentHash));
		if (!entry || entry.contentHash !== contentHash || !Array.isArray(entry.extensions)) {
			return undefined;
		}
		await this.touch(contentHash, entry);
		return entry.extensions;
	}

	async updateScope(scopeKey: string, contentHash: string): Promise<void> {
		const db = await this.getDatabase();
		if (!db) {
			return;
		}
		await db.runInTransaction(RemoteExtensionsScanCacheStore.Scopes, 'readwrite', store => store.put(contentHash, scopeKey));
	}

	async store(scopeKey: string, contentHash: string, extensions: readonly StoredRemoteExtensionDescription[]): Promise<void> {
		const db = await this.getDatabase();
		if (!db) {
			return;
		}
		await db.runInTransaction(RemoteExtensionsScanCacheStore.Contents, 'readwrite', store => store.put({ contentHash, extensions, lastUsed: Date.now() }, contentHash));
		await this.updateScope(scopeKey, contentHash);
		await this.prune();
	}

	private async touch(contentHash: string, entry: IRemoteExtensionsScanCacheEntry): Promise<void> {
		const db = await this.getDatabase();
		if (!db) {
			return;
		}
		await db.runInTransaction(RemoteExtensionsScanCacheStore.Contents, 'readwrite', store => store.put({ ...entry, lastUsed: Date.now() }, contentHash));
	}

	private async prune(): Promise<void> {
		const db = await this.getDatabase();
		if (!db) {
			return;
		}
		const entries = await db.getKeyValues<IRemoteExtensionsScanCacheEntry>(RemoteExtensionsScanCacheStore.Contents, isRemoteExtensionsScanCacheEntry);
		const staleEntries = [...entries.values()]
			.sort((a, b) => b.lastUsed - a.lastUsed)
			.slice(RemoteExtensionsScanIndexedDBCache.MAX_CONTENT_ENTRIES);
		if (!staleEntries.length) {
			return;
		}
		await db.runInTransaction(RemoteExtensionsScanCacheStore.Contents, 'readwrite', store => staleEntries.map(entry => store.delete(entry.contentHash)));
	}

	private getDatabase(): Promise<IndexedDB | undefined> {
		if (!this.databasePromise) {
			this.databasePromise = this.createDatabase();
		}
		return this.databasePromise;
	}

	private async createDatabase(): Promise<IndexedDB | undefined> {
		try {
			const db = await IndexedDB.create(RemoteExtensionsScanIndexedDBCache.DB_NAME, RemoteExtensionsScanIndexedDBCache.DB_VERSION, [RemoteExtensionsScanCacheStore.Scopes, RemoteExtensionsScanCacheStore.Contents]);
			this._register({ dispose: () => db.close() });
			return db;
		} catch (error) {
			this.logService.debug('Error while creating remote extensions scan cache IndexedDB', error);
			return undefined;
		}
	}
}

function isRemoteExtensionsScanCacheEntry(value: unknown): value is IRemoteExtensionsScanCacheEntry {
	const entry = value as IRemoteExtensionsScanCacheEntry | undefined;
	return typeof entry?.contentHash === 'string' && Array.isArray(entry.extensions) && typeof entry.lastUsed === 'number';
}

registerSingleton(IRemoteExtensionsScannerService, RemoteExtensionsScannerService, InstantiationType.Delayed);
