/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILoggerService, NullLogger, NullLogService } from '../../../../platform/log/common/log.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { MainContext, MainThreadOutputServiceShape } from '../../common/extHost.protocol.js';
import { IExtHostConsumerFileSystem } from '../../common/extHostFileSystemConsumer.js';
import { ExtHostFileSystemInfo } from '../../common/extHostFileSystemInfo.js';
import { IExtHostInitDataService } from '../../common/extHostInitDataService.js';
import { ExtHostOutputService } from '../../common/extHostOutput.js';
import { TestRPCProtocol } from './testRPCProtocol.js';

suite('ExtHostOutput', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('disposes a channel while it is being created', async () => {
		const outputDirectory = new DeferredPromise<void>();
		const disposedChannelIds: string[] = [];
		const rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadOutputService, new class extends mock<MainThreadOutputServiceShape>() {
			override async $register(): Promise<string> { return 'channel-id'; }
			override async $dispose(id: string): Promise<void> { disposedChannelIds.push(id); }
		});

		let loggerDisposed = false;
		let loggerDeregistered = false;
		const logger = new class extends NullLogger {
			override dispose(): void { loggerDisposed = true; }
		};
		const loggerService = new class extends mock<ILoggerService>() {
			override createLogger() { return logger; }
			override deregisterLogger(): void { loggerDeregistered = true; }
			override getRegisteredLogger() { return undefined; }
		};
		const fileSystem = new class extends mock<IExtHostConsumerFileSystem>() {
			override readonly value = {
				createDirectory: () => outputDirectory.p
			} as unknown as vscode.FileSystem;
		};
		const initData = new class extends mock<IExtHostInitDataService>() {
			override readonly logsLocation = URI.file('/logs');
			override readonly environment = {} as IExtHostInitDataService['environment'];
		};
		const service = new ExtHostOutputService(
			rpcProtocol,
			initData,
			fileSystem,
			new ExtHostFileSystemInfo(),
			loggerService,
			new NullLogService()
		);
		const extension = {
			...nullExtensionDescription,
			identifier: new ExtensionIdentifier('test.output'),
			extensionLocation: URI.file('/extension')
		};

		const channel = service.createOutputChannel('test', undefined, extension);
		channel.dispose();
		await outputDirectory.complete();
		await rpcProtocol.sync();
		await timeout(0);
		await rpcProtocol.sync();

		assert.strictEqual(loggerDisposed, true);
		assert.strictEqual(loggerDeregistered, true);
		assert.deepStrictEqual(disposedChannelIds, ['channel-id']);
	});
});
