/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { registerWindow } from '../../../../../base/browser/dom.js';
import { ensureCodeWindow, mainWindow } from '../../../../../base/browser/window.js';
import { Barrier, DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfirmationResult, IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IWorkbenchLayoutService } from '../../../layout/browser/layoutService.js';
import { AuxiliaryWindow } from '../../browser/auxiliaryWindowService.js';

suite('AuxiliaryWindow', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createWindow() {
		const frame = mainWindow.document.createElement('iframe');
		mainWindow.document.body.appendChild(frame);
		disposables.add(toDisposable(() => frame.remove()));
		const target = frame.contentWindow;
		assert.ok(target);
		ensureCodeWindow(target, 999);
		disposables.add(registerWindow(target));
		const container = target.document.body;

		const dialogOpened = new DeferredPromise<void>();
		const dialogResult = new DeferredPromise<IConfirmationResult>();
		const dialogService = new class extends TestDialogService {
			override async confirm(): Promise<IConfirmationResult> {
				await dialogOpened.complete();
				return dialogResult.p;
			}
		}();
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(IDialogService, dialogService);
		instantiationService.stub(IConfigurationService, new TestConfigurationService({ window: { confirmBeforeClose: 'always' } }));
		instantiationService.stub(IWorkbenchLayoutService, { getContainer: () => container });
		const stylesLoaded = new Barrier();
		stylesLoaded.open();

		return {
			target,
			dialogOpened,
			dialogResult,
			window: disposables.add(instantiationService.createInstance(AuxiliaryWindow, target, container, stylesLoaded))
		};
	}

	test('silent veto skips the normal preflight confirmation dialog', async () => {
		const { window, dialogOpened, dialogResult } = createWindow();
		await dialogResult.complete({ confirmed: true });
		disposables.add(window.onBeforeUnload(event => event.vetoSilently()));

		assert.deepStrictEqual({
			confirmed: await window.confirmClose(),
			openedDialog: dialogOpened.isSettled
		}, { confirmed: false, openedDialog: false });
	});

	test('silent veto after preflight reports a canceled unload from close', async () => {
		const { target, window, dialogResult } = createWindow();
		await dialogResult.complete({ confirmed: true });
		assert.strictEqual(await window.confirmClose(), true);
		disposables.add(window.onBeforeUnload(event => event.vetoSilently()));

		const event = new target.Event('beforeunload', { cancelable: true });
		let unloadCount = 0;
		disposables.add(window.onUnload(() => unloadCount++));
		const close = sinon.stub(target, 'close').callsFake(() => {
			target.dispatchEvent(event);
			if (!event.defaultPrevented) {
				target.dispatchEvent(new target.Event('unload'));
			}
		});
		try {
			assert.deepStrictEqual({ closed: await window.close(), prevented: event.defaultPrevented, unloadCount }, {
				closed: false, prevented: true, unloadCount: 0
			});
		} finally {
			close.restore();
		}
	});

	test('silent veto installed during confirmation cancels the close', async () => {
		const { window, dialogOpened, dialogResult } = createWindow();
		const confirmed = window.confirmClose();
		await dialogOpened.p;
		disposables.add(window.onBeforeUnload(event => event.vetoSilently()));
		await dialogResult.complete({ confirmed: true });

		assert.strictEqual(await confirmed, false);
	});
});
