/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../common/actions.js';
import { MenuService } from '../../common/menuService.js';
import { NullCommandService } from '../../../commands/test/common/nullCommandService.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyChangeEvent, IReadableSet } from '../../../contextkey/common/contextkey.js';
import { MockContextKeyService, MockKeybindingService } from '../../../keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService } from '../../../storage/common/storage.js';

// --- service instances

const contextKeyService = new class extends MockContextKeyService {
	override contextMatchesRules() {
		return true;
	}
};

class TestContextKeyService extends MockContextKeyService {

	private readonly _onDidChangeContext = new Emitter<IContextKeyChangeEvent>();
	private readonly _values = new Map<string, unknown>();

	override get onDidChangeContext() {
		return this._onDidChangeContext.event;
	}

	override contextMatchesRules(rules: ContextKeyExpression | undefined): boolean {
		return !rules || rules.evaluate({ getValue: <T>(key: string): T | undefined => this._values.get(key) as T | undefined });
	}

	setContext(key: string, value: unknown): void {
		this._values.set(key, value);
		this._onDidChangeContext.fire({
			affectsSome: (keys: IReadableSet<string>) => keys.has(key),
			allKeysContainedIn: (keys: IReadableSet<string>) => keys.has(key)
		});
	}

	override dispose(): void {
		this._onDidChangeContext.dispose();
	}
}

// --- tests

suite('MenuService', function () {

	let menuService: MenuService;
	const disposables = new DisposableStore();
	let testMenuId: MenuId;

	setup(function () {
		menuService = new MenuService(NullCommandService, new MockKeybindingService(), new InMemoryStorageService());
		testMenuId = new MenuId(`testo/${generateUuid()}`);
		disposables.clear();
	});

	teardown(function () {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('group sorting', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'one', title: 'FOO' },
			group: '0_hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'two', title: 'FOO' },
			group: 'hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'three', title: 'FOO' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'four', title: 'FOO' },
			group: ''
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'five', title: 'FOO' },
			group: 'navigation'
		}));

		const groups = disposables.add(menuService.createMenu(testMenuId, contextKeyService)).getActions();

		assert.strictEqual(groups.length, 5);
		const [one, two, three, four, five] = groups;

		assert.strictEqual(one[0], 'navigation');
		assert.strictEqual(two[0], '0_hello');
		assert.strictEqual(three[0], 'hello');
		assert.strictEqual(four[0], 'Hello');
		assert.strictEqual(five[0], '');
	});

	test('in group sorting, by title', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'Hello'
		}));

		const groups = disposables.add(menuService.createMenu(testMenuId, contextKeyService)).getActions();

		assert.strictEqual(groups.length, 1);
		const [, actions] = groups[0];

		assert.strictEqual(actions.length, 3);
		const [one, two, three] = actions;
		assert.strictEqual(one.id, 'a');
		assert.strictEqual(two.id, 'b');
		assert.strictEqual(three.id, 'c');
	});

	test('in group sorting, by title and order', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'Hello',
			order: 10
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'Hello',
			order: -1
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'd', title: 'yyy' },
			group: 'Hello',
			order: -1
		}));

		const groups = disposables.add(menuService.createMenu(testMenuId, contextKeyService)).getActions();

		assert.strictEqual(groups.length, 1);
		const [, actions] = groups[0];

		assert.strictEqual(actions.length, 4);
		const [one, two, three, four] = actions;
		assert.strictEqual(one.id, 'd');
		assert.strictEqual(two.id, 'c');
		assert.strictEqual(three.id, 'b');
		assert.strictEqual(four.id, 'a');
	});


	test('in group sorting, special: navigation', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'navigation',
			order: 1.3
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'navigation',
			order: 1.2
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'navigation',
			order: 1.1
		}));

		const groups = disposables.add(menuService.createMenu(testMenuId, contextKeyService)).getActions();

		assert.strictEqual(groups.length, 1);
		const [[, actions]] = groups;

		assert.strictEqual(actions.length, 3);
		const [one, two, three] = actions;
		assert.strictEqual(one.id, 'c');
		assert.strictEqual(two.id, 'b');
		assert.strictEqual(three.id, 'a');
	});

	test('special MenuId palette', function () {

		disposables.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id: 'a', title: 'Explicit' }
		}));

		disposables.add(MenuRegistry.addCommand({ id: 'b', title: 'Implicit' }));

		let foundA = false;
		let foundB = false;
		for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (isIMenuItem(item)) {
				if (item.command.id === 'a') {
					assert.strictEqual(item.command.title, 'Explicit');
					foundA = true;
				}
				if (item.command.id === 'b') {
					assert.strictEqual(item.command.title, 'Implicit');
					foundB = true;
				}
			}
		}
		assert.strictEqual(foundA, true);
		assert.strictEqual(foundB, true);
	});

	test('caches actions while listening and invalidates on context change', function () {
		const contextKeyService = disposables.add(new TestContextKeyService());
		contextKeyService.setContext('testEnabled', false);

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa', precondition: ContextKeyExpr.has('testEnabled') },
			group: 'navigation'
		}));

		const menu = disposables.add(menuService.createMenu(testMenuId, contextKeyService));
		disposables.add(menu.onDidChange(() => undefined));

		const first = menu.getActions()[0][1][0];
		const second = menu.getActions()[0][1][0];
		assert.strictEqual(first, second);
		assert.strictEqual(first.enabled, false);

		contextKeyService.setContext('testEnabled', true);

		const third = menu.getActions()[0][1][0];
		assert.notStrictEqual(third, first);
		assert.strictEqual(third.enabled, true);
	});

	test('does not cache actions without a change listener', function () {
		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'navigation'
		}));

		const menu = disposables.add(menuService.createMenu(testMenuId, contextKeyService));

		const first = menu.getActions()[0][1][0];
		const second = menu.getActions()[0][1][0];
		assert.notStrictEqual(first, second);
	});

	test('Extension contributed submenus missing with errors in output #155030', function () {

		const id = generateUuid();
		const menu = new MenuId(id);

		assert.throws(() => new MenuId(id));
		assert.ok(menu === MenuId.for(id));
	});
});
