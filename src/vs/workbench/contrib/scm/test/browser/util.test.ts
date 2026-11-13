/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { MenuId, MenuItemAction, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../../platform/actions/common/menuService.js';
import { NullCommandService } from '../../../../../platform/commands/test/common/nullCommandService.js';
import { MockContextKeyService, MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { connectPrimaryMenu } from '../../browser/util.js';

suite('SCM connectPrimaryMenu', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => sinon.restore());

	for (const isHiddenByDefault of [false, true]) {
		test(`reports visibility changes with hidden by default = ${isHiddenByDefault}`, async () => {
			const clock = sinon.useFakeTimers();
			const menuId = new MenuId(`scm/visibility/${generateUuid()}`);
			disposables.add(MenuRegistry.appendMenuItem(menuId, {
				command: { id: 'scm.test', title: 'SCM Test' }, group: 'navigation', isHiddenByDefault
			}));
			await clock.tickAsync(100);
			const service = disposables.add(new MenuService(NullCommandService, new MockKeybindingService(), disposables.add(new InMemoryStorageService())));
			const context = disposables.add(new class extends MockContextKeyService {
				override contextMatchesRules(): boolean { return true; }
			}());
			const menu = disposables.add(service.createMenu(menuId, context, { eventDebounceDelay: 0 }));
			const visibility: boolean[] = [];
			const actions: MenuItemAction[] = [];
			disposables.add(connectPrimaryMenu(menu, primary => {
				assert.strictEqual(primary.length, 1);
				const action = primary[0];
				assert.ok(action instanceof MenuItemAction);
				actions.push(action);
				visibility.push(action.hideActions!.isHidden);
			}));

			// No helper has been read when the first visibility snapshot is taken.
			const first = actions[0];
			if (isHiddenByDefault) {
				await first.hideActions!.toggle.run();
			} else {
				await first.hideActions!.hide.run();
			}
			await clock.tickAsync(100);
			assert.strictEqual(first.hideActions!.isHidden, isHiddenByDefault);
			service.resetHiddenStates([menuId]);
			await clock.tickAsync(100);

			assert.deepStrictEqual(visibility, [isHiddenByDefault, !isHiddenByDefault, isHiddenByDefault]);
			// An unchanged menu must not trigger another toolbar update.
			service.resetHiddenStates([menuId]);
			await clock.tickAsync(100);
			assert.strictEqual(visibility.length, 3);
		});
	}
});
