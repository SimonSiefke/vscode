/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CodeEditorWidget } from '../../../../browser/widget/codeEditor/codeEditorWidget.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { createCodeEditorServices } from '../../../../test/browser/testCodeEditor.js';
import { FindController, FindStartFocusAction } from '../../browser/findController.js';

suite('FindWidget layout', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the Find input visible and hit-testable above the editor', async () => {
		const container = document.createElement('div');
		container.classList.add('monaco-reduce-motion');
		container.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; height: 300px;';
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const services = new ServiceCollection(
			[IStorageService, disposables.add(new InMemoryStorageService())],
			[IContextViewService, new class extends mock<IContextViewService>() { }()],
		);
		const instantiationService = createCodeEditorServices(disposables, services);
		const editor = disposables.add(instantiationService.createInstance(CodeEditorWidget, container, {
			minimap: { enabled: true },
		}, { contributions: [] }));
		editor.setModel(disposables.add(createTextModel('hello world')));
		const find = disposables.add(instantiationService.createInstance(FindController, editor));
		await find.start({
			forceRevealReplace: false,
			seedSearchStringFromSelection: 'none',
			seedSearchStringFromNonEmptySelection: false,
			seedSearchStringFromGlobalClipboard: false,
			shouldFocus: FindStartFocusAction.FocusFindInput,
			shouldAnimate: false,
			updateSearchScope: false,
			loop: false,
		});
		await timeout(0);
		editor.render(true);
		const input = container.querySelector<HTMLElement>('.find-widget .input');
		assert.ok(input);
		const bounds = input.getBoundingClientRect();
		assert.ok(bounds.width > 0 && bounds.height > 0);
		assert.strictEqual(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2), input);
		assert.strictEqual(document.activeElement, input);
	});
});
