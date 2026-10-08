/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import pkg from '@xterm/headless';
import { createSandbox } from 'sinon';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import * as performance from '../../../../base/common/performance.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { PtyService } from '../../node/ptyService.js';
import { TerminalProcess } from '../../node/terminalProcess.js';

// PtyService drops event subscription handles whose listeners are released by emitter disposal.
// Shut down each process explicitly; the generic tracker reports those existing handles as leaks.
// eslint-disable-next-line local/code-ensure-no-disposables-leak-in-test
suite('PtyService performance marks', () => {
	const sandbox = createSandbox();
	const store = new DisposableStore();
	const processIds = new Set<number>();
	let service: PtyService;

	teardown(async () => {
		for (const id of processIds) {
			const exited = Event.toPromise(service.onProcessExit);
			await service.shutdown(id, true);
			await exited;
		}
		store.clear();
		for (const mark of performance.getMarks()) {
			if (mark.name.startsWith('code/willBuildProcessDetails/') || mark.name.startsWith('code/didBuildProcessDetails/') || mark.name.endsWith('GetTerminalLayoutInfo') || mark.name === 'pty-service-test/unrelated') {
				performance.clearMarks(mark.name);
			}
		}
		sandbox.restore();
	});

	suiteTeardown(() => store.dispose());

	setup(() => {
		service = store.add(new PtyService(new NullLogService(), { applicationName: 'vscode' } as IProductService, { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		store.add(service.onProcessExit(e => processIds.delete(e.id)));
		sandbox.stub(TerminalProcess.prototype, 'getCwd').resolves('/test');
	});

	async function createProcess() {
		const loadAddon = sandbox.spy(pkg.Terminal.prototype, 'loadAddon');
		const id = await service.createProcess({}, '/test', 80, 30, '6', {}, {}, {
			shellIntegration: { enabled: false, suggestEnabled: false, nonce: 'test' },
			windowsUseConptyDll: false, environmentVariableCollections: undefined, workspaceFolder: undefined, isScreenReaderOptimized: false
		}, true, 'workspace', 'Workspace');
		processIds.add(id);
		// No shell is started. Dispose the headless terminal explicitly in the fixture.
		const terminal: pkg.Terminal = loadAddon.firstCall.thisValue;
		store.add(toDisposable(() => terminal.dispose()));
		loadAddon.restore();
		await service.detachFromProcess(id, true);
		return id;
	}

	function markNames() {
		return performance.getMarks().map(mark => mark.name).filter(name => name.includes('BuildProcessDetails') || name.endsWith('GetTerminalLayoutInfo')).sort();
	}

	test('keeps one sample per name when listing the same process repeatedly', async () => {
		const id = await createProcess();
		performance.mark('pty-service-test/unrelated');
		for (let index = 0; index < 3; index++) {
			await service.listProcesses();
		}
		deepStrictEqual({ marks: markNames(), unrelated: performance.getMarks().filter(mark => mark.name === 'pty-service-test/unrelated').length }, {
			marks: [`code/didBuildProcessDetails/${id}`, `code/willBuildProcessDetails/${id}`], unrelated: 1
		});
	});

	test('keeps one layout sample on both empty and populated layout paths', async () => {
		await service.getTerminalLayoutInfo({ workspaceId: 'workspace' });
		await service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: [], background: null });
		await service.getTerminalLayoutInfo({ workspaceId: 'workspace' });
		await service.getTerminalLayoutInfo({ workspaceId: 'workspace' });
		deepStrictEqual(markNames(), ['code/didGetTerminalLayoutInfo', 'code/willGetTerminalLayoutInfo']);
	});

	test('clears a process sample when it exits without clearing another process', async () => {
		const first = await createProcess();
		const second = await createProcess();
		await service.listProcesses();
		const exited = Event.toPromise(service.onProcessExit);
		await service.shutdown(first, true);
		await exited;
		deepStrictEqual(markNames(), [`code/didBuildProcessDetails/${second}`, `code/willBuildProcessDetails/${second}`]);
	});

	test('does not recreate a sample after its process exits during a request', async () => {
		const id = await createProcess();
		const cwd = new DeferredPromise<string>();
		sandbox.restore();
		sandbox.stub(TerminalProcess.prototype, 'getCwd').returns(cwd.p);
		const pending = service.listProcesses();
		const exited = Event.toPromise(service.onProcessExit);
		await service.shutdown(id, true);
		await exited;
		await cwd.complete('/test');
		await pending;
		deepStrictEqual(markNames(), []);
	});

	test('bounds samples when concurrent requests complete', async () => {
		const id = await createProcess();
		await Promise.all([service.listProcesses(), service.listProcesses(), service.listProcesses()]);
		deepStrictEqual(markNames(), [`code/didBuildProcessDetails/${id}`, `code/willBuildProcessDetails/${id}`]);
	});
});
