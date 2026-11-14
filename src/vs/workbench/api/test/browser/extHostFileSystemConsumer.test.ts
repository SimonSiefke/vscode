/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtHostConsumerFileSystem } from '../../common/extHostFileSystemConsumer.js';
import { ExtHostFileSystemInfo } from '../../common/extHostFileSystemInfo.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostConsumerFileSystem activation', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const uri = URI.parse('local-test:/file');
	const directory: vscode.FileStat = { type: 2, ctime: 0, mtime: 0, size: 0 };
	const bytes = new Uint8Array([1, 2, 3]);
	const entries: [string, vscode.FileType][] = [['file', 1]];

	/** Creates a local provider whose operations expose activation ordering. */
	function createProvider(onOperation: () => void = () => { }): vscode.FileSystemProvider {
		return {
			onDidChangeFile: Event.None,
			watch: () => Disposable.None,
			stat: () => { onOperation(); return directory; },
			readFile: () => { onOperation(); return bytes; },
			readDirectory: () => { onOperation(); return entries; },
			createDirectory: () => { onOperation(); },
			writeFile: () => { onOperation(); },
			delete: () => { onOperation(); },
			rename: () => { throw new Error('Rename must use the main-thread path'); }
		};
	}

	/** Uses the real public filesystem API with a controlled main-thread barrier. */
	function createConsumer(ensureActivation: (scheme: string) => Promise<void>) {
		return new ExtHostConsumerFileSystem(SingleProxyRPCProtocol({ $ensureActivation: ensureActivation }), new ExtHostFileSystemInfo());
	}

	test('successful activation is reused across local operations and retains safe copies', async () => {
		let activations = 0;
		const consumer = createConsumer(async scheme => { assert.strictEqual(scheme, uri.scheme); activations++; });
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		const fs = consumer.value;
		await fs.stat(uri);
		const result = await fs.readFile(uri);
		const listing = await fs.readDirectory(uri);
		await fs.createDirectory(uri);
		await fs.writeFile(uri, bytes);
		await fs.delete(uri);
		assert.strictEqual(activations, 1);
		assert.deepStrictEqual(result, bytes);
		assert.notStrictEqual(result, bytes);
		assert.deepStrictEqual(listing, entries);
		assert.notStrictEqual(listing, entries);
	});

	test('concurrent local operations share and wait for first activation', async () => {
		const gate = new DeferredPromise<void>();
		let activations = 0;
		let operations = 0;
		const consumer = createConsumer(() => { activations++; return gate.p; });
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider(() => operations++)));
		const pending = Array.from({ length: 32 }, () => consumer.value.readFile(uri));
		const beforeRelease = { activations, operations };
		gate.complete();
		await Promise.all(pending);
		assert.deepStrictEqual(beforeRelease, { activations: 1, operations: 0 });
		assert.strictEqual(operations, 32);
	});

	test('activation failures are retried before invoking the local provider', async () => {
		let activations = 0;
		let operations = 0;
		const consumer = createConsumer(async () => {
			if (++activations === 1) { throw new Error('activation failed'); }
		});
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider(() => operations++)));
		await assert.rejects(async () => consumer.value.readFile(uri), /activation failed/);
		assert.strictEqual(operations, 0);
		await consumer.value.readFile(uri);
		await consumer.value.stat(uri);
		assert.deepStrictEqual({ activations, operations }, { activations: 2, operations: 2 });
	});

	test('provider registrations have independent activation barriers', async () => {
		const gates = [new DeferredPromise<void>(), new DeferredPromise<void>()];
		let activations = 0;
		const consumer = createConsumer(() => gates[Math.min(activations++, gates.length - 1)].p);
		const firstRegistration = store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		const first = consumer.value.readFile(uri);
		firstRegistration.dispose();
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		const second = consumer.value.readFile(uri);
		gates[0].complete();
		await first;
		const third = consumer.value.stat(uri);
		const beforeRelease = activations;
		gates[1].complete();
		await Promise.all([second, third]);
		assert.strictEqual(beforeRelease, 2);
	});

	test('disposing an old registration does not remove its replacement', async () => {
		let activations = 0;
		const consumer = createConsumer(async () => { activations++; });
		const previous = store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		previous.dispose();
		assert.deepStrictEqual({ bytes: [...await consumer.value.readFile(uri)], activations }, { bytes: [1, 2, 3], activations: 1 });
	});

	test('readonly, trash, rename, copy and nonlocal operations retain main-thread paths', async () => {
		const calls: string[] = [];
		const record = (name: string) => async () => { calls.push(name); };
		const consumer = new ExtHostConsumerFileSystem(SingleProxyRPCProtocol({
			$ensureActivation: () => { throw new Error('No local operation expected'); },
			$stat: async () => { calls.push('stat'); return directory; },
			$mkdir: record('mkdir'), $writeFile: record('write'), $delete: record('delete'),
			$rename: record('rename'), $copy: record('copy')
		}), new ExtHostFileSystemInfo());
		await consumer.value.stat(uri);
		const readonlyRegistration = store.add(consumer.addFileSystemProvider(uri.scheme, createProvider(), { isReadonly: true }));
		await consumer.value.createDirectory(uri);
		await consumer.value.writeFile(uri, bytes);
		await consumer.value.delete(uri);
		readonlyRegistration.dispose();
		store.add(consumer.addFileSystemProvider(uri.scheme, createProvider()));
		await consumer.value.delete(uri, { useTrash: true });
		await consumer.value.rename(uri, uri);
		await consumer.value.copy(uri, uri);
		assert.deepStrictEqual(calls, ['stat', 'mkdir', 'write', 'delete', 'delete', 'rename', 'copy']);
	});
});
