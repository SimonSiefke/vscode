/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { join } from '../../../../base/common/path.js';
import { consumeStream, newWriteableStream } from '../../../../base/common/stream.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { DefaultURITransformer, IURITransformer } from '../../../../base/common/uriIpc.js';
import { ChannelClient, ChannelServer } from '../../../../base/parts/ipc/common/ipc.js';
import { createMessagePortProtocols } from '../../../../base/parts/ipc/test/node/ipcTestUtils.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../../base/test/node/testUtils.js';
import { NullLogService } from '../../../log/common/log.js';
import { DiskFileSystemProviderClient } from '../../common/diskFileSystemProviderClient.js';
import { createFileSystemProviderError, FileSystemProviderErrorCode, IFileChange, toFileSystemProviderErrorCode } from '../../common/files.js';
import { DiskFileSystemProvider } from '../../node/diskFileSystemProvider.js';
import { AbstractDiskFileSystemProviderChannel, ISessionFileWatcher } from '../../node/diskFileSystemProviderServer.js';

class TestDiskChannel extends AbstractDiskFileSystemProviderChannel<string> {
	protected getUriTransformer(): IURITransformer { return DefaultURITransformer; }
	protected transformIncoming(_transformer: IURITransformer, resource: UriComponents): URI { return URI.revive(resource); }
	protected createSessionFileWatcher(_transformer: IURITransformer, _emitter: Emitter<IFileChange[] | string>): ISessionFileWatcher {
		return { watch: () => Disposable.None, dispose: () => { } };
	}
}

suite('DiskFileSystemProvider native IPC', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string;

	setup(async () => {
		directory = getRandomTestPath(tmpdir(), 'vsctests', 'native-file-ipc');
		await promises.mkdir(directory, { recursive: true });
	});
	teardown(async () => { await promises.rm(directory, { recursive: true, force: true }); });

	function connect(provider: DiskFileSystemProvider): DiskFileSystemProviderClient {
		const [serverProtocol, clientProtocol] = createMessagePortProtocols(store);
		const server = store.add(new ChannelServer(serverProtocol, 'test'));
		server.registerChannel('files', store.add(new TestDiskChannel(provider, new NullLogService())));
		const client = store.add(new ChannelClient(clientProtocol));
		return store.add(new DiskFileSystemProviderClient(client.getChannel('files'), {}));
	}

	for (const code of [FileSystemProviderErrorCode.FileNotFound, FileSystemProviderErrorCode.NoPermissions, FileSystemProviderErrorCode.FileTooLarge]) {
		test(`stream errors retain provider classification ${code} over a real MessagePort`, async () => {
			const provider = store.add(new class extends DiskFileSystemProvider {
				override readFileStream() {
					const stream = newWriteableStream<Uint8Array>(null);
					queueMicrotask(() => {
						stream.error(createFileSystemProviderError('provider failure', code));
						stream.end();
					});
					return stream;
				}
			}(new NullLogService()));
			const client = connect(provider);
			await assert.rejects(consumeStream(client.readFileStream(URI.file(join(directory, 'file')), {}, CancellationToken.None), chunks => chunks[0]), error =>
				error instanceof Error && error.message === 'provider failure' && toFileSystemProviderErrorCode(error) === code);
		});
	}

	test('real missing-file stream errors retain their classification', async () => {
		const client = connect(store.add(new DiskFileSystemProvider(new NullLogService())));
		await assert.rejects(consumeStream(client.readFileStream(URI.file(join(directory, 'missing')), {}, CancellationToken.None), chunks => chunks[0]), error =>
			error instanceof Error && toFileSystemProviderErrorCode(error) === FileSystemProviderErrorCode.FileNotFound);
	});

	test('file contents, partial reads and write offsets preserve exact bytes', async () => {
		const client = connect(store.add(new DiskFileSystemProvider(new NullLogService())));
		const resource = URI.file(join(directory, 'bytes'));
		const content = Uint8Array.from([0xef, 0xbb, 0xbf, 65, 66]);
		await client.writeFile(resource, content, { create: true, overwrite: true, unlock: false, atomic: false });
		assert.deepStrictEqual([...await client.readFile(resource)], [...content]);
		const fd = await client.open(resource, { create: false });
		try {
			const target = new Uint8Array(8).fill(255);
			const read = await client.read(fd, 3, target, 2, 5);
			assert.deepStrictEqual({ read, target: [...target] }, { read: 2, target: [255, 255, 65, 66, 255, 255, 255, 255] });
		} finally {
			await client.close(fd);
		}
		const writable = await client.open(resource, { create: true, unlock: false });
		try {
			const written = await client.write(writable, 0, Uint8Array.from([90, 0xef, 0xbb, 0xbf, 88, 89, 90]), 1, 5);
			assert.deepStrictEqual({ written, content: [...await client.readFile(resource)] }, { written: 5, content: [0xef, 0xbb, 0xbf, 88, 89] });
		} finally {
			await client.close(writable);
		}
	});
});
