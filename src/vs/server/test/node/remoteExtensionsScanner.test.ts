/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { URITransformer } from '../../../base/common/uriIpc.js';
import { mock } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { RemoteExtensionsScanCacheResult } from '../../../platform/remote/common/remoteExtensionsScanner.js';
import { RemoteExtensionsScannerChannel, RemoteExtensionsScannerService } from '../../node/remoteExtensionsScanner.js';

suite('RemoteExtensionsScannerChannel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('both scan verbs transform the same incoming arguments and outgoing locations', async () => {
		const scans: { language: string | undefined; profile: string | undefined; workspace: string[] | undefined; development: string[] | undefined; languagePack: string | undefined }[] = [];
		let version = '1.0.0';
		const scanner = new class extends mock<RemoteExtensionsScannerService>() {
			override async scanExtensions(language?: string, profile?: URI, workspace?: URI[], development?: URI[], languagePack?: string): Promise<IExtensionDescription[]> {
				scans.push({ language, profile: profile?.toString(), workspace: workspace?.map(uri => uri.toString()), development: development?.map(uri => uri.toString()), languagePack });
				return [{ identifier: { value: 'test.extension' }, name: 'extension', publisher: 'test', version, extensionLocation: URI.file('/extensions/test') } as IExtensionDescription];
			}
		}();
		const transformer = new URITransformer({
			transformIncoming: uri => ({ ...uri, scheme: 'file', authority: '' }),
			transformOutgoing: uri => ({ ...uri, scheme: 'vscode-remote', authority: 'test' }),
			transformOutgoingScheme: () => 'vscode-remote'
		});
		const channel = new RemoteExtensionsScannerChannel(scanner, () => transformer);
		const args = ['de', URI.parse('vscode-remote://test/profile').toJSON(), [URI.parse('vscode-remote://test/workspace').toJSON()], [URI.parse('vscode-remote://test/development').toJSON()], 'test.language-pack'];
		const legacy = await channel.call(null, 'scanExtensions', args) as IExtensionDescription[];
		const first = await channel.call(null, 'scanExtensionsWithCache', args) as RemoteExtensionsScanCacheResult;
		const second = await channel.call(null, 'scanExtensionsWithCache', [...args, first.contentHash]) as RemoteExtensionsScanCacheResult;
		version = '2.0.0';
		const third = await channel.call(null, 'scanExtensionsWithCache', [...args, first.contentHash]) as RemoteExtensionsScanCacheResult;
		assert.ok(first.type === 'miss' && third.type === 'miss');
		const locations = [legacy, first.extensions, third.extensions].map(list => URI.revive(list[0].extensionLocation as UriComponents).toString());
		assert.deepStrictEqual({ scans, locations, results: [first.type, second.type, third.type], hashChanged: first.contentHash !== third.contentHash }, {
			scans: Array.from({ length: 4 }, () => ({ language: 'de', profile: 'file:///profile', workspace: ['file:///workspace'], development: ['file:///development'], languagePack: 'test.language-pack' })),
			locations: Array(3).fill('vscode-remote://test/extensions/test'), results: ['miss', 'hit', 'miss'], hashChanged: true
		});
	});
});
