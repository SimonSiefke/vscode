/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../base/common/async.js';
import { DebounceEmitter, Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore, Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { IMenu, IMenuActionOptions, IMenuChangeEvent, IMenuCreateOptions, IMenuItem, IMenuItemHide, IMenuRegistryChangeEvent, IMenuService, isIMenuItem, isISubmenuItem, ISubmenuItem, MenuId, MenuItemAction, MenuRegistry, SubmenuItemAction } from './actions.js';
import { ICommandAction, ILocalizedString } from '../../action/common/action.js';
import { ICommandService } from '../../commands/common/commands.js';
import { ContextKeyExpression, IContextKeyChangeEvent, IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IAction, Separator } from '../../../base/common/actions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { removeFastWithoutKeepingOrder } from '../../../base/common/arrays.js';
import { localize } from '../../../nls.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';

export class MenuService extends Disposable implements IMenuService {

	declare readonly _serviceBrand: undefined;

	private readonly _hiddenStates: PersistedMenuHideState;

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		this._hiddenStates = this._register(new PersistedMenuHideState(storageService));
	}

	createMenu(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuCreateOptions): IMenu {
		return new MenuImpl(id, this._hiddenStates, { emitEventsForSubmenuChanges: false, eventDebounceDelay: 50, ...options }, this._commandService, this._keybindingService, contextKeyService);
	}

	getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuActionOptions): [string, Array<MenuItemAction | SubmenuItemAction>][] {
		const menu = new MenuImpl(id, this._hiddenStates, { emitEventsForSubmenuChanges: false, eventDebounceDelay: 50, ...options }, this._commandService, this._keybindingService, contextKeyService);
		const actions = menu.getActions(options);
		menu.dispose();
		return actions;
	}

	getMenuContexts(id: MenuId): ReadonlySet<string> {
		const menuInfo = new MenuInfoSnapshot(id, false);
		return new Set<string>([...menuInfo.structureContextKeys, ...menuInfo.preconditionContextKeys, ...menuInfo.toggledContextKeys]);
	}

	resetHiddenStates(ids?: MenuId[]): void {
		this._hiddenStates.reset(ids);
	}
}

class PersistedMenuHideState implements IDisposable {

	private static readonly _key = 'menu.hiddenCommands';

	private readonly _disposables = new DisposableStore();
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _ignoreChangeEvent: boolean = false;
	private _data: Record<string, string[] | undefined>;

	private _hiddenByDefaultCache = new Map<string, boolean>();

	constructor(@IStorageService private readonly _storageService: IStorageService) {
		try {
			const raw = _storageService.get(PersistedMenuHideState._key, StorageScope.PROFILE, '{}');
			this._data = JSON.parse(raw);
		} catch (err) {
			this._data = Object.create(null);
		}

		this._disposables.add(_storageService.onDidChangeValue(StorageScope.PROFILE, PersistedMenuHideState._key, this._disposables)(() => {
			if (!this._ignoreChangeEvent) {
				try {
					const raw = _storageService.get(PersistedMenuHideState._key, StorageScope.PROFILE, '{}');
					this._data = JSON.parse(raw);
				} catch (err) {
					console.log('FAILED to read storage after UPDATE', err);
				}
			}
			this._onDidChange.fire();
		}));
	}

	dispose() {
		this._onDidChange.dispose();
		this._disposables.dispose();
	}

	private _isHiddenByDefault(menu: MenuId, commandId: string) {
		return this._hiddenByDefaultCache.get(`${menu.id}/${commandId}`) ?? false;
	}

	setDefaultState(menu: MenuId, commandId: string, hidden: boolean): void {
		this._hiddenByDefaultCache.set(`${menu.id}/${commandId}`, hidden);
	}

	isHidden(menu: MenuId, commandId: string): boolean {
		const hiddenByDefault = this._isHiddenByDefault(menu, commandId);
		const state = this._data[menu.id]?.includes(commandId) ?? false;
		return hiddenByDefault ? !state : state;
	}

