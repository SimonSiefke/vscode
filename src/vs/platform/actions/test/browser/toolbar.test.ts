/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../base/browser/dom.js';
import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { ActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction, toAction } from '../../../../base/common/actions.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IContextMenuService } from '../../../contextview/browser/contextView.js';
import { ICommandService } from '../../../commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { IKeybindingService } from '../../../keybinding/common/keybinding.js';
import { MockContextKeyService, MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { NullTelemetryService, NullTelemetryServiceShape } from '../../../telemetry/common/telemetryUtils.js';
import { NullActionViewItemService } from '../../browser/actionViewItemService.js';
import { HiddenItemStrategy, IWorkbenchToolBarOptions, MenuWorkbenchToolBar, WorkbenchToolBar } from '../../browser/toolbar.js';
import { IMenuService, MenuId, MenuItemAction, MenuRegistry } from '../../common/actions.js';
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

class TestTelemetryService extends NullTelemetryServiceShape {
	readonly events: { readonly name: string; readonly data: unknown }[] = [];

	override publicLog2(eventName?: string, data?: unknown): void {
		if (eventName) {
			this.events.push({ name: eventName, data });
		}
	}
}

class TestWorkbenchToolBar extends WorkbenchToolBar {
	async runAction(action: IAction): Promise<void> {
		await this.actionBar.actionRunner.run(action);
	}
}

suite('WorkbenchToolBar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createToolBar(telemetryService: ITelemetryService, options: IWorkbenchToolBarOptions): TestWorkbenchToolBar {
		const toolBar = new TestWorkbenchToolBar(
			$('div'),
			options,
			new class extends mock<IMenuService>() { }(),
			new class extends mock<IContextKeyService>() { }(),
			new class extends mock<IContextMenuService>() {
				override showContextMenu(): void { }
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
});
