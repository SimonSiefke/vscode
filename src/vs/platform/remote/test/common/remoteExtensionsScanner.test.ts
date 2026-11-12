/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getRemoteExtensionsScanCacheScopeKey, getRemoteExtensionsScanContentHash, IRemoteExtensionsScanCacheScope } from '../../common/remoteExtensionsScanner.js';
import { URI } from '../../../../base/common/uri.js';
import { ExtensionIdentifier, IExtensionDescription, TargetPlatform } from '../../../extensions/common/extensions.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('RemoteExtensionsScanner', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates stable cache scope keys', () => {
		const scope: IRemoteExtensionsScanCacheScope = {
			remoteAuthority: 'ssh-remote+host',
			language: 'en',
			profileLocation: URI.file('/profiles/default/extensions.json').toJSON(),
			workspaceExtensionLocations: [URI.file('/workspace/b').toJSON(), URI.file('/workspace/a').toJSON()],
			extensionDevelopmentLocations: [URI.file('/dev/b').toJSON(), URI.file('/dev/a').toJSON()],
			languagePackId: undefined
		};
		const sameScopeDifferentOrder: IRemoteExtensionsScanCacheScope = {
			...scope,
			workspaceExtensionLocations: [URI.file('/workspace/a').toJSON(), URI.file('/workspace/b').toJSON()],
			extensionDevelopmentLocations: [URI.file('/dev/a').toJSON(), URI.file('/dev/b').toJSON()],
		};

		assert.strictEqual(getRemoteExtensionsScanCacheScopeKey(scope), getRemoteExtensionsScanCacheScopeKey(sameScopeDifferentOrder));
	});

	test('separates cache scope keys by startup inputs', () => {
		const scope: IRemoteExtensionsScanCacheScope = {
			remoteAuthority: 'ssh-remote+host',
			language: 'en',
			profileLocation: undefined,
			workspaceExtensionLocations: [],
			extensionDevelopmentLocations: [],
			languagePackId: undefined
		};

		assert.notStrictEqual(getRemoteExtensionsScanCacheScopeKey(scope), getRemoteExtensionsScanCacheScopeKey({ ...scope, language: 'de' }));
		assert.notStrictEqual(getRemoteExtensionsScanCacheScopeKey(scope), getRemoteExtensionsScanCacheScopeKey({ ...scope, profileLocation: URI.file('/profile/extensions.json').toJSON() }));
		assert.notStrictEqual(getRemoteExtensionsScanCacheScopeKey(scope), getRemoteExtensionsScanCacheScopeKey({ ...scope, languagePackId: 'publisher.language-pack' }));
	});

	test('creates stable content hashes', async () => {
		const extension = createExtensionDescription();
		const sameExtensionDifferentPropertyOrder = {
			version: extension.version,
			name: extension.name,
			publisher: extension.publisher,
			identifier: extension.identifier,
			id: extension.id,
			engines: extension.engines,
			isBuiltin: extension.isBuiltin,
			isUserBuiltin: extension.isUserBuiltin,
			isUnderDevelopment: extension.isUnderDevelopment,
			extensionLocation: extension.extensionLocation,
			targetPlatform: extension.targetPlatform,
			preRelease: extension.preRelease,
		} satisfies IExtensionDescription;
		const changedExtension = { ...extension, version: '2.0.0' };

		assert.strictEqual(await getRemoteExtensionsScanContentHash([extension]), await getRemoteExtensionsScanContentHash([sameExtensionDifferentPropertyOrder]));
		assert.notStrictEqual(await getRemoteExtensionsScanContentHash([extension]), await getRemoteExtensionsScanContentHash([changedExtension]));
	});
});

function createExtensionDescription(): IExtensionDescription {
	return {
		id: 'publisher.name',
		identifier: new ExtensionIdentifier('publisher.name'),
		name: 'name',
		publisher: 'publisher',
		version: '1.0.0',
		engines: { vscode: '*' },
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		extensionLocation: URI.file('/extensions/publisher.name'),
		targetPlatform: TargetPlatform.UNDEFINED,
		preRelease: false,
	};
}