	updateHidden(menu: MenuId, commandId: string, hidden: boolean): void {
		const hiddenByDefault = this._isHiddenByDefault(menu, commandId);
		if (hiddenByDefault) {
			hidden = !hidden;
		}
		const entries = this._data[menu.id];
		if (!hidden) {
			// remove and cleanup
			if (entries) {
				const idx = entries.indexOf(commandId);
				if (idx >= 0) {
					removeFastWithoutKeepingOrder(entries, idx);
				}
				if (entries.length === 0) {
					delete this._data[menu.id];
				}
			}
		} else {
			// add unless already added
			if (!entries) {
				this._data[menu.id] = [commandId];
			} else {
				const idx = entries.indexOf(commandId);
				if (idx < 0) {
					entries.push(commandId);
				}
			}
		}
		this._persist();
	}

	reset(menus?: MenuId[]): void {
		if (menus === undefined) {
			// reset all
			this._data = Object.create(null);
			this._persist();
		} else {
			// reset only for a specific menu
			for (const { id } of menus) {
				if (this._data[id]) {
					delete this._data[id];
				}
			}
			this._persist();
		}
	}

	private _persist(): void {
		try {
			this._ignoreChangeEvent = true;
			const raw = JSON.stringify(this._data);
			this._storageService.store(PersistedMenuHideState._key, raw, StorageScope.PROFILE, StorageTarget.USER);
		} finally {
			this._ignoreChangeEvent = false;
		}
	}
}

class HideMenuAction implements IAction {
	readonly tooltip = '';
	readonly class = undefined;
	readonly enabled = true;

	constructor(
		readonly id: string,
		public label: string,
		private readonly menu: MenuId,
		private readonly commandId: string,
		private readonly states: PersistedMenuHideState,
	) { }

	run(): void {
		this.states.updateHidden(this.menu, this.commandId, true);
	}
}

class ToggleMenuAction implements IAction {
	readonly tooltip = '';
	readonly class = undefined;
	readonly enabled = true;

	constructor(
		readonly id: string,
		public label: string,
		private readonly menu: MenuId,
		private readonly commandId: string,
		private readonly states: PersistedMenuHideState,
	) { }

	get checked(): boolean {
		return !this.states.isHidden(this.menu, this.commandId);
	}

	run(): void {
		this.states.updateHidden(this.menu, this.commandId, this.checked);
	}
}

class ConfigureKeybindingAction implements IAction {
	readonly tooltip = '';
	readonly class = undefined;

	constructor(
		readonly id: string,
		public label: string,
		readonly enabled: boolean,
		private readonly commandService: ICommandService,
		private readonly keybindingService: IKeybindingService,
		private readonly commandId: string,
		private readonly when: ContextKeyExpression | undefined,
	) { }

	run(): void {
		const hasKeybinding = !!this.keybindingService.lookupKeybinding(this.commandId);
		const whenValue = !hasKeybinding && this.when ? this.when.serialize() : undefined;
		this.commandService.executeCommand('workbench.action.openGlobalKeybindings', `@command:${this.commandId}` + (whenValue ? ` +when:${whenValue}` : ''));
	}
}

class MenuItemHideActions implements IMenuItemHide {
	constructor(
		readonly hide: IAction,
		readonly toggle: IAction,
	) { }

	get isHidden(): boolean {
		return !this.toggle.checked;
	}
}

type MenuItemGroup = [string, Array<IMenuItem | ISubmenuItem>];

class MenuInfoSnapshot {
	protected _menuGroups: MenuItemGroup[] = [];
	private _allMenuIds: Set<MenuId> = new Set();
	private _structureContextKeys: Set<string> = new Set();
	private _preconditionContextKeys: Set<string> = new Set();
	private _toggledContextKeys: Set<string> = new Set();

	constructor(
		protected readonly _id: MenuId,
		protected readonly _collectContextKeysForSubmenus: boolean,
	) {
		MenuInfoSnapshot.prototype.refresh.call(this);
	}

	get allMenuIds(): ReadonlySet<MenuId> {
		return this._allMenuIds;
	}

	get structureContextKeys(): ReadonlySet<string> {
		return this._structureContextKeys;
	}

	get preconditionContextKeys(): ReadonlySet<string> {
		return this._preconditionContextKeys;
	}

	get toggledContextKeys(): ReadonlySet<string> {
		return this._toggledContextKeys;
	}

