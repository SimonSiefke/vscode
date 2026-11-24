/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ActivityBarPositionAction, ActivityBarSizeAction, SidebarLayoutAction, ToggleMenuBarVisibilityAction } from '../../../browser/parts/activitybar/activitybarPart.js';
import { AuxiliaryBarCommandAction, AuxiliaryBarConfigurationAction } from '../../../browser/parts/auxiliarybar/auxiliaryBarPart.js';
import { CompositeBarAction, CompositeConfigureKeybindingAction } from '../../../browser/parts/compositeBarActions.js';
import { PanelCommandAction, PanelConfigurationAction } from '../../../browser/parts/panel/panelPart.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ActivityBarPosition, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import { MockKeybindingService } from '../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('Context menu replacement actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('propagates configuration and command failures from panel actions', async () => {
		const failure = new Error('action failed');
		const configurationService = { updateValue: () => Promise.reject(failure) } as unknown as IConfigurationService;
		const commandService = { executeCommand: () => Promise.reject(failure) } as unknown as ICommandService;

		await assert.rejects(new PanelConfigurationAction('labels', 'Labels', configurationService, true).run(), failure);
		await assert.rejects(new PanelCommandAction('hide-panel', 'Hide Panel', commandService).run(), failure);
	});

	test('propagates configuration and command failures from activity and auxiliary bar actions', async () => {
		const failure = new Error('action failed');
		const configurationService = { updateValue: () => Promise.reject(failure) } as unknown as IConfigurationService;
		const commandService = { executeCommand: () => Promise.reject(failure) } as unknown as ICommandService;
		const instantiationService = {
			invokeFunction: () => Promise.reject(failure),
		} as unknown as IInstantiationService;
		const actionFactory = () => ({ run: () => undefined });

		await assert.rejects(new ActivityBarPositionAction('position', 'Position', false, configurationService, ActivityBarPosition.DEFAULT).run(), failure);
		await assert.rejects(new ToggleMenuBarVisibilityAction('menu', 'Menu', false, configurationService, 'toggle').run(), failure);
		await assert.rejects(new ActivityBarSizeAction('size', 'Size', false, configurationService, false).run(), failure);
		await assert.rejects(new SidebarLayoutAction('layout', 'Layout', instantiationService, actionFactory).run() as Promise<unknown>, failure);
		await assert.rejects(new AuxiliaryBarConfigurationAction('labels', 'Labels', true, configurationService, LayoutSettings.ACTIVITY_BAR_COMPACT, true).run(), failure);
		await assert.rejects(new AuxiliaryBarCommandAction('hide', 'Hide', commandService).run(), failure);
	});

	test('refreshes the composite keybinding action when the item changes', () => {
		const compositeAction = store.add(new CompositeBarAction({ id: 'view', name: 'View', keybindingId: 'command.old' }));
		const keybindingAction = store.add(new CompositeConfigureKeybindingAction(compositeAction, {} as ICommandService, new MockKeybindingService()));
		assert.strictEqual(keybindingAction.action?.id, 'configureKeybinding/command.old');

		compositeAction.compositeBarActionItem = { id: 'view', name: 'View', keybindingId: 'command.new' };
		assert.strictEqual(keybindingAction.action?.id, 'configureKeybinding/command.new');

		compositeAction.compositeBarActionItem = { id: 'view', name: 'View' };
		assert.strictEqual(keybindingAction.action, undefined);
	});
});
