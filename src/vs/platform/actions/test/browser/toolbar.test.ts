/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../base/browser/dom.js';
import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { ActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction, Separator, toAction } from '../../../../base/common/actions.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IContextMenuMenuDelegate, IContextMenuService } from '../../../contextview/browser/contextView.js';
import { ICommandService } from '../../../commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { IKeybindingService } from '../../../keybinding/common/keybinding.js';
import { MockContextKeyService, MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { TestTelemetryService } from '../../../telemetry/test/common/testTelemetryService.js';
import { NullActionViewItemService } from '../../browser/actionViewItemService.js';
import { HiddenItemStrategy, IWorkbenchToolBarOptions, MenuWorkbenchToolBar, WorkbenchToolBar } from '../../browser/toolbar.js';
import { IMenuItemHide, IMenuService, MenuId, MenuItemAction, MenuRegistry, SubmenuItemAction } from '../../common/actions.js';
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

class TestWorkbenchToolBar extends WorkbenchToolBar {
	async runAction(action: IAction): Promise<void> {
		await this.actionBar.actionRunner.run(action);
	}
}

suite('WorkbenchToolBar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createToolBar(telemetryService: ITelemetryService, options: IWorkbenchToolBarOptions, onContextMenu?: (delegate: IContextMenuDelegate) => void): TestWorkbenchToolBar {
		const toolBar = new TestWorkbenchToolBar(
			$('div'),
			options,
			new class extends mock<IMenuService>() { }(),
			new class extends mock<IContextKeyService>() { }(),
			new class extends mock<IContextMenuService>() {
				override showContextMenu(delegate: IContextMenuDelegate): void { onContextMenu?.(delegate); }
			}(),
			new class extends mock<IKeybindingService>() {
				override lookupKeybinding() { return undefined; }
			}(),
			new class extends mock<ICommandService>() { }(),
			telemetryService
		);
		return disposables.add(toolBar);
	}

	test('logs telemetry before an action disposes the toolbar', async () => {
		const telemetryService = new TestTelemetryService();
		const toolBar = createToolBar(telemetryService, { telemetrySource: 'testToolBar' });
		let eventsDuringRun: readonly { readonly name: string; readonly data: unknown }[] = [];
		const selfDisposingAction = toAction({
			id: 'selfDisposing',
			label: 'selfDisposing',
			run: () => {
				eventsDuringRun = telemetryService.events.slice();
				toolBar.dispose();
			}
		});
		toolBar.setActions([selfDisposingAction]);

		await toolBar.runAction(selfDisposingAction);

		const expectedEvents = [{
			name: 'workbenchActionExecuted',
			data: { id: 'selfDisposing', from: 'testToolBar' }
		}];
		assert.deepStrictEqual({
			eventsDuringRun,
			eventsAfterRun: telemetryService.events
		}, {
			eventsDuringRun: expectedEvents,
			eventsAfterRun: expectedEvents
		});
	});

	suite('Reset Menu', () => {

		const resetMenuId = new MenuId('WorkbenchToolBarResetMenuTest');

		function createHide(state: { isHidden: boolean; isModifiedFromDefault: boolean }): IMenuItemHide {
			return {
				hide: toAction({ id: 'hide', label: 'Hide', run() { } }),
				toggle: toAction({ id: 'toggle', label: 'Toggle', checked: !state.isHidden, run() { } }),
				isHidden: state.isHidden,
				isModifiedFromDefault: state.isModifiedFromDefault
			};
		}

		function getContextMenuActionIds(items: readonly IMenuItemHide[]): { actionIds: string[]; resetCalls: (readonly MenuId[])[] } {
			let shownActions: readonly IAction[] = [];
			const resetCalls: (readonly MenuId[])[] = [];
			const contextKeyService = new class extends mock<IContextKeyService>() {
				override contextMatchesRules() { return true; }
			}();
			const toolBar = disposables.add(new TestWorkbenchToolBar(
				$('div'),
				{ resetMenu: resetMenuId },
				new class extends mock<IMenuService>() {
					override resetHiddenStates(ids?: readonly MenuId[]): void { resetCalls.push(ids!); }
				}(),
				contextKeyService,
				new class extends mock<IContextMenuService>() {
					override showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void { shownActions = delegate.getActions?.() ?? []; }
				}(),
				new class extends mock<IKeybindingService>() {
					override lookupKeybinding() { return undefined; }
				}(),
				new class extends mock<ICommandService>() { }(),
				new TestTelemetryService()
			));
			const actions = items.map((hide, i) => new MenuItemAction({ id: `cmd${i}`, title: `Command ${i}` }, undefined, undefined, hide, undefined, contextKeyService, new class extends mock<ICommandService>() { }()));
			toolBar.setActions(actions);
			const target = toolBar.getElement().querySelector('.action-item');
			assert.ok(target);
			target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			const resetAction = shownActions.find(a => a.id === 'resetThisMenu');
			resetAction?.run();
			return { actionIds: shownActions.map(a => a.id), resetCalls };
		}

		test('shows Reset Menu when a hidden-by-default item is made visible', () => {
			const result = getContextMenuActionIds([createHide({ isHidden: false, isModifiedFromDefault: true })]);
			assert.deepStrictEqual({ hasReset: result.actionIds.includes('resetThisMenu'), resetCalls: result.resetCalls }, { hasReset: true, resetCalls: [[resetMenuId]] });
		});

		test('shows Reset Menu when a visible-by-default item is hidden', () => {
			const result = getContextMenuActionIds([
				createHide({ isHidden: true, isModifiedFromDefault: true }),
				createHide({ isHidden: false, isModifiedFromDefault: false })
			]);
			assert.strictEqual(result.actionIds.includes('resetThisMenu'), true);
		});

		test('does not show Reset Menu when hidden items are hidden by default', () => {
			const result = getContextMenuActionIds([
				createHide({ isHidden: true, isModifiedFromDefault: false }),
				createHide({ isHidden: false, isModifiedFromDefault: false })
			]);
			assert.strictEqual(result.actionIds.includes('resetThisMenu'), false);
		});
	});

	test('items that always show cannot be hidden, and list the items that can be', () => {
		const hidden = new Set(['optional2']);
		const createHideActions = (id: string): IMenuItemHide => ({
			get isHidden() { return hidden.has(id); },
			get isModifiedFromDefault() { return hidden.has(id); },
			hide: toAction({ id: `hide/${id}`, label: `Hide ${id}`, run: () => { hidden.add(id); } }),
			toggle: toAction({ id: `toggle/${id}`, label: id, checked: !hidden.has(id), run: () => { } }),
		});
		const createAction = (id: string) => new MenuItemAction({ id, title: id }, undefined, undefined, createHideActions(id), undefined, new class extends mock<IContextKeyService>() { }(), new class extends mock<ICommandService>() { }());
		// A submenu, which has no Configure Keybinding action: its context menu has only the items that can be hidden.
		const fixed = new SubmenuItemAction({ title: 'fixed', submenu: MenuId.CommandPalette }, createHideActions('fixed'), [toAction({ id: 'child', label: 'child', run: () => { } })]);
		let contextMenuActions: readonly string[] = [];
		const toolBar = createToolBar(new TestTelemetryService(), { hiddenItemStrategy: HiddenItemStrategy.Ignore, alwaysShownItems: [MenuId.CommandPalette.id], resetMenu: MenuId.ViewTitle }, delegate => {
			contextMenuActions = delegate.getActions().map(action => action instanceof Separator ? '---' : `${action.label}${action.checked ? ' (checked)' : ''}`);
		});
		toolBar.setActions([fixed, createAction('optional1'), createAction('optional2')]);
		const shown = [0, 1].map(index => toolBar.getItemAction(index)?.label);

		const rightClick = (index: number) => {
			toolBar.getItemElement(index)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
			return contextMenuActions;
		};

		assert.deepStrictEqual({ shown, onFixed: rightClick(0), onFixedAgain: rightClick(0), onOptional: rightClick(1) }, {
			shown: ['fixed', 'optional1'],
			onFixed: ['optional1 (checked)', 'optional2', '---', 'Reset Menu'],
			onFixedAgain: ['optional1 (checked)', 'optional2', '---', 'Reset Menu'],
			// The last optional item can be hidden, as the item that always shows remains.
			onOptional: ['Configure Keybinding', 'Hide optional1', '---', 'optional1 (checked)', 'optional2', '---', 'Reset Menu'],
		});
	});

	test('items that always show ignore a hidden state stored for them', () => {
		const hidden = new Set(['fixed', 'optional2']);
		const createHideActions = (id: string): IMenuItemHide => ({
			get isHidden() { return hidden.has(id); },
			get isModifiedFromDefault() { return hidden.has(id); },
			hide: toAction({ id: `hide/${id}`, label: `Hide ${id}`, run: () => { hidden.add(id); } }),
			toggle: toAction({ id: `toggle/${id}`, label: id, checked: !hidden.has(id), run: () => { } }),
		});
		const createAction = (id: string) => new MenuItemAction({ id, title: id }, undefined, undefined, createHideActions(id), undefined, new class extends mock<IContextKeyService>() { }(), new class extends mock<ICommandService>() { }());
		let contextMenuActions: readonly string[] = [];
		const toolBar = createToolBar(new TestTelemetryService(), { hiddenItemStrategy: HiddenItemStrategy.Ignore, alwaysShownItems: ['fixed'] }, delegate => {
			contextMenuActions = delegate.getActions().map(action => action instanceof Separator ? '---' : `${action.label}${action.checked ? ' (checked)' : ''}`);
		});
		toolBar.setActions([createAction('fixed'), createAction('optional1'), createAction('optional2')]);
		toolBar.getItemElement(1)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

		assert.deepStrictEqual({ shown: [0, 1, 2].map(index => toolBar.getItemAction(index)?.label), contextMenu: contextMenuActions }, {
			shown: ['fixed', 'optional1', undefined],
			contextMenu: ['Configure Keybinding', 'Hide optional1', '---', 'optional1 (checked)', 'optional2'],
		});
	});

	test('the last optional item can be hidden next to an item that always shows and has no hide actions', () => {
		const hidden = new Set(['optional2']);
		const createHideActions = (id: string): IMenuItemHide => ({
			get isHidden() { return hidden.has(id); },
			get isModifiedFromDefault() { return hidden.has(id); },
			hide: toAction({ id: `hide/${id}`, label: `Hide ${id}`, run: () => { hidden.add(id); } }),
			toggle: toAction({ id: `toggle/${id}`, label: id, checked: !hidden.has(id), run: () => { } }),
		});
		const createAction = (id: string) => new MenuItemAction({ id, title: id }, undefined, undefined, createHideActions(id), undefined, new class extends mock<IContextKeyService>() { }(), new class extends mock<ICommandService>() { }());
		const fixed = toAction({ id: 'fixed', label: 'fixed', run: () => { } });
		let contextMenuActions: readonly string[] = [];
		const toolBar = createToolBar(new TestTelemetryService(), { hiddenItemStrategy: HiddenItemStrategy.Ignore, alwaysShownItems: ['fixed'] }, delegate => {
			contextMenuActions = delegate.getActions().map(action => action instanceof Separator ? '---' : `${action.label}${action.checked ? ' (checked)' : ''}${action.enabled ? '' : ' (disabled)'}`);
		});
		toolBar.setActions([fixed, createAction('optional1'), createAction('optional2')]);
		toolBar.getItemElement(1)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

		assert.deepStrictEqual({ shown: [0, 1].map(index => toolBar.getItemAction(index)?.label), contextMenu: contextMenuActions }, {
			shown: ['fixed', 'optional1'],
			contextMenu: ['Configure Keybinding (disabled)', 'Hide optional1', '---', 'optional1 (checked)', 'optional2'],
		});
	});
});
