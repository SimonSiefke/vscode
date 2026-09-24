/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IExtensionService } from '../../common/extensions.js';
import { RestartExtensionHostAction } from '../../electron-browser/nativeExtensionService.js';

suite('NativeExtensionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('coalesces concurrent extension host restarts', async () => {
		const stop = new DeferredPromise<boolean>();
		const start = new DeferredPromise<void>();
		let stopCalls = 0;
		let startCalls = 0;
		const extensionService = new class extends mock<IExtensionService>() {
			override stopExtensionHosts(): Promise<boolean> {
				stopCalls++;
				return stop.p;
			}

			override startExtensionHosts(): Promise<void> {
				startCalls++;
				return start.p;
			}
		};
		const instantiationService = new TestInstantiationService();
		instantiationService.stub(IExtensionService, extensionService);
		const action = new RestartExtensionHostAction();

		const firstRestart = instantiationService.invokeFunction(accessor => action.run(accessor));
		const secondRestart = instantiationService.invokeFunction(accessor => action.run(accessor));
		assert.strictEqual(stopCalls, 1);

		stop.complete(true);
		await stop.p;
		assert.strictEqual(startCalls, 1);

		start.complete();
		await Promise.all([firstRestart, secondRestart]);

		await instantiationService.invokeFunction(accessor => action.run(accessor));
		assert.strictEqual(stopCalls, 2);
		assert.strictEqual(startCalls, 2);
	});
});
