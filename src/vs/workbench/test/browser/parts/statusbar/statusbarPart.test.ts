/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { TestColorTheme, TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { TestContextService, TestStorageService } from '../../../common/workbenchTestServices.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MainStatusbarPart } from '../../../../browser/parts/statusbar/statusbarPart.js';
import { LayoutSettings } from '../../../../services/layout/browser/layoutService.js';
import { TestContextMenuService, TestHostService, TestLayoutService, workbenchInstantiationService } from '../../workbenchTestServices.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { STATUS_BAR_BACKGROUND, STATUS_BAR_INACTIVE_BACKGROUND, STATUS_BAR_NO_FOLDER_BACKGROUND } from '../../../../common/theme.js';
import { WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { Emitter } from '../../../../../base/common/event.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IManagedHoverOptions } from '../../../../../base/browser/ui/hover/hover.js';
import { $ } from '../../../../../base/browser/dom.js';
import { StatusbarEntryItem } from '../../../../browser/parts/statusbar/statusbarItem.js';
import { ShowTooltipCommand, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';

suite('StatusbarPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createItemsTestPart(configurationService: TestConfigurationService): { part: MainStatusbarPart; container: HTMLElement; entryDisposables: DisposableStore } {
		const entryDisposables = store.add(new DisposableStore());
		const instantiationService = store.add(workbenchInstantiationService(undefined, store));
		instantiationService.stub(IConfigurationService, configurationService);
		const part = store.add(new MainStatusbarPart(
			instantiationService, new TestThemeService(), new TestContextService(), store.add(new TestStorageService()),
			new TestLayoutService(), new TestContextMenuService(), store.add(new ContextKeyService(configurationService)),
			configurationService, new TestHostService(),
		));
		const container = document.createElement('div');
		return { part, container, entryDisposables };
	}

	function itemIds(container: HTMLElement): { left: string[]; right: string[] } {
		return {
			left: Array.from(container.querySelectorAll('.left-items > .statusbar-item'), item => item.id),
			right: Array.from(container.querySelectorAll('.right-items > .statusbar-item'), item => item.id).reverse(),
		};
	}

	test('live item locations apply before creation and preserve entry accessors and visibility', async () => {
		const configurationService = new TestConfigurationService({ 'workbench.statusBar.items': { left: ['encoding'], right: ['branch'] } });
		const { part, container, entryDisposables } = createItemsTestPart(configurationService);
		const branch = entryDisposables.add(part.addEntry({ name: 'Branch', text: 'main', ariaLabel: 'Branch' }, 'branch', StatusbarAlignment.LEFT, 100));
		entryDisposables.add(part.addEntry({ name: 'Encoding', text: 'UTF-8', ariaLabel: 'Encoding' }, 'encoding', StatusbarAlignment.RIGHT, 100));
		entryDisposables.add(part.addEntry({ name: 'Position', text: 'Ln 1', ariaLabel: 'Position' }, 'position', StatusbarAlignment.RIGHT, 50));
		part.updateEntryVisibility('encoding', false);
		part.create(container);
		const initial = itemIds(container);
		const originalBranch = container.querySelector('#branch');

		await configurationService.setUserConfiguration('workbench.statusBar.items', { left: ['position', 'branch'], right: ['encoding'] });
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		branch.update({ name: 'Branch', text: 'feature', ariaLabel: 'Branch' });
		const updated = itemIds(container);
		const sameNode = originalBranch === container.querySelector('#branch');
		const updatedText = container.querySelector('#branch')?.textContent;
		const encodingHidden = !part.isEntryVisible('encoding');

		await configurationService.setUserConfiguration('workbench.statusBar.items', undefined);
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		const restored = itemIds(container);
		branch.dispose();
		assert.deepStrictEqual({ initial, updated, sameNode, updatedText, encodingHidden, restored, afterDispose: itemIds(container) }, {
			initial: { left: ['encoding'], right: ['branch', 'position'] },
			updated: { left: ['position', 'branch'], right: ['encoding'] },
			sameNode: true, updatedText: 'feature', encodingHidden: true,
			restored: { left: ['branch'], right: ['encoding', 'position'] },
			afterDispose: { left: [], right: ['encoding', 'position'] },
		});
	});

	test('configuration changes before creation affect pending and late entries', async () => {
		const configurationService = new TestConfigurationService();
		const { part, container, entryDisposables } = createItemsTestPart(configurationService);
		entryDisposables.add(part.addEntry({ name: 'First', text: 'First', ariaLabel: 'First' }, 'first', StatusbarAlignment.LEFT));
		await configurationService.setUserConfiguration('workbench.statusBar.items', { right: ['late', 'first'] });
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		part.create(container);
		entryDisposables.add(part.addEntry({ name: 'Late', text: 'Late', ariaLabel: 'Late' }, 'late', StatusbarAlignment.LEFT));
		assert.deepStrictEqual(itemIds(container), { left: [], right: ['late', 'first'] });
	});

	test('custom locations stop compact styling when entries are separated', async () => {
		const configurationService = new TestConfigurationService();
		const { part, container, entryDisposables } = createItemsTestPart(configurationService);
		part.create(container);
		entryDisposables.add(part.addEntry({ name: 'Reference', text: 'Reference', ariaLabel: 'Reference' }, 'reference', StatusbarAlignment.LEFT, 100));
		entryDisposables.add(part.addEntry({ name: 'Relative', text: 'Relative', ariaLabel: 'Relative' }, 'relative', StatusbarAlignment.LEFT, { location: { id: 'reference', priority: 100 }, alignment: StatusbarAlignment.RIGHT, compact: true }));
		const initiallyCompact = container.querySelector('#relative')?.classList.contains('compact-left');
		await configurationService.setUserConfiguration('workbench.statusBar.items', { right: ['relative'] });
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		assert.deepStrictEqual({ initiallyCompact, nowCompact: container.querySelector('#relative')?.classList.contains('compact-left'), locations: itemIds(container) }, {
			initiallyCompact: true, nowCompact: false, locations: { left: ['reference'], right: ['relative'] },
		});
	});

	test('custom locations preserve default compact SCM chains', async () => {
		const configurationService = new TestConfigurationService();
		const { part, container, entryDisposables } = createItemsTestPart(configurationService);
		part.create(container);
		for (let i = 0; i < 3; i++) {
			entryDisposables.add(part.addEntry({ name: 'SCM', text: String(i), ariaLabel: 'SCM' }, `status.scm.${i}`, StatusbarAlignment.LEFT, i === 0 ? 100 : {
				location: { id: `status.scm.${i - 1}`, priority: 100 }, alignment: StatusbarAlignment.RIGHT, compact: true,
			}));
		}
		const compactClasses = () => Array.from(container.querySelectorAll('[id^="status.scm."]'), item => ({
			id: item.id, left: item.classList.contains('compact-left'), right: item.classList.contains('compact-right'),
		})).sort((a, b) => a.id.localeCompare(b.id));
		const defaults = compactClasses();
		assert.deepStrictEqual(defaults, [
			{ id: 'status.scm.0', left: false, right: true },
			{ id: 'status.scm.1', left: true, right: true },
			{ id: 'status.scm.2', left: true, right: false },
		]);
		entryDisposables.add(part.addEntry({ name: 'Other', text: 'Other', ariaLabel: 'Other' }, 'other', StatusbarAlignment.RIGHT));
		await configurationService.setUserConfiguration('workbench.statusBar.items', { left: ['other'] });
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		assert.deepStrictEqual(compactClasses(), defaults);
		await configurationService.setUserConfiguration('workbench.statusBar.items', { right: ['status.scm.1'] });
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		assert.ok(compactClasses().every(item => !item.left && !item.right));
		await configurationService.setUserConfiguration('workbench.statusBar.items', {});
		fireConfigChange(configurationService, 'workbench.statusBar.items');
		assert.deepStrictEqual(compactClasses(), defaults);
	});

	test('repeated live location changes preserve keyboard focus and DOM entries', async () => {
		const configurationService = new TestConfigurationService();
		const { part, container, entryDisposables } = createItemsTestPart(configurationService);
		document.body.appendChild(container);
		try {
			part.create(container);
			entryDisposables.add(part.addEntry({ name: 'First', text: 'First', ariaLabel: 'First', command: 'first.command' }, 'first', StatusbarAlignment.LEFT));
			entryDisposables.add(part.addEntry({ name: 'Second', text: 'Second', ariaLabel: 'Second', command: 'second.command' }, 'second', StatusbarAlignment.RIGHT));
			const first = container.querySelector<HTMLElement>('#first .statusbar-item-label')!;
			const second = container.querySelector<HTMLElement>('#second .statusbar-item-label')!;
			first.focus();
			for (let i = 0; i < 37; i++) {
				await configurationService.setUserConfiguration('workbench.statusBar.items', { left: ['second'], right: ['first'] });
				fireConfigChange(configurationService, 'workbench.statusBar.items');
				assert.strictEqual(document.activeElement, first);
				await configurationService.setUserConfiguration('workbench.statusBar.items', {});
				fireConfigChange(configurationService, 'workbench.statusBar.items');
			}
			await configurationService.setUserConfiguration('workbench.statusBar.items', { left: ['second'], right: ['first'] });
			fireConfigChange(configurationService, 'workbench.statusBar.items');
			part.focusPreviousEntry();
			assert.deepStrictEqual({ focused: document.activeElement === second, count: container.querySelectorAll('.statusbar-item').length, locations: itemIds(container) }, {
				focused: true, count: 2, locations: { left: ['second'], right: ['first'] },
			});
		} finally {
			container.remove();
		}
	});

	test('forwards tooltip onDidShow through native status entry updates', () => {
		const instantiationService = store.add(workbenchInstantiationService(undefined, store));
		let options: IManagedHoverOptions | undefined;
		instantiationService.stub(IHoverService, {
			setupManagedHover: (_delegate, _target, _content, initialOptions) => {
				options = initialOptions;
				return { dispose() { }, show() { }, hide() { }, update: (_content, updatedOptions) => { options = updatedOptions; } };
			},
		});
		const onDidShow = () => { };
		const entry = { name: 'Status', text: '$(copilot)', ariaLabel: 'Status', command: ShowTooltipCommand };
		const item = store.add(instantiationService.createInstance(StatusbarEntryItem, $('div'), {
			...entry, tooltip: { content: 'Sale', commands: [], onDidShow },
		}, { delay: 0, showHover: () => undefined }));
		const callback = options?.onDidShow;
		item.update({ ...entry, tooltip: 'Normal status' });
		assert.deepStrictEqual({ callback, restoredOptions: options }, { callback: onDidShow, restoredOptions: undefined });
	});

	class TestMainStatusbarPart extends MainStatusbarPart {
		updateStylesCalls = 0;
		windowHasFocus = true;

		protected override hasWindowFocus(): boolean {
			return this.windowHasFocus;
		}

		override updateStyles(): void {
			this.updateStylesCalls++;
			super.updateStyles();
		}
	}

	class TestFloatingPanelsLayoutService extends TestLayoutService {
		floatingPanelsEnabled = false;
		modernUICompact = false;

		override isFloatingPanelsEnabled(): boolean {
			return this.floatingPanelsEnabled;
		}

		override isModernUICompact(): boolean {
			return this.modernUICompact;
		}
	}

	function fireConfigChange(configurationService: TestConfigurationService, key: string): void {
		configurationService.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.DEFAULT,
			affectedKeys: new Set([key]),
			change: { keys: [key], overrides: [] },
			affectsConfiguration: candidate => candidate === key,
		});
	}

	function createFocusTestPart(hostService: TestHostService, windowHasFocus: boolean): { part: TestMainStatusbarPart; container: HTMLElement } {
		const configurationService = new TestConfigurationService();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IHoverService, new class extends mock<IHoverService>() { });
		const part = store.add(new TestMainStatusbarPart(
			instantiationService,
			new TestThemeService(new TestColorTheme({
				[STATUS_BAR_BACKGROUND]: '#111111',
				[STATUS_BAR_INACTIVE_BACKGROUND]: '#222222',
			})),
			new TestContextService(),
			store.add(new TestStorageService()),
			new TestLayoutService(),
			new TestContextMenuService(),
			store.add(new ContextKeyService(configurationService)),
			configurationService,
			hostService,
		));
		part.windowHasFocus = windowHasFocus;
		const container = document.createElement('div');
		part.create(container);
		return { part, container };
	}

	test('initializes the inactive background before receiving focus events', () => {
		const hostService = new TestHostService();
		hostService.setFocus(false);
		const unfocusedHost = createFocusTestPart(hostService, false);
		const unfocusedWindow = createFocusTestPart(new TestHostService(), false);

		assert.deepStrictEqual({
			unfocusedHost: unfocusedHost.container.style.backgroundColor,
			unfocusedWindow: unfocusedWindow.container.style.backgroundColor,
		}, {
			unfocusedHost: 'rgb(34, 34, 34)',
			unfocusedWindow: 'rgb(34, 34, 34)',
		});
	});

	test('keeps window-specific backgrounds when the host regains focus', () => {
		const activeWindowEmitter = store.add(new Emitter<number>());
		const hostService = new class extends TestHostService {
			override readonly onDidChangeActiveWindow = activeWindowEmitter.event;
		}();
		const main = createFocusTestPart(hostService, true);
		const backgrounds = () => main.container.style.backgroundColor;
		const initially = backgrounds();

		hostService.setFocus(false);
		const blurred = backgrounds();
		hostService.setFocus(true);
		const returnedToMain = backgrounds();

		activeWindowEmitter.fire(mainWindow.vscodeWindowId + 1);
		const switchedToAuxiliary = backgrounds();
		hostService.setFocus(false);
		hostService.setFocus(true);
		const returnedToAuxiliary = backgrounds();
		activeWindowEmitter.fire(mainWindow.vscodeWindowId);
		const switchedBackToMain = backgrounds();

		assert.deepStrictEqual({ initially, blurred, returnedToMain, switchedToAuxiliary, returnedToAuxiliary, switchedBackToMain }, {
			initially: 'rgb(17, 17, 17)',
			blurred: 'rgb(34, 34, 34)',
			returnedToMain: 'rgb(17, 17, 17)',
			switchedToAuxiliary: 'rgb(34, 34, 34)',
			returnedToAuxiliary: 'rgb(34, 34, 34)',
			switchedBackToMain: 'rgb(17, 17, 17)',
		});
	});

	test('configuration changes update styles only after the part is created', () => {
		const configurationService = new TestConfigurationService();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IHoverService, new class extends mock<IHoverService>() { });
		const contextKeyService = store.add(new ContextKeyService(configurationService));
		const part = store.add(new TestMainStatusbarPart(
			instantiationService,
			new TestThemeService(),
			new TestContextService(),
			store.add(new TestStorageService()),
			new TestLayoutService(),
			new TestContextMenuService(),
			contextKeyService,
			configurationService,
			new TestHostService(),
		));

		fireConfigChange(configurationService, LayoutSettings.MODERN_UI);
		const beforeCreate = part.updateStylesCalls;
		part.create(document.createElement('div'));
		const afterCreate = part.updateStylesCalls;
		fireConfigChange(configurationService, 'unrelated.setting');
		const afterUnrelatedChange = part.updateStylesCalls;
		fireConfigChange(configurationService, LayoutSettings.MODERN_UI);

		assert.deepStrictEqual({
			beforeCreate,
			afterCreate,
			afterUnrelatedChange,
			afterModernUIChange: part.updateStylesCalls,
		}, {
			beforeCreate: 0,
			afterCreate: 1,
			afterUnrelatedChange: 1,
			afterModernUIChange: 2,
		});
	});

	test('modern UI reserves compact vertical status bar padding', () => {
		const configurationService = new TestConfigurationService();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IHoverService, new class extends mock<IHoverService>() { });
		const contextKeyService = store.add(new ContextKeyService(configurationService));
		const layoutService = new TestFloatingPanelsLayoutService();
		const part = store.add(new TestMainStatusbarPart(
			instantiationService,
			new TestThemeService(),
			new TestContextService(),
			store.add(new TestStorageService()),
			layoutService,
			new TestContextMenuService(),
			contextKeyService,
			configurationService,
			new TestHostService(),
		));

		const defaultConstraints = { minimumHeight: part.minimumHeight, maximumHeight: part.maximumHeight };
		layoutService.floatingPanelsEnabled = true;
		const modernUIConstraints = { minimumHeight: part.minimumHeight, maximumHeight: part.maximumHeight };
		layoutService.modernUICompact = true;
		const compactModernUIConstraints = { minimumHeight: part.minimumHeight, maximumHeight: part.maximumHeight };

		assert.deepStrictEqual({ defaultConstraints, modernUIConstraints, compactModernUIConstraints }, {
			defaultConstraints: { minimumHeight: 22, maximumHeight: 22 },
			modernUIConstraints: { minimumHeight: 28, maximumHeight: 28 },
			compactModernUIConstraints: { minimumHeight: 26, maximumHeight: 26 },
		});
	});

	test('uses the inactive background when the window loses focus', () => {
		const configurationService = new TestConfigurationService();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IHoverService, new class extends mock<IHoverService>() { });
		const contextKeyService = store.add(new ContextKeyService(configurationService));
		const hostService = new TestHostService();
		const themeService = new TestThemeService(new TestColorTheme({
			[STATUS_BAR_BACKGROUND]: '#111111',
			[STATUS_BAR_INACTIVE_BACKGROUND]: '#222222',
			[STATUS_BAR_NO_FOLDER_BACKGROUND]: '#333333',
		}));
		const part = store.add(new TestMainStatusbarPart(
			instantiationService,
			themeService,
			new TestContextService(),
			store.add(new TestStorageService()),
			new TestLayoutService(),
			new TestContextMenuService(),
			contextKeyService,
			configurationService,
			hostService,
		));
		const container = document.createElement('div');
		part.create(container);
		const activeBackground = container.style.backgroundColor;

		hostService.setFocus(false);
		const inactiveBackground = container.style.backgroundColor;

		hostService.setFocus(true);
		const restoredBackground = container.style.backgroundColor;

		themeService.setTheme(new TestColorTheme({
			[STATUS_BAR_BACKGROUND]: '#333333',
			[STATUS_BAR_NO_FOLDER_BACKGROUND]: '#444444',
		}));
		hostService.setFocus(false);
		const fallbackBackground = container.style.backgroundColor;

		assert.deepStrictEqual({ activeBackground, inactiveBackground, restoredBackground, fallbackBackground }, {
			activeBackground: 'rgb(17, 17, 17)',
			inactiveBackground: 'rgb(34, 34, 34)',
			restoredBackground: 'rgb(17, 17, 17)',
			fallbackBackground: 'rgb(51, 51, 51)',
		});
	});

	test('keeps state backgrounds when the window is inactive', () => {
		// Not imported from the debug contribution to avoid depending on a higher layer here.
		const debuggingBackground = 'statusBar.debuggingBackground';
		const theme = new TestColorTheme({
			[STATUS_BAR_BACKGROUND]: '#111111',
			[STATUS_BAR_INACTIVE_BACKGROUND]: '#222222',
			[STATUS_BAR_NO_FOLDER_BACKGROUND]: '#333333',
			[debuggingBackground]: '#444444',
		});

		function createPart(contextService: TestContextService): { container: HTMLElement; hostService: TestHostService; part: TestMainStatusbarPart } {
			const configurationService = new TestConfigurationService();
			const instantiationService = store.add(new TestInstantiationService());
			instantiationService.stub(IConfigurationService, configurationService);
			instantiationService.stub(IHoverService, new class extends mock<IHoverService>() { });
			const hostService = new TestHostService();
			const part = store.add(new TestMainStatusbarPart(
				instantiationService,
				new TestThemeService(theme),
				contextService,
				store.add(new TestStorageService()),
				new TestLayoutService(),
				new TestContextMenuService(),
				store.add(new ContextKeyService(configurationService)),
				configurationService,
				hostService,
			));
			const container = document.createElement('div');
			part.create(container);

			return { container, hostService, part };
		}

		// A style override (as the debugger registers) must survive losing focus.
		const debugging = createPart(new TestContextService());
		const debuggingOverride = debugging.part.overrideStyle({ priority: 10, background: debuggingBackground });
		debugging.hostService.setFocus(false);
		const whileDebugging = debugging.container.style.backgroundColor;
		debuggingOverride.dispose();

		// The no folder background communicates state too and must survive losing focus.
		const empty = createPart(new class extends TestContextService {
			override getWorkbenchState(): WorkbenchState { return WorkbenchState.EMPTY; }
		}());
		empty.hostService.setFocus(false);
		const whileEmpty = empty.container.style.backgroundColor;

		assert.deepStrictEqual({ whileDebugging, whileEmpty }, {
			whileDebugging: 'rgb(68, 68, 68)',
			whileEmpty: 'rgb(51, 51, 51)',
		});
	});
});
