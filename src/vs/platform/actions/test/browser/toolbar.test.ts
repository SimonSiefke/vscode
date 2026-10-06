/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { ActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IContextMenuService } from '../../../contextview/browser/contextView.js';
import { ICommandService } from '../../../commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService, MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { NullActionViewItemService } from '../../browser/actionViewItemService.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../browser/toolbar.js';
import { MenuId, MenuItemAction, MenuRegistry } from '../../common/actions.js';
import { MenuService } from '../../common/menuService.js';

suite('MenuWorkbenchToolBar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('NoHide can configure an unbound command and preserves its when clause', async () => {
		const menuId = new MenuId('toolbar/noHide/unbound');
		disposables.add(MenuRegistry.appendMenuItem(menuId, {
			command: { id: 'test.unbound', title: 'Unbound' }, group: 'navigation', when: ContextKeyExpr.not('test.hidden')
		}));
		const context = disposables.add(new class extends MockContextKeyService {
			override contextMatchesRules(rules: ContextKeyExpression | undefined): boolean {
				return !rules || rules.evaluate({ getValue: key => this.getContextKeyValue(key) });
			}
		}());
		const keybindings = new MockKeybindingService();
		const commands: { id: string; args: readonly string[] }[] = [];
		const commandService = new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string, ...args: string[]): Promise<T> {
				commands.push({ id, args });
				return undefined as T;
			}
		}();
		const menuService = disposables.add(new MenuService(commandService, keybindings, disposables.add(new InMemoryStorageService())));
		let contextActions: readonly IAction[] = [];
		const contextMenu = new class extends mock<IContextMenuService>() {
			override showContextMenu(delegate: IContextMenuDelegate): void {
				contextActions = delegate.getActions();
			}
		}();
		const container = document.createElement('div');
		document.body.appendChild(container);
		try {
			const toolbar = disposables.add(new MenuWorkbenchToolBar(container, menuId, {
				hiddenItemStrategy: HiddenItemStrategy.NoHide,
				actionViewItemProvider: (action, options) => new ActionViewItem(undefined, action, options)
			}, menuService, context, contextMenu, keybindings, commandService, NullTelemetryService,
			new NullActionViewItemService(), disposables.add(new TestInstantiationService())));
			const action = toolbar.getItemAction(0);
			assert.ok(action instanceof MenuItemAction);
			const item = toolbar.getItemElement(0);
			assert.ok(item);
			item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
			await contextActions[0]?.run();
			assert.deepStrictEqual({
				hide: action.hideActions,
				contextActions: contextActions.map(action => ({ id: action.id, enabled: action.enabled })), commands
			}, {
				hide: undefined,
				contextActions: [{ id: 'configureKeybinding/test.unbound', enabled: true }],
				commands: [{ id: 'workbench.action.openGlobalKeybindings', args: ['@command:test.unbound +when:!test.hidden'] }]
			});
		} finally {
			container.remove();
		}
	});
});
