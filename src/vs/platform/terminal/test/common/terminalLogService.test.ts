/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../environment/common/environment.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { BufferLogger } from '../../../log/common/bufferLog.js';
import { AbstractLoggerService, ILoggerService, LogLevel } from '../../../log/common/log.js';
import { IWorkspaceContextService } from '../../../workspace/common/workspace.js';
import { TerminalLogService } from '../../common/terminalLogService.js';

class TestLoggerService extends AbstractLoggerService {
	protected doCreateLogger(_resource: URI, logLevel: LogLevel): BufferLogger {
		return new BufferLogger(logLevel);
	}
}

suite('TerminalLogService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('uses a separate terminal log resource for each window', () => {
		const resources: string[] = [];
		for (const windowId of [1, 2]) {
			const loggerService = disposables.add(new TestLoggerService(LogLevel.Info, URI.file(`/logs/window${windowId}`)));
			const instantiationService = disposables.add(new TestInstantiationService());
			instantiationService.stub(ILoggerService, loggerService);
			instantiationService.stub(IEnvironmentService, { logsHome: URI.file('/logs') });
			instantiationService.stub(IWorkspaceContextService, {
				onDidChangeWorkspaceFolders: Event.None,
				getWorkspace: () => ({ id: `workspace${windowId}`, folders: [] })
			});
			disposables.add(instantiationService.createInstance(TerminalLogService));
			resources.push(...[...loggerService.getRegisteredLoggers()].map(logger => logger.resource.toString()));
		}

		assert.deepStrictEqual(resources, [
			'file:///logs/window1/terminal.log',
			'file:///logs/window2/terminal.log'
		]);
	});
});
