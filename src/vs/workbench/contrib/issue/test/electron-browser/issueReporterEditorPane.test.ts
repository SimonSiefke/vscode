/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import '../../../../../platform/theme/common/colorUtils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { _util } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IssueReporterEditorInput } from '../../browser/issueReporterEditorInput.js';
import { IssueReporterController } from '../../electron-browser/issueReporterController.js';

suite('IssueReporterController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	for (const cancel of [false, true]) {
		test(`closing an input during lazy wizard initialization does not reopen it (cancel=${cancel})`, async () => {
			const instantiationService = disposables.add(new TestInstantiationService());
			for (const { id } of _util.getServiceDependencies(IssueReporterController)) {
				instantiationService.stub(id, {});
			}
			let reveals = 0;
			const controller = disposables.add(instantiationService.createInstance(IssueReporterController, document.createElement('div'), {
				reveal: async () => { reveals++; },
				close: () => { },
			}));
			const input = disposables.add(new IssueReporterEditorInput({
				styles: {}, zoomLevel: 0, enabledExtensions: [], restrictedMode: false,
				isInstallationPure: true, isSessionsWindow: false, githubAccessToken: '',
			}, 'detailed', new class extends mock<IDialogService>() { }()));
			const cancellation = disposables.add(new CancellationTokenSource());
			const pending = controller.setInput(input, cancellation.token);
			assert.strictEqual(controller.getInput(), input);
			if (cancel) {
				cancellation.cancel();
			} else {
				input.dispose();
			}
			await pending;
			await controller.revealAndActivate();
			assert.strictEqual(controller.getWizard(), undefined);
			assert.strictEqual(controller.getInput(), undefined);
			assert.strictEqual(reveals, 0);
		});
	}
});
