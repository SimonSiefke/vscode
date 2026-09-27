/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstallExtensionSummary } from '../../extensionManagement/common/extensionManagement.js';
import { IExtensionDescription } from '../../extensions/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { hashAsync } from '../../../base/common/hash.js';

export const IRemoteExtensionsScannerService = createDecorator<IRemoteExtensionsScannerService>('IRemoteExtensionsScannerService');

export const RemoteExtensionsScannerChannelName = 'remoteExtensionsScanner';

export interface IRemoteExtensionsScanCacheScope {
	readonly remoteAuthority: string | undefined;
	readonly language: string;
	readonly profileLocation: UriComponents | undefined;
	readonly workspaceExtensionLocations: readonly UriComponents[];
	readonly extensionDevelopmentLocations: readonly UriComponents[];
	readonly languagePackId: string | undefined;
}

export type RemoteExtensionsScanCacheResult =
	| { readonly type: 'hit'; readonly contentHash: string }
	| { readonly type: 'miss'; readonly contentHash: string; readonly extensions: readonly IExtensionDescription[] };

export interface IRemoteExtensionsScannerService {
	readonly _serviceBrand: undefined;

	/**
	 * Returns a promise that resolves to an array of extension identifiers that failed to install
	 */
	whenExtensionsReady(): Promise<InstallExtensionSummary>;
	scanExtensions(): Promise<IExtensionDescription[]>;
}

export function getRemoteExtensionsScanCacheScopeKey(scope: IRemoteExtensionsScanCacheScope): string {
	return stableStringify({
		remoteAuthority: scope.remoteAuthority,
		language: scope.language,
		profileLocation: normalizeUriComponents(scope.profileLocation),
		workspaceExtensionLocations: scope.workspaceExtensionLocations.map(normalizeUriComponents).sort(),
		extensionDevelopmentLocations: scope.extensionDevelopmentLocations.map(normalizeUriComponents).sort(),
		languagePackId: scope.languagePackId,
	});
}

export function getRemoteExtensionsScanContentHash(extensions: readonly IExtensionDescription[]): Promise<string> {
	return hashAsync(stableStringify(extensions));
}

export function toUriComponents(uri: URI | undefined): UriComponents | undefined {
	return uri?.toJSON();
}

function normalizeUriComponents(uri: UriComponents | undefined): string | undefined {
	return uri ? URI.revive(uri).toString() : undefined;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (value && typeof value === 'object' && !URI.isUri(value)) {
		const result: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(value).sort()) {
			result[key] = sortValue((value as Record<string, unknown>)[key]);
		}
		return result;
	}
	return value;
}
