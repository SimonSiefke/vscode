/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IContextMenuDelegate, IContextMenuProvider } from '../../../../browser/contextmenu.js';
import { $ } from '../../../../browser/dom.js';
import { contextViewMenuCloseAnimation, CONTEXT_VIEW_MENU_MOTION_CLASS, IContextViewCloseAnimation } from '../../../../browser/ui/contextview/contextview.js';
import { DropdownMenuActionViewItem } from '../../../../browser/ui/dropdown/dropdownActionViewItem.js';
import { Action } from '../../../../common/actions.js';
import { ThemeIcon } from '../../../../common/themables.js';
import { DropdownMenu } from '../../../../browser/ui/dropdown/dropdown.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('DropdownMenu', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('rendering accepts cached icon classes without changing them', () => {
		const classes = ThemeIcon.asClassNameArray({ id: 'check' });
		const action = disposables.add(new Action('test', 'Test'));
		const item = disposables.add(new DropdownMenuActionViewItem(action, { getActions: () => [] }, { showContextMenu: () => { } }, { classNames: classes }));
		const container = $('div');
		item.render(container);
		assert.deepStrictEqual([...classes], ['codicon', 'codicon-check']);
	});

	test('applies menu motion by default and preserves overrides', () => {
		const delegates: IContextMenuDelegate[] = [];
		const contextMenuProvider: IContextMenuProvider = {
			showContextMenu: delegate => delegates.push(delegate)
		};
		const customCloseAnimation: IContextViewCloseAnimation = {
			className: 'custom-closing',
			duration: 42
		};

		const defaultContainer = $('.default');
		disposables.add(toDisposable(() => defaultContainer.remove()));
		disposables.add(new DropdownMenu(defaultContainer, {
			contextMenuProvider,
			actions: [],
			menuClassName: 'custom-menu'
		})).show();

		const overriddenContainer = $('.overridden');
		disposables.add(toDisposable(() => overriddenContainer.remove()));
		disposables.add(new DropdownMenu(overriddenContainer, {
			contextMenuProvider,
			actions: [],
			menuClassName: CONTEXT_VIEW_MENU_MOTION_CLASS,
			closeAnimation: customCloseAnimation
		})).show();

		assert.deepStrictEqual(delegates.map(delegate => ({
			menuClassName: delegate.getMenuClassName?.(),
			closeAnimation: delegate.closeAnimation
		})), [{
			menuClassName: `custom-menu ${CONTEXT_VIEW_MENU_MOTION_CLASS}`,
			closeAnimation: contextViewMenuCloseAnimation
		}, {
			menuClassName: CONTEXT_VIEW_MENU_MOTION_CLASS,
			closeAnimation: customCloseAnimation
		}]);
	});
});
