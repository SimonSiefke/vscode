/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { IconLabel } from '../../../../../base/browser/ui/iconLabel/iconLabel.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import '../../browser/media/scm.css';

suite('SCM history load more styles', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('centers icon-enabled load more labels without highlight options', () => {
		const root = $('.scm-history-view');
		root.style.cssText = 'position: fixed; top: 0; left: 0; width: 200px; --vscode-textLink-foreground: #123456;';
		mainWindow.document.body.appendChild(root);
		disposables.add(toDisposable(() => root.remove()));
		const placeholder = append(append(root, $('.history-item-load-more')), $('.history-item-placeholder'));
		const label = disposables.add(new IconLabel(placeholder, { supportIcons: true, highlightedLabelClassName: 'scm-history-placeholder-highlighted-label' }));
		const styles = ['$(fold-down) Load More', '$(loading~spin) Loading More'].map(value => {
			label.setLabel(value);
			const highlighted = label.element.querySelector('.monaco-highlighted-label');
			assert.ok(highlighted);
			const style = mainWindow.getComputedStyle(highlighted);
			return [style.display, style.alignItems, style.justifyContent, style.color];
		});
		assert.deepStrictEqual(styles, Array(2).fill(['flex', 'center', 'center', 'rgb(18, 52, 86)']));
	});
});
