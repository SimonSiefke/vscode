/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestAccessibilityService } from '../../../../../platform/accessibility/test/common/testAccessibilityService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestContextService, TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { DebugSession } from '../../browser/debugSession.js';
import { RawDebugSession } from '../../browser/rawDebugSession.js';
import { IDebugAdapter, IDebugService, IDebugger, IViewModel, State } from '../../common/debug.js';
import { MockDebugAdapter } from '../common/mockDebug.js';
import { createMockDebugModel, mockUriIdentityService } from './mockDebugModel.js';

suite('DebugSession startup disposal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createSession() {
		const entered = new DeferredPromise<void>();
		const ready = new DeferredPromise<void>();
		const requests: string[] = [];
		const adapter = store.add(new class extends MockDebugAdapter {
			override startSession(): Promise<void> { entered.complete(); return ready.p; }
			override sendMessage(message: DebugProtocol.ProtocolMessage): void {
				if (message.type === 'request') {
					requests.push((message as DebugProtocol.Request).command);
				}
				super.sendMessage(message);
			}
		});
		const debuggerInfo = new class extends mock<IDebugger>() {
			override createDebugAdapter(): Promise<IDebugAdapter> { return Promise.resolve(adapter); }
		};
		const model = createMockDebugModel(store);
		const service = new class extends mock<IDebugService>() {
			override getModel() { return model; }
			override getViewModel() { return upcastPartial<IViewModel>({ updateViews() { } }); }
			override setExceptionBreakpointsForSession(): void { }
		};
		const raw = store.add(new RawDebugSession(adapter, debuggerInfo, 'startup-disposal', 'Startup Disposal', undefined!, undefined!, undefined!, undefined!));
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stubInstance(RawDebugSession, raw);
		const session = store.add(new DebugSession(
			'startup-disposal', { resolved: { type: 'startup-disposal', request: 'launch', name: 'Startup Disposal' }, unresolved: undefined }, undefined, model, undefined,
			service, undefined!, undefined!, new TestConfigurationService({ debug: { console: { collapseIdenticalLines: true } } }), undefined!, new TestContextService(),
			TestProductService, undefined!, undefined!, mockUriIdentityService, instantiationService, undefined!, undefined!, new NullLogService(), undefined!, undefined!, new TestAccessibilityService()
		));
		model.addSession(session);
		let ended = 0;
		store.add(session.onDidEndAdapter(() => ended++));
		return { session, debuggerInfo, entered, ready, requests, observe: () => ({ ended, state: session.state, hasRaw: session.raw !== undefined }) };
	}

	test('observes termination while startup is pending and does not initialize afterwards', async () => {
		const fixture = createSession();
		const startup = fixture.session.initialize(fixture.debuggerInfo).then(() => 'started', error => isCancellationError(error) ? 'cancelled' : String(error));
		try {
			await fixture.entered.p;
			await fixture.session.terminate();
			fixture.ready.complete();
			const result = await startup;
			assert.deepStrictEqual({ result, ...fixture.observe(), initializedRequests: fixture.requests.filter(command => command === 'initialize').length }, { result: 'cancelled', ended: 1, state: State.Inactive, hasRaw: false, initializedRequests: 0 });
		} finally {
			fixture.ready.complete();
			await startup;
			await fixture.session.terminate();
		}
	});

	test('initializes a live adapter and observes its normal termination', async () => {
		const fixture = createSession();
		try {
			fixture.ready.complete();
			await fixture.session.initialize(fixture.debuggerInfo);
			assert.deepStrictEqual({ ...fixture.observe(), requests: fixture.requests }, { ended: 0, state: State.Running, hasRaw: true, requests: ['initialize'] });
			await fixture.session.terminate();
			assert.deepStrictEqual(fixture.observe(), { ended: 1, state: State.Inactive, hasRaw: false });
		} finally {
			await fixture.session.terminate();
		}
	});
});
