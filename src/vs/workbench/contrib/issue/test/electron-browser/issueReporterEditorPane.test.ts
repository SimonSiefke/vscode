/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import '../../../../../platform/theme/common/colorUtils.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { _util } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import type { IUntypedEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IRecordingService, RecordingState } from '../../browser/recordingService.js';
import { IssueReporterEditorInput } from '../../browser/issueReporterEditorInput.js';
import { IssueReporterEditorPane } from '../../electron-browser/issueReporterEditorPane.js';

class TestIssueReporterEditorPane extends IssueReporterEditorPane {
	initialize(parent: HTMLElement): void {
		super.createEditor(parent);
	}
}

suite('IssueReporterEditorPane', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	for (const cancel of [false, true]) {
		test(`closing an input during lazy wizard initialization does not reopen it (cancel=${cancel})`, async () => {
			const instantiationService = disposables.add(new TestInstantiationService());
			for (const { id } of _util.getServiceDependencies(IssueReporterEditorPane as typeof IssueReporterEditorPane & _util.DI_TARGET_OBJ)) {
				instantiationService.stub(id, {});
			}
			instantiationService.stub(IThemeService, new TestThemeService());
			instantiationService.stub(IStorageService, disposables.add(new InMemoryStorageService()));
			instantiationService.stub(IRecordingService, { isSupported: false, state: RecordingState.Idle });
			const openedInputs: boolean[] = [];
			instantiationService.stub(IEditorService, {
				openEditor: async (input: EditorInput | IUntypedEditorInput) => { openedInputs.push(input instanceof EditorInput && input.isDisposed()); }
			});
			const group = new class extends mock<IEditorGroup>() { }();
			instantiationService.stub(IEditorGroupsService, { activateGroup: () => group });
			const pane = disposables.add(instantiationService.createInstance(TestIssueReporterEditorPane, group));
			pane.initialize(document.createElement('div'));
			const input = disposables.add(new IssueReporterEditorInput({
				styles: {}, zoomLevel: 0, enabledExtensions: [], restrictedMode: false,
				isInstallationPure: true, isSessionsWindow: false, githubAccessToken: '',
			}, new class extends mock<IDialogService>() { }()));
			const cancellation = disposables.add(new CancellationTokenSource());
			const pending = pane.setInput(input, undefined, {}, cancellation.token);
			await Promise.resolve();
			if (cancel) {
				cancellation.cancel();
			}
			pane.clearInput();
			input.dispose();
			await pending;
			await pane.revealAndActivate();
			assert.deepStrictEqual({ wizardCreated: !!pane.getWizard(), openedInputs }, { wizardCreated: false, openedInputs: [] });
		});
	}
});