	refresh(): void {

		// reset
		this._menuGroups.length = 0;
		this._allMenuIds.clear();
		this._structureContextKeys.clear();
		this._preconditionContextKeys.clear();
		this._toggledContextKeys.clear();

		const menuItems = this._sort(MenuRegistry.getMenuItems(this._id));
		let group: MenuItemGroup | undefined;

		for (const item of menuItems) {
			// group by groupId
			const groupName = item.group || '';
			if (!group || group[0] !== groupName) {
				group = [groupName, []];
				this._menuGroups.push(group);
			}
			group[1].push(item);

			// keep keys and submenu ids for eventing
			this._collectContextKeysAndSubmenuIds(item);
		}
		this._allMenuIds.add(this._id);
	}

	protected _sort(menuItems: (IMenuItem | ISubmenuItem)[]) {
		// no sorting needed in snapshot
		return menuItems;
	}

	private _collectContextKeysAndSubmenuIds(item: IMenuItem | ISubmenuItem): void {

		MenuInfoSnapshot._fillInKbExprKeys(item.when, this._structureContextKeys);

		if (isIMenuItem(item)) {
			// keep precondition keys for event if applicable
			if (item.command.precondition) {
				MenuInfoSnapshot._fillInKbExprKeys(item.command.precondition, this._preconditionContextKeys);
			}
			// keep toggled keys for event if applicable
			if (item.command.toggled) {
				const toggledExpression: ContextKeyExpression = (item.command.toggled as { condition: ContextKeyExpression }).condition || item.command.toggled;
				MenuInfoSnapshot._fillInKbExprKeys(toggledExpression, this._toggledContextKeys);
			}

		} else if (this._collectContextKeysForSubmenus) {
			// recursively collect context keys from submenus so that this
			// menu fires events when context key changes affect submenus
			MenuRegistry.getMenuItems(item.submenu).forEach(this._collectContextKeysAndSubmenuIds, this);

			this._allMenuIds.add(item.submenu);
		}
	}

	private static _fillInKbExprKeys(exp: ContextKeyExpression | undefined, set: Set<string>): void {
		if (exp) {
			for (const key of exp.keys()) {
				set.add(key);
			}
		}
	}

}

class MenuInfo extends MenuInfoSnapshot {

	private readonly _menuHideCache = new Map<string, IMenuItemHide>();
	private readonly _menuKeybindingCache = new Map<string, IAction>();
	private readonly _submenuInfoCache = new Map<string, MenuInfo>();

	constructor(
		_id: MenuId,
		private readonly _hiddenStates: PersistedMenuHideState,
		_collectContextKeysForSubmenus: boolean,
		@ICommandService private readonly _commandService: ICommandService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService
	) {
		super(_id, _collectContextKeysForSubmenus);
		this.refresh();
	}

	override refresh(): void {
		this._menuHideCache.clear();
		this._menuKeybindingCache.clear();
		this._submenuInfoCache.clear();
		super.refresh();
	}

	createActionGroups(options: IMenuActionOptions | undefined): [string, Array<MenuItemAction | SubmenuItemAction>][] {
		const result: [string, Array<MenuItemAction | SubmenuItemAction>][] = [];

		for (const group of this._menuGroups) {
			const [id, items] = group;

			let activeActions: Array<MenuItemAction | SubmenuItemAction> | undefined;
			for (const item of items) {
				if (this._contextKeyService.contextMatchesRules(item.when)) {
					const isMenuItem = isIMenuItem(item);
					if (isMenuItem) {
						this._hiddenStates.setDefaultState(this._id, item.command.id, !!item.isHiddenByDefault);
					}

					const menuHide = this.getOrCreateMenuHide(isMenuItem ? item.command : item);
					if (isMenuItem) {
						// MenuItemAction
						const menuKeybinding = this.getOrCreateConfigureKeybindingAction(item.command.id, item.when);
						(activeActions ??= []).push(new MenuItemAction(item.command, item.alt, options, menuHide, menuKeybinding, this._contextKeyService, this._commandService));
					} else {
						// SubmenuItemAction
						const groups = this.getOrCreateSubmenuInfo(item.submenu).createActionGroups(options);
						const submenuActions = Separator.join(...groups.map(g => g[1]));
						if (submenuActions.length > 0) {
							(activeActions ??= []).push(new SubmenuItemAction(item, menuHide, submenuActions));
						}
					}
				}
			}
			if (activeActions && activeActions.length > 0) {
				result.push([id, activeActions]);
			}
		}
		return result;
	}

