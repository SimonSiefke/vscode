/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { ChatMultiDiffContentPart } from '../../../../browser/widget/chatContentParts/chatMultiDiffContentPart.js';
import type { IChatResponseViewModel } from '../../../../common/model/chatViewModel.js';
import '../../../../browser/widget/media/chat.css';

suite('ChatMultiDiffContentPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('preserves summary viewport styling when the list is rendered', () => {
		const container = $('.interactive-session');
		container.style.setProperty('--vscode-cornerRadius-small', '7px');
		mainWindow.document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const instantiationService = workbenchInstantiationService(undefined, store);
		const part = store.add(instantiationService.createInstance(ChatMultiDiffContentPart, {
			kind: 'multiDiffData',
			readOnly: true,
			multiDiffData: { title: 'Changes', resources: [{ modifiedUri: URI.file('/test/file.ts') }] }
		}, upcastPartial<IChatResponseViewModel>({ sessionResource: URI.parse('vscode-local-chat:/test') })));
		container.appendChild(part.domNode);
		const viewport = part.domNode.querySelector<HTMLElement>('.chat-summary-list .monaco-scrollable-element');
		assert.ok(viewport);
		assert.strictEqual(mainWindow.getComputedStyle(viewport).borderTopLeftRadius, '7px');
	});
});
