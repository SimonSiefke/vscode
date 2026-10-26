/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { ExtHostFileSystemEventService } from '../../common/extHostFileSystemEventService.js';
import { ExtHostContext, IMainContext, MainContext, MainThreadCommandsShape, MainThreadFileSystemEventServiceShape } from '../../common/extHost.protocol.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtHostFileSystemInfo } from '../../common/extHostFileSystemInfo.js';
import { URI } from '../../../../base/common/uri.js';
import { FileSystemProviderCapabilities } from '../../../../platform/files/common/files.js';
import { IExtHostWorkspace } from '../../common/extHostWorkspace.js';
import { RelativePattern } from '../../common/extHostTypes.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { ExtHostConfigProvider } from '../../common/extHostConfiguration.js';
import { RPCMessagePort } from '../../../services/extensions/common/rpcMessagePort.js';
import { RPCProtocol } from '../../../services/extensions/common/rpcProtocol.js';
import { IStructuredCloneMessage } from '../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../base/test/common/mock.js';

suite('ExtHostFileSystemEventService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** Recognizes empty replies in both native framing formats. */
	function isEmptyReply(message: unknown): boolean {
		if (ArrayBuffer.isView(message)) {
			return false;
		}
		const { header } = message as IStructuredCloneMessage;
		return (typeof header === 'number' ? header & 31 : (header as number[])[0]) === 7;
	}

	/** Exercises native framing, batching and snapshots through both real RPC peers. */
	function createRPCPair() {
		const replies: unknown[] = [];
		const clientPort = store.add(new RPCMessagePort(message => {
			const snapshot = structuredClone(message);
			queueMicrotask(() => serverPort.acceptMessage(snapshot));
		}));
		const serverPort = store.add(new RPCMessagePort(message => {
			replies.push(...(Array.isArray(message) ? message : [message]));
			const snapshot = structuredClone(message);
			queueMicrotask(() => clientPort.acceptMessage(snapshot));
		}));
		const client = store.add(new RPCProtocol(clientPort));
		const server = store.add(new RPCProtocol(serverPort));
		return { client, server, replies };
	}

	test('watcher registration and disposal use ordered notifications without empty replies', async () => {
		const { client, server, replies } = createRPCPair();
		const calls: string[] = [];
		server.set(MainContext.MainThreadFileSystemEventService, new class extends mock<MainThreadFileSystemEventServiceShape>() {
			override async $watch(): Promise<void> { calls.push('watch'); }
			override $unwatch(): void { calls.push('unwatch'); }
		});
		server.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			override async $getCommands(): Promise<string[]> { return []; }
		});
		const commands = client.getProxy(MainContext.MainThreadCommands);
		await commands.$getCommands();
		replies.length = 0;
		const service = new ExtHostFileSystemEventService(client, store.add(new NullLogService()), undefined!);
		const workspace = new class extends mock<IExtHostWorkspace>() {
			override getWorkspaceFolder() { return undefined; }
		};
		const watcher = store.add(service.createFileSystemWatcher(workspace, undefined!, new ExtHostFileSystemInfo(), nullExtensionDescription, new RelativePattern(URI.file('/outside-workspace'), '*.ts'), {}));
		watcher.dispose();
		await commands.$getCommands();
		const emptyReplies = replies.filter(isEmptyReply).length;
		assert.deepStrictEqual({ calls, emptyReplies }, { calls: ['watch', 'unwatch'], emptyReplies: 0 });
	});

	test('provider metadata and file notifications retain snapshots before a subsequent RPC barrier', async () => {
		const { client, server, replies } = createRPCPair();
		const info = new ExtHostFileSystemInfo();
		const service = new ExtHostFileSystemEventService(protocol, store.add(new NullLogService()), undefined!);
		server.set(ExtHostContext.ExtHostFileSystemInfo, info);
		server.set(ExtHostContext.ExtHostFileSystemEventService, service);
		server.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			override async $getCommands(): Promise<string[]> { return []; }
		});
		const workspace = new class extends mock<IExtHostWorkspace>() {
			override getWorkspaceFolder() { return { uri: URI.file('/workspace'), name: 'test', index: 0 }; }
		};
		const watcher = store.add(service.createFileSystemWatcher(workspace, undefined!, info, nullExtensionDescription, '**/*.ts', {}));
		const created: string[] = [];
		store.add(watcher.onDidCreate(uri => created.push(uri.path)));
		const commands = client.getProxy(MainContext.MainThreadCommands);
		await commands.$getCommands(); // Establish liveness before notification traffic.
		replies.length = 0;
		client.getProxy(ExtHostContext.ExtHostFileSystemInfo).$acceptProviderInfos(URI.file('/'), FileSystemProviderCapabilities.FileReadWrite);
		const events = { created: [URI.file('/workspace/before.ts')], changed: [], deleted: [] };
		client.getProxy(ExtHostContext.ExtHostFileSystemEventService).$onFileEvent(events);
		events.created.push(URI.file('/workspace/after.ts'));
		await commands.$getCommands();
		const emptyReplies = replies.filter(isEmptyReply).length;
		assert.deepStrictEqual({ capabilities: info.getCapabilities('file'), created, emptyReplies }, {
			capabilities: FileSystemProviderCapabilities.FileReadWrite,
			created: ['/workspace/before.ts'],
			emptyReplies: 0
		});
	});

	const protocol: IMainContext = {
		getProxy: () => { return undefined!; },
		set: undefined!,
		dispose: undefined!,
		assertRegistered: undefined!,
		drain: undefined!
	};

	const protocolWithProxy: IMainContext = {
		getProxy: () => ({ $watch() { }, $unwatch() { }, dispose() { } }) as never,
		set: undefined!,
		dispose: undefined!,
		assertRegistered: undefined!,
		drain: undefined!
	};

	test('FileSystemWatcher ignore events properties are reversed #26851', function () {

		const fileSystemInfo = new ExtHostFileSystemInfo();

		const watcher1 = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!).createFileSystemWatcher(undefined!, undefined!, fileSystemInfo, undefined!, '**/somethingInteresting', {});
		assert.strictEqual(watcher1.ignoreChangeEvents, false);
		assert.strictEqual(watcher1.ignoreCreateEvents, false);
		assert.strictEqual(watcher1.ignoreDeleteEvents, false);
		watcher1.dispose();

		const watcher2 = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!).createFileSystemWatcher(undefined!, undefined!, fileSystemInfo, undefined!, '**/somethingBoring', { ignoreCreateEvents: true, ignoreChangeEvents: true, ignoreDeleteEvents: true });
		assert.strictEqual(watcher2.ignoreChangeEvents, true);
		assert.strictEqual(watcher2.ignoreCreateEvents, true);
		assert.strictEqual(watcher2.ignoreDeleteEvents, true);
		watcher2.dispose();
	});

	test('FileSystemWatcher matches case-insensitively via pre-lowercasing', function () {
		const fileSystemInfo = new ExtHostFileSystemInfo();
		// Default: no PathCaseSensitive capability → ignoreCase=true for string patterns

		const workspace: Pick<IExtHostWorkspace, 'getWorkspaceFolder'> = {
			getWorkspaceFolder: () => ({ uri: URI.file('/workspace'), name: 'test', index: 0 })
		};

		const service = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!);
		const watcher = service.createFileSystemWatcher(workspace as IExtHostWorkspace, undefined!, fileSystemInfo, undefined!, '**/*.TXT', {});

		const created: URI[] = [];
		const sub = watcher.onDidCreate(uri => created.push(uri));

		// lowercase path should match uppercase pattern on case-insensitive fs
		service.$onFileEvent({
			session: undefined,
			created: [URI.file('/workspace/file.txt')],
			changed: [],
			deleted: []
		});

		assert.strictEqual(created.length, 1);

		sub.dispose();
		watcher.dispose();
	});

	test('FileSystemWatcher matches case-sensitively when PathCaseSensitive', function () {
		const fileSystemInfo = new ExtHostFileSystemInfo();
		fileSystemInfo.$acceptProviderInfos(URI.file('/'), FileSystemProviderCapabilities.PathCaseSensitive);

		const workspace: Pick<IExtHostWorkspace, 'getWorkspaceFolder'> = {
			getWorkspaceFolder: () => ({ uri: URI.file('/workspace'), name: 'test', index: 0 })
		};

		const service = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!);
		const watcher = service.createFileSystemWatcher(workspace as IExtHostWorkspace, undefined!, fileSystemInfo, undefined!, '**/*.TXT', {});

		const created: URI[] = [];
		const sub = watcher.onDidCreate(uri => created.push(uri));

		// lowercase path should NOT match uppercase pattern on case-sensitive fs
		service.$onFileEvent({
			session: undefined,
			created: [URI.file('/workspace/file.txt')],
			changed: [],
			deleted: []
		});

		assert.strictEqual(created.length, 0);

		// uppercase path SHOULD match
		service.$onFileEvent({
			session: undefined,
			created: [URI.file('/workspace/file.TXT')],
			changed: [],
			deleted: []
		});

		assert.strictEqual(created.length, 1);

		sub.dispose();
		watcher.dispose();
	});

	test('FileSystemWatcher matches relative pattern case-insensitively via pre-lowercasing', function () {
		const fileSystemInfo = new ExtHostFileSystemInfo();
		fileSystemInfo.$acceptProviderInfos(URI.file('/'), FileSystemProviderCapabilities.FileReadWrite); // no PathCaseSensitive → ignoreCase=true

		const workspace: Pick<IExtHostWorkspace, 'getWorkspaceFolder'> = {
			getWorkspaceFolder: () => ({ uri: URI.file('/workspace'), name: 'test', index: 0 })
		};

		const configProvider = {
			getConfiguration: () => ({ get: () => ({}) })
		} as unknown as ExtHostConfigProvider;

		const service = new ExtHostFileSystemEventService(protocolWithProxy, new NullLogService(), undefined!);
		const watcher = service.createFileSystemWatcher(workspace as IExtHostWorkspace, configProvider, fileSystemInfo, nullExtensionDescription, new RelativePattern('/Workspace', '**/*.TXT'), {});

		const created: URI[] = [];
		const sub = watcher.onDidCreate(uri => created.push(uri));

		// lowercase path should match mixed-case base + uppercase extension on case-insensitive fs
		service.$onFileEvent({
			session: undefined,
			created: [URI.file('/workspace/file.txt')],
			changed: [],
			deleted: []
		});

		assert.strictEqual(created.length, 1);

		sub.dispose();
		watcher.dispose();
	});

});