	private getOrCreateMenuHide(command: ICommandAction | ISubmenuItem): IMenuItemHide {
		const id = isISubmenuItem(command) ? command.submenu.id : command.id;
		let menuHide = this._menuHideCache.get(id);
		if (!menuHide) {
			menuHide = createMenuHide(this._id, command, this._hiddenStates);
			this._menuHideCache.set(id, menuHide);
		}
		return menuHide;
	}

	private getOrCreateConfigureKeybindingAction(commandId: string, when: ContextKeyExpression | undefined): IAction {
		const key = `${commandId}/${when?.serialize() ?? ''}`;
		let action = this._menuKeybindingCache.get(key);
		if (!action) {
			action = createConfigureKeybindingAction(this._commandService, this._keybindingService, commandId, when);
			this._menuKeybindingCache.set(key, action);
		}
		return action;
	}

	private getOrCreateSubmenuInfo(submenu: MenuId): MenuInfo {
		let submenuInfo = this._submenuInfoCache.get(submenu.id);
		if (!submenuInfo) {
			submenuInfo = new MenuInfo(submenu, this._hiddenStates, this._collectContextKeysForSubmenus, this._commandService, this._keybindingService, this._contextKeyService);
			this._submenuInfoCache.set(submenu.id, submenuInfo);
		}
		return submenuInfo;
	}

	protected override _sort(menuItems: (IMenuItem | ISubmenuItem)[]): (IMenuItem | ISubmenuItem)[] {
		return menuItems.sort(MenuInfo._compareMenuItems);
	}

	private static _compareMenuItems(a: IMenuItem | ISubmenuItem, b: IMenuItem | ISubmenuItem): number {

		const aGroup = a.group;
		const bGroup = b.group;

		if (aGroup !== bGroup) {

			// Falsy groups come last
			if (!aGroup) {
				return 1;
			} else if (!bGroup) {
				return -1;
			}

			// 'navigation' group comes first
			if (aGroup === 'navigation') {
				return -1;
			} else if (bGroup === 'navigation') {
				return 1;
			}

			// lexical sort for groups
			const value = aGroup.localeCompare(bGroup);
			if (value !== 0) {
				return value;
			}
		}

		// sort on priority - default is 0
		const aPrio = a.order || 0;
		const bPrio = b.order || 0;
		if (aPrio < bPrio) {
			return -1;
		} else if (aPrio > bPrio) {
			return 1;
		}

		// sort on titles
		return MenuInfo._compareTitles(
			isIMenuItem(a) ? a.command.title : a.title,
			isIMenuItem(b) ? b.command.title : b.title
		);
	}

	private static _compareTitles(a: string | ILocalizedString, b: string | ILocalizedString) {
		const aStr = typeof a === 'string' ? a : a.original;
		const bStr = typeof b === 'string' ? b : b.original;
		return aStr.localeCompare(bStr);
	}
}

class MenuImpl implements IMenu {

	private readonly _menuInfo: MenuInfo;
	private readonly _disposables = new DisposableStore();
	private readonly _lazyListener = new DisposableStore();
	private readonly _rebuildMenuSoon: RunOnceScheduler;

	private readonly _onDidChange: Emitter<IMenuChangeEvent>;
	readonly onDidChange: Event<IMenuChangeEvent>;

