/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { notStrictEqual, strictEqual } from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { OPTIONS, parseArgs } from '../../../environment/node/argv.js';
import { NativeEnvironmentService } from '../../../environment/node/environmentService.js';
import { FileService } from '../../../files/common/fileService.js';
import { FocusMode } from '../../../native/common/native.js';
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
import { ICodeWindow, ILoadEvent, IWindowState, LoadReason } from '../../../window/electron-main/window.js';
import { IAnyWorkspaceIdentifier } from '../../../workspace/common/workspace.js';

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

	class TestWindowLifecycleMainService extends TestLifecycleMainService {

		private readonly onWillLoadWindowEmitter = new Emitter<{ window: ICodeWindow; workspace: IAnyWorkspaceIdentifier | undefined; reason: LoadReason }>();
		override readonly onWillLoadWindow = this.onWillLoadWindowEmitter.event;

		private readonly onBeforeCloseWindowEmitter = new Emitter<ICodeWindow>();
		override readonly onBeforeCloseWindow = this.onBeforeCloseWindowEmitter.event;

		fireOnWillLoadWindow(window: ICodeWindow, workspace: IAnyWorkspaceIdentifier | undefined, reason: LoadReason): void {
			this.onWillLoadWindowEmitter.fire({ window, workspace, reason });
		}

		fireOnBeforeCloseWindow(window: ICodeWindow): void {
			this.onBeforeCloseWindowEmitter.fire(window);
		}
	}

	class TestCodeWindow implements ICodeWindow {

		readonly onDidMaximize = Event.None;
		readonly onDidUnmaximize = Event.None;
		readonly onDidTriggerSystemContextMenu = Event.None;
		readonly onDidEnterFullScreen = Event.None;
		readonly onDidLeaveFullScreen = Event.None;
		readonly onDidClose = Event.None;
		readonly onWillLoad = Event.None;
		readonly onDidSignalReady = Event.None;
		readonly onDidDestroy = Event.None;
		readonly whenClosedOrLoaded = Promise.resolve();
		readonly win = null;
		readonly lastFocusTime = 0;
		readonly isFullScreen = false;
		readonly isExtensionDevelopmentHost = false;
		readonly isExtensionTestHost = false;
		readonly isReady = true;

		constructor(
			readonly id: number,
			private workspace: IAnyWorkspaceIdentifier | undefined,
			readonly backupPath: string | undefined = undefined,
			readonly profile: IUserDataProfile | undefined = undefined,
			readonly remoteAuthority: string | undefined = undefined,
			readonly config = undefined
		) {
		}

		get openedWorkspace(): IAnyWorkspaceIdentifier | undefined {
			return this.workspace;
		}

		setWorkspace(workspace: IAnyWorkspaceIdentifier | undefined): void {
			this.workspace = workspace;
		}

		focus(options?: { mode: FocusMode }): void { }
		setRepresentedFilename(name: string): void { }
		getRepresentedFilename(): string | undefined { return undefined; }
		setDocumentEdited(edited: boolean): void { }
		isDocumentEdited(): boolean { return false; }
		toggleFullScreen(): void { }
		updateWindowControls(options: { height?: number; backgroundColor?: string; foregroundColor?: string; dimmed?: boolean }): void { }
		matches(webContents: Electron.WebContents): boolean { return false; }
		ready(): Promise<ICodeWindow> { return Promise.resolve(this); }
		setReady(): void { }
		addTabbedWindow(window: ICodeWindow): void { }
		load(config: NonNullable<ICodeWindow['config']>, options?: { isReload?: boolean }): void { }
		reload(cli?: Parameters<ICodeWindow['reload']>[0]): void { }
		close(): void { }
		getBounds(): Electron.Rectangle { return { x: 0, y: 0, width: 0, height: 0 }; }
		send(channel: string, ...args: unknown[]): void { }
		sendWhenReady(channel: string, token: CancellationToken, ...args: unknown[]): void { }
		updateTouchBar(items: Parameters<ICodeWindow['updateTouchBar']>[0]): void { }
		notifyZoomLevel(zoomLevel: number | undefined): void { }
		serializeWindowState(): IWindowState { return {}; }
		dispose(): void { }
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

	function onceDidCloseStorage(storage: IStorageMain): Promise<void> {
		return new Promise(resolve => {
			const listener = storage.onDidCloseStorage(() => {
				listener.dispose();
				resolve();
			});
		});
	}

	teardown(() => {
		disposables.clear();
	});

	function createStorageService(lifecycleMainService: ILifecycleMainService = new TestLifecycleMainService()): TestStorageMainService {
		const environmentService = new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService);
		const fileService = disposables.add(new FileService(new NullLogService()));
		const uriIdentityService = disposables.add(new UriIdentityService(fileService));
		const testStorageService = disposables.add(new TestStorageMainService(new NullLogService(), environmentService, disposables.add(new UserDataProfilesMainService(disposables.add(new StateService(SaveStrategy.DELAYED, environmentService, new NullLogService(), fileService)), disposables.add(uriIdentityService), environmentService, fileService, new NullLogService(), productService)), lifecycleMainService, fileService, uriIdentityService));

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

	test('workspace storage closed onBeforeCloseWindow for empty window workspace', async function () {
		const lifecycleMainService = new TestWindowLifecycleMainService();
		const storageMainService = createStorageService(lifecycleMainService);
		const backupPath = '/backups/empty-window-workspace';
		const workspace = { id: 'empty-window-workspace' };

		const workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		disposables.add(workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		}));

		await workspaceStorage.init();

		const window = new TestCodeWindow(1, undefined, backupPath);
		const didCloseWorkspaceStoragePromise = onceDidCloseStorage(workspaceStorage);
		lifecycleMainService.fireOnBeforeCloseWindow(window);
		await didCloseWorkspaceStoragePromise;

		strictEqual(didCloseWorkspaceStorage, true);
		notStrictEqual(workspaceStorage, storageMainService.workspaceStorage(workspace));
	});

	test('workspace storage closed onWillLoadWindow when window changes workspace', async function () {
		const lifecycleMainService = new TestWindowLifecycleMainService();
		const storageMainService = createStorageService(lifecycleMainService);
		const workspace1 = { id: generateUuid() };
		const workspace2 = { id: generateUuid() };

		const workspaceStorage1 = storageMainService.workspaceStorage(workspace1);
		let didCloseWorkspaceStorage1 = false;
		disposables.add(workspaceStorage1.onDidCloseStorage(() => {
			didCloseWorkspaceStorage1 = true;
		}));

		await workspaceStorage1.init();

		const window = new TestCodeWindow(1, workspace1);
		lifecycleMainService.fireOnWillLoadWindow(window, workspace1, LoadReason.INITIAL);
		const didCloseWorkspaceStorage1Promise = onceDidCloseStorage(workspaceStorage1);
		lifecycleMainService.fireOnWillLoadWindow(window, workspace2, LoadReason.LOAD);
		await didCloseWorkspaceStorage1Promise;

		strictEqual(didCloseWorkspaceStorage1, true);
		notStrictEqual(workspaceStorage1, storageMainService.workspaceStorage(workspace1));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
