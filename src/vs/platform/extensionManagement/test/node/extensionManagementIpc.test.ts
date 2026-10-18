/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IAllowedExtensionsService, ILocalExtension } from '../../common/extensionManagement.js';
import { ExtensionManagementChannelClient } from '../../common/extensionManagementIpc.js';
import { IExtensionManifest } from '../../../extensions/common/extensions.js';
import { IProductService } from '../../../product/common/productService.js';

suite('ExtensionManagementChannelClient', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('shares repeated strings in manifests received over IPC', async () => {
		// Node's V8 snapshot API is unsupported in Electron renderers. Use a small
		// Node child so this check also works in the Electron test runner.
		if (!process.env['VSCODE_TEST_MANIFEST_STRING_POOL_CHILD']) {
			await new Promise<void>((resolve, reject) => {
				execFile(process.execPath, [
					fileURLToPath(new URL('../../../../../../test/unit/node/index.js', import.meta.url)),
					'--run', fileURLToPath(import.meta.url)
				], {
					env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_TEST_MANIFEST_STRING_POOL_CHILD: '1' },
					timeout: 30000
				}, (error, stdout, stderr) => {
					if (error) {
						reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
					} else {
						resolve();
					}
				});
			});
			return;
		}
		const description = `Duplicate manifest description ${randomUUID()} ${'long description '.repeat(10)}`;
		const manifest: IExtensionManifest = {
			name: 'name', publisher: 'pub', version: '1.0.0', engines: { vscode: '*' },
			contributes: {
				debuggers: Array.from({ length: 32 }, (_, index) => ({
					type: `debugger${index}`,
					configurationAttributes: {
						launch: { properties: { program: { description, enumDescriptions: [description] } } }
					}
				}))
			}
		};
		const local = new class extends mock<ILocalExtension>() {
			override manifest = manifest;
			override location = URI.file('/extension');
		};
		const channel: IChannel = {
			listen: () => Event.None,
			call: async <T>() => JSON.parse(JSON.stringify([local])) as T
		};
		const client = disposables.add(new ExtensionManagementChannelClient(channel, new class extends mock<IProductService>() { }, new class extends mock<IAllowedExtensionsService>() { }));
		const extensions = await client.getInstalled();
		assert.deepStrictEqual(extensions[0].manifest, manifest);
		assert.ok(URI.isUri(extensions[0].location));
		const count = await countStringInstances(description);
		assert.ok(count > 0 && count <= 3, `IPC manifests should share equal string values, got ${count}`);
	}).timeout(30000);
});

/** Counts physical string nodes, since JavaScript equality only compares their values. */
async function countStringInstances(value: string): Promise<number> {
	const { getHeapSnapshot }: typeof import('node:v8') = createRequire(import.meta.url)('node:v8');
	const chunks: Buffer[] = [];
	for await (const chunk of getHeapSnapshot()) {
		chunks.push(chunk);
	}
	const snapshot: {
		snapshot: { meta: { node_fields: string[]; node_types: string[][] } };
		nodes: number[];
		strings: string[];
	} = JSON.parse(Buffer.concat(chunks).toString());
	const fields = snapshot.snapshot.meta.node_fields;
	const typeOffset = fields.indexOf('type');
	const nameOffset = fields.indexOf('name');
	const stringType = snapshot.snapshot.meta.node_types[typeOffset].indexOf('string');
	let count = 0;
	for (let offset = 0; offset < snapshot.nodes.length; offset += fields.length) {
		if (snapshot.nodes[offset + typeOffset] === stringType && snapshot.strings[snapshot.nodes[offset + nameOffset]] === value) {
			count++;
		}
	}
	return count;
}