	constructor(
		id: MenuId,
		private readonly hiddenStates: PersistedMenuHideState,
		options: Required<IMenuCreateOptions>,
		@ICommandService commandService: ICommandService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		this._menuInfo = new MenuInfo(id, hiddenStates, options.emitEventsForSubmenuChanges, commandService, keybindingService, contextKeyService);

		// Rebuild this menu whenever the menu registry reports an event for this MenuId.
		// This usually happen while code and extensions are loaded and affects the over
		// structure of the menu
		this._rebuildMenuSoon = new RunOnceScheduler(() => {
			this._menuInfo.refresh();
			this._onDidChange.fire({ menu: this, isStructuralChange: true, isEnablementChange: true, isToggleChange: true });
		}, options.eventDebounceDelay);
		this._disposables.add(this._rebuildMenuSoon);
		this._disposables.add(MenuRegistry.onDidChangeMenu(this.onDidChangeMenuRegistry, this));

		// When context keys or storage state changes we need to check if the menu also has changed. However,
		// we only do that when someone listens on this menu because (1) these events are
		// firing often and (2) menu are often leaked
		this._disposables.add(this._lazyListener);

		this._onDidChange = new DebounceEmitter({
			// start/stop context key listener
			onWillAddFirstListener: () => this.startLazyListener(),
			onDidRemoveLastListener: () => this._lazyListener.clear(),
			delay: options.eventDebounceDelay,
			merge: events => this.mergeEvents(events)
		});
		this.onDidChange = this._onDidChange.event;
	}

	private mergeEvents(events: IMenuChangeEvent[]): IMenuChangeEvent {

		let isStructuralChange = false;
		let isEnablementChange = false;
		let isToggleChange = false;

		for (const item of events) {
			isStructuralChange = isStructuralChange || item.isStructuralChange;
			isEnablementChange = isEnablementChange || item.isEnablementChange;
			isToggleChange = isToggleChange || item.isToggleChange;
			if (isStructuralChange && isEnablementChange && isToggleChange) {
				break;
			}
		}

		return { menu: this, isStructuralChange, isEnablementChange, isToggleChange };
	}

	private startLazyListener(): void {
		this._lazyListener.add(this.contextKeyService.onDidChangeContext(this.onDidChangeContext, this));
		this._lazyListener.add(this.hiddenStates.onDidChange(this.onDidChangeHiddenStates, this));
	}

	private onDidChangeMenuRegistry(e: IMenuRegistryChangeEvent): void {
		for (const id of this._menuInfo.allMenuIds) {
			if (e.has(id)) {
				this._rebuildMenuSoon.schedule();
				break;
			}
		}
	}

	private onDidChangeContext(e: IContextKeyChangeEvent): void {
		const isStructuralChange = e.affectsSome(this._menuInfo.structureContextKeys);
		const isEnablementChange = e.affectsSome(this._menuInfo.preconditionContextKeys);
		const isToggleChange = e.affectsSome(this._menuInfo.toggledContextKeys);
		if (isStructuralChange || isEnablementChange || isToggleChange) {
			this._onDidChange.fire({ menu: this, isStructuralChange, isEnablementChange, isToggleChange });
		}
	}

	private onDidChangeHiddenStates(): void {
		this._onDidChange.fire({ menu: this, isStructuralChange: true, isEnablementChange: false, isToggleChange: false });
	}

	getActions(options?: IMenuActionOptions | undefined): [string, (MenuItemAction | SubmenuItemAction)[]][] {
		return this._menuInfo.createActionGroups(options);
	}

	dispose(): void {
		this._disposables.dispose();
		this._onDidChange.dispose();
	}
}

function createMenuHide(menu: MenuId, command: ICommandAction | ISubmenuItem, states: PersistedMenuHideState): IMenuItemHide {

	const id = isISubmenuItem(command) ? command.submenu.id : command.id;
	const title = typeof command.title === 'string' ? command.title : command.title.value;

	const hide = new HideMenuAction(`hide/${menu.id}/${id}`, localize('hide.label', 'Hide \'{0}\'', title), menu, id, states);
	const toggle = new ToggleMenuAction(`toggle/${menu.id}/${id}`, title, menu, id, states);

	return new MenuItemHideActions(hide, toggle);
}

export function createConfigureKeybindingAction(commandService: ICommandService, keybindingService: IKeybindingService, commandId: string, when: ContextKeyExpression | undefined = undefined, enabled = true): IAction {
	return new ConfigureKeybindingAction(
		`configureKeybinding/${commandId}`,
		localize('configure keybinding', "Configure Keybinding"),
		enabled,
		commandService,
		keybindingService,
		commandId,
		when,
	);
}
