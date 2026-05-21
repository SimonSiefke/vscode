/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { notStrictEqual, strictEqual } from 'assert';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { OPTIONS, parseArgs } from '../../../environment/node/argv.js';
import { NativeEnvironmentService } from '../../../environment/node/environmentService.js';
import { FileService } from '../../../files/common/fileService.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';
import { SaveStrategy, StateService } from '../../../state/node/stateService.js';
import { IS_NEW_KEY, StorageScope } from '../../common/storage.js';
import { IStorageChangeEvent, IStorageMain, IStorageMainOptions } from '../../electron-main/storageMain.js';
import { StorageMainService } from '../../electron-main/storageMainService.js';
import { currentSessionDateStorageKey, firstSessionDateStorageKey } from '../../../telemetry/common/telemetry.js';
import { UriIdentityService } from '../../../uriIdentity/common/uriIdentityService.js';
import { IUserDataProfile } from '../../../userDataProfile/common/userDataProfile.js';
import { UserDataProfilesMainService } from '../../../userDataProfile/electron-main/userDataProfile.js';
import { TestLifecycleMainService } from '../../../test/electron-main/workbenchTestServices.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IOpenConfiguration, IOpenEmptyConfiguration, IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';

suite('StorageMainService', function () {

	const disposables = new DisposableStore();

	const productService: IProductService = { _serviceBrand: undefined, ...product };

	const inMemoryProfileRoot = URI.file('/location').with({ scheme: Schemas.inMemory });
	const inMemoryProfile: IUserDataProfile = {
		id: 'id',
		name: 'inMemory',
		isDefault: false,
		location: inMemoryProfileRoot,
		globalStorageHome: joinPath(inMemoryProfileRoot, 'globalStorageHome'),
		settingsResource: joinPath(inMemoryProfileRoot, 'settingsResource'),
		keybindingsResource: joinPath(inMemoryProfileRoot, 'keybindingsResource'),
		tasksResource: joinPath(inMemoryProfileRoot, 'tasksResource'),
		mcpResource: joinPath(inMemoryProfileRoot, 'mcp.json'),
		snippetsHome: joinPath(inMemoryProfileRoot, 'snippetsHome'),
		promptsHome: joinPath(inMemoryProfileRoot, 'promptsHome'),
		extensionsResource: joinPath(inMemoryProfileRoot, 'extensionsResource'),
		cacheHome: joinPath(inMemoryProfileRoot, 'cache'),
		agentPluginsHome: joinPath(inMemoryProfileRoot, 'agentPluginsHome'),
	};

	class TestStorageMainService extends StorageMainService {

		protected override getStorageOptions(): IStorageMainOptions {
			return {
				useInMemoryStorage: true
			};
		}
	}

	class TestWindowsMainService implements IWindowsMainService {

		readonly _serviceBrand = undefined;

		readonly onDidChangeWindowsCount = Event.None;
		readonly onDidOpenWindow = Event.None;
		readonly onDidSignalReadyWindow = Event.None;
		readonly onDidMaximizeWindow = Event.None;
		readonly onDidUnmaximizeWindow = Event.None;
		readonly onDidChangeFullScreen = Event.None;
		readonly onDidTriggerSystemContextMenu = Event.None;

		private readonly onDidDestroyWindowEmitter = new Emitter<ICodeWindow>();
		readonly onDidDestroyWindow = this.onDidDestroyWindowEmitter.event;

		private readonly windows: ICodeWindow[] = [];

		addWindow(window: ICodeWindow): void {
			this.windows.push(window);
		}

		destroyWindow(window: ICodeWindow): void {
			const index = this.windows.indexOf(window);
			if (index >= 0) {
				this.windows.splice(index, 1);
			}

			this.onDidDestroyWindowEmitter.fire(window);
		}

		open(openConfig: IOpenConfiguration): Promise<ICodeWindow[]> { throw new Error('Method not implemented.'); }
		openEmptyWindow(openConfig: IOpenEmptyConfiguration): Promise<ICodeWindow[]> { throw new Error('Method not implemented.'); }
		openExtensionDevelopmentHostWindow(extensionDevelopmentPath: string[], openConfig: IOpenConfiguration): Promise<ICodeWindow[]> { throw new Error('Method not implemented.'); }
		openExistingWindow(window: ICodeWindow, openConfig: IOpenConfiguration): void { throw new Error('Method not implemented.'); }
		openAgentsWindow(openConfig: IOpenConfiguration, folderUri?: URI): Promise<ICodeWindow[]> { throw new Error('Method not implemented.'); }
		sendToFocused(channel: string, ...args: unknown[]): void { }
		sendToOpeningWindow(channel: string, ...args: unknown[]): void { }
		sendToAll(channel: string, payload?: unknown, windowIdsToIgnore?: number[]): void { }
		getWindows(): ICodeWindow[] { return this.windows.slice(0); }
		getWindowCount(): number { return this.windows.length; }
		getFocusedWindow(): ICodeWindow | undefined { return undefined; }
		getLastActiveWindow(): ICodeWindow | undefined { return undefined; }
		getWindowById(windowId: number): ICodeWindow | undefined { return this.windows.find(window => window.id === windowId); }
		getWindowByWebContents(): ICodeWindow | undefined { return undefined; }
	}

	function createCodeWindow(id: number, openedWorkspace?: { id: string }): ICodeWindow {
		return {
			onDidMaximize: Event.None,
			onDidUnmaximize: Event.None,
			onDidTriggerSystemContextMenu: Event.None,
			onDidEnterFullScreen: Event.None,
			onDidLeaveFullScreen: Event.None,
			onDidClose: Event.None,
			onWillLoad: Event.None,
			onDidSignalReady: Event.None,
			onDidDestroy: Event.None,
			whenClosedOrLoaded: Promise.resolve(),
			config: undefined,
			openedWorkspace,
			profile: undefined,
			backupPath: undefined,
			remoteAuthority: undefined,
			isExtensionDevelopmentHost: false,
			isExtensionTestHost: false,
			isReady: true,
			id,
			win: null,
			lastFocusTime: 0,
			isFullScreen: false,
			focus(): void { },
			setRepresentedFilename(name: string): void { },
			getRepresentedFilename(): string | undefined { return undefined; },
			setDocumentEdited(edited: boolean): void { },
			isDocumentEdited(): boolean { return false; },
			toggleFullScreen(): void { },
			updateWindowControls(): void { },
			matches(): boolean { return false; },
			dispose(): void { },
			ready(): Promise<ICodeWindow> { return Promise.resolve(this); },
			setReady(): void { },
			addTabbedWindow(window: ICodeWindow): void { },
			load(): void { },
			reload(): void { },
			close(): void { },
			getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; },
			send(channel: string, ...args: unknown[]): void { },
			sendWhenReady(channel: string, token, ...args: unknown[]): void { },
			updateTouchBar(items): void { },
			notifyZoomLevel(zoomLevel: number | undefined): void { },
			serializeWindowState() { return {}; }
		};
	}

	async function testStorage(storage: IStorageMain, scope: StorageScope): Promise<void> {
		strictEqual(storage.isInMemory(), true);

		// Telemetry: added after init unless workspace/profile scoped
		if (scope === StorageScope.APPLICATION) {
			strictEqual(storage.items.size, 0);
			await storage.init();
			strictEqual(typeof storage.get(firstSessionDateStorageKey), 'string');
			strictEqual(typeof storage.get(currentSessionDateStorageKey), 'string');
		} else {
			await storage.init();
		}

		let storageChangeEvent: IStorageChangeEvent | undefined = undefined;
		disposables.add(storage.onDidChangeStorage(e => {
			storageChangeEvent = e;
		}));

		let storageDidClose = false;
		disposables.add(storage.onDidCloseStorage(() => storageDidClose = true));

		// Basic store/get/remove
		const size = storage.items.size;

		storage.set('bar', 'foo');
		strictEqual(storageChangeEvent!.key, 'bar');
		storage.set('barNumber', 55);
		storage.set('barBoolean', true);

		strictEqual(storage.get('bar'), 'foo');
		strictEqual(storage.get('barNumber'), '55');
		strictEqual(storage.get('barBoolean'), 'true');

		strictEqual(storage.items.size, size + 3);

		storage.delete('bar');
		strictEqual(storage.get('bar'), undefined);

		strictEqual(storage.items.size, size + 2);

		// IS_NEW
		strictEqual(storage.get(IS_NEW_KEY), 'true');

		// Close
		await storage.close();

		strictEqual(storageDidClose, true);
	}

	teardown(() => {
		disposables.clear();
	});

	function createStorageService(lifecycleMainService: ILifecycleMainService = new TestLifecycleMainService(), windowsMainService: IWindowsMainService = new TestWindowsMainService()): TestStorageMainService {
		const environmentService = new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService);
		const fileService = disposables.add(new FileService(new NullLogService()));
		const uriIdentityService = disposables.add(new UriIdentityService(fileService));
		const testStorageService = disposables.add(new TestStorageMainService(new NullLogService(), environmentService, disposables.add(new UserDataProfilesMainService(disposables.add(new StateService(SaveStrategy.DELAYED, environmentService, new NullLogService(), fileService)), disposables.add(uriIdentityService), environmentService, fileService, new NullLogService(), productService)), lifecycleMainService, windowsMainService, fileService, uriIdentityService));

		disposables.add(testStorageService.applicationStorage);

		return testStorageService;
	}

	test('basics (application)', function () {
		const storageMainService = createStorageService();

		return testStorage(storageMainService.applicationStorage, StorageScope.APPLICATION);
	});

	test('basics (profile)', function () {
		const storageMainService = createStorageService();
		const profile = inMemoryProfile;

		return testStorage(storageMainService.profileStorage(profile), StorageScope.PROFILE);
	});

	test('basics (application shared)', function () {
		const storageMainService = createStorageService();

		return testStorage(storageMainService.applicationSharedStorage, StorageScope.APPLICATION_SHARED);
	});

	test('basics (workspace)', function () {
		const workspace = { id: generateUuid() };
		const storageMainService = createStorageService();

		return testStorage(storageMainService.workspaceStorage(workspace), StorageScope.WORKSPACE);
	});

	test('storage closed onWillShutdown', async function () {
		const lifecycleMainService = new TestLifecycleMainService();
		const storageMainService = createStorageService(lifecycleMainService);

		const profile = inMemoryProfile;
		const workspace = { id: generateUuid() };

		const workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		disposables.add(workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		}));

		const profileStorage = storageMainService.profileStorage(profile);
		let didCloseProfileStorage = false;
		disposables.add(profileStorage.onDidCloseStorage(() => {
			didCloseProfileStorage = true;
		}));

		const applicationStorage = storageMainService.applicationStorage;
		let didCloseApplicationStorage = false;
		disposables.add(applicationStorage.onDidCloseStorage(() => {
			didCloseApplicationStorage = true;
		}));

		strictEqual(applicationStorage, storageMainService.applicationStorage); // same instance as long as not closed
		strictEqual(profileStorage, storageMainService.profileStorage(profile)); // same instance as long as not closed
		strictEqual(workspaceStorage, storageMainService.workspaceStorage(workspace)); // same instance as long as not closed

		await applicationStorage.init();
		await profileStorage.init();
		await workspaceStorage.init();

		await lifecycleMainService.fireOnWillShutdown();

		strictEqual(didCloseApplicationStorage, true);
		strictEqual(didCloseProfileStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);

		const profileStorage2 = storageMainService.profileStorage(profile);
		notStrictEqual(profileStorage, profileStorage2);

		const workspaceStorage2 = storageMainService.workspaceStorage(workspace);
		notStrictEqual(workspaceStorage, workspaceStorage2);

		await profileStorage2.close();
		await workspaceStorage2.close();
	});

	test('storage closed before init works', async function () {
		const storageMainService = createStorageService();
		const profile = inMemoryProfile;
		const workspace = { id: generateUuid() };

		const workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		disposables.add(workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		}));

		const profileStorage = storageMainService.profileStorage(profile);
		let didCloseProfileStorage = false;
		disposables.add(profileStorage.onDidCloseStorage(() => {
			didCloseProfileStorage = true;
		}));

		const applicationStorage = storageMainService.applicationStorage;
		let didCloseApplicationStorage = false;
		disposables.add(applicationStorage.onDidCloseStorage(() => {
			didCloseApplicationStorage = true;
		}));

		await applicationStorage.close();
		await profileStorage.close();
		await workspaceStorage.close();

		strictEqual(didCloseApplicationStorage, true);
		strictEqual(didCloseProfileStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);
	});

	test('storage closed before init awaits works', async function () {
		const storageMainService = createStorageService();
		const profile = inMemoryProfile;
		const workspace = { id: generateUuid() };

		const workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		disposables.add(workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		}));

		const profileStorage = storageMainService.profileStorage(profile);
		let didCloseProfileStorage = false;
		disposables.add(profileStorage.onDidCloseStorage(() => {
			didCloseProfileStorage = true;
		}));

		const applicationtorage = storageMainService.applicationStorage;
		let didCloseApplicationStorage = false;
		disposables.add(applicationtorage.onDidCloseStorage(() => {
			didCloseApplicationStorage = true;
		}));

		applicationtorage.init();
		profileStorage.init();
		workspaceStorage.init();

		await applicationtorage.close();
		await profileStorage.close();
		await workspaceStorage.close();

		strictEqual(didCloseApplicationStorage, true);
		strictEqual(didCloseProfileStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);
	});

	test('application shared storage closed onWillShutdown', async function () {
		const lifecycleMainService = new TestLifecycleMainService();
		const storageMainService = createStorageService(lifecycleMainService);

		const applicationSharedStorage = storageMainService.applicationSharedStorage;
		let didCloseApplicationSharedStorage = false;
		disposables.add(applicationSharedStorage.onDidCloseStorage(() => {
			didCloseApplicationSharedStorage = true;
		}));

		await applicationSharedStorage.init();
		await lifecycleMainService.fireOnWillShutdown();

		strictEqual(didCloseApplicationSharedStorage, true);
	});

	test('workspace storage closed onDidDestroyWindow when last window closes', async function () {
		const windowsMainService = new TestWindowsMainService();
		const storageMainService = createStorageService(undefined, windowsMainService);
		const workspace = { id: generateUuid() };
		const window = createCodeWindow(1, workspace);
		windowsMainService.addWindow(window);

		const workspaceStorage = storageMainService.workspaceStorage(workspace);
		await workspaceStorage.init();

		const didCloseWorkspaceStorage = new Promise<void>(resolve => {
			disposables.add(workspaceStorage.onDidCloseStorage(() => resolve()));
		});

		windowsMainService.destroyWindow(window);
		await didCloseWorkspaceStorage;

		notStrictEqual(workspaceStorage, storageMainService.workspaceStorage(workspace));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
