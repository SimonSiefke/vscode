/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ExtensionsListView, UntrustedWorkspaceUnsupportedExtensionsView } from '../../browser/extensionsViews.js';
import { ExtensionsViewPaneContainer } from '../../browser/extensionsViewlet.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { AutoCheckUpdatesConfigurationKey, IExtension as IWorkbenchExtension, IExtensionsViewState, IExtensionsWorkbenchService } from '../../common/extensions.js';
import { ExtensionsWorkbenchService } from '../../browser/extensionsWorkbenchService.js';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions,
	getTargetPlatform, SortBy
} from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService, IExtensionManagementServer, IProfileAwareExtensionManagementService, IWorkbenchExtensionManagementService } from '../../../../services/extensionManagement/common/extensionManagement.js';
import { IExtensionRecommendationsService, ExtensionRecommendationReason } from '../../../../services/extensionRecommendations/common/extensionRecommendations.js';
import { getGalleryExtensionId } from '../../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { TestExtensionEnablementService } from '../../../../services/extensionManagement/test/browser/extensionEnablementService.test.js';
import { ExtensionGalleryService } from '../../../../../platform/extensionManagement/common/extensionGalleryService.js';
import { IURLService } from '../../../../../platform/url/common/url.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IPagedModel, IPager } from '../../../../../base/common/paging.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { IExtensionService, toExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { TestMenuService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestSharedProcessService } from '../../../../test/electron-browser/workbenchTestServices.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { Severity } from '../../../../../platform/notification/common/notification.js';
import { NativeURLService } from '../../../../../platform/url/common/urlService.js';
import { URI } from '../../../../../base/common/uri.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createSandbox, SinonStub, spy, stub, useFakeTimers } from 'sinon';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { RemoteAgentService } from '../../../../services/remote/electron-browser/remoteAgentService.js';
import { ExtensionType, IExtension, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { ISharedProcessService } from '../../../../../platform/ipc/electron-browser/services.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IMenuService } from '../../../../../platform/actions/common/actions.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { IViewContainerModel, IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { Extensions as ExtensionFeatureExtensions, IExtensionFeaturesManagementService, IExtensionFeaturesRegistry } from '../../../../services/extensionManagement/common/extensionFeatures.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { IExtensionManifestPropertiesService } from '../../../../services/extensions/common/extensionManifestPropertiesService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Schemas } from '../../../../../base/common/network.js';
import { platform } from '../../../../../base/common/platform.js';
import { arch } from '../../../../../base/common/process.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IUpdateService, State } from '../../../../../platform/update/common/update.js';
import { IMeteredConnectionService } from '../../../../../platform/meteredConnection/common/meteredConnection.js';
import { ExtensionGalleryManifestStatus, IExtensionGalleryManifestService } from '../../../../../platform/extensionManagement/common/extensionGalleryManifest.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { UserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfileService.js';
import { toUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';

suite('ExtensionsViews Tests', () => {

	const disposableStore = ensureNoDisposablesAreLeakedInTestSuite();
	const featureId = 'extensionsViewsTestFeature';

	let instantiationService: TestInstantiationService;
	let testableView: ExtensionsListView;

	const localEnabledTheme = aLocalExtension('first-enabled-extension', { categories: ['Themes', 'random'] }, { installedTimestamp: 123456 });
	const localEnabledLanguage = aLocalExtension('second-enabled-extension', { categories: ['Programming languages'], version: '1.0.0' }, { installedTimestamp: Date.now(), updated: false });
	const localDisabledTheme = aLocalExtension('first-disabled-extension', { categories: ['themes'] }, { installedTimestamp: 234567 });
	const localDisabledLanguage = aLocalExtension('second-disabled-extension', { categories: ['programming languages'] }, { installedTimestamp: Date.now() - 50000, updated: true });
	const localRandom = aLocalExtension('random-enabled-extension', { categories: ['random'] }, { installedTimestamp: 345678 });
	const builtInTheme = aLocalExtension('my-theme', { categories: ['Themes'], contributes: { themes: ['my-theme'] } }, { type: ExtensionType.System, installedTimestamp: 222 });
	const builtInBasic = aLocalExtension('my-lang', { categories: ['Programming Languages'], contributes: { grammars: [{ language: 'my-language' }] } }, { type: ExtensionType.System, installedTimestamp: 666666 });

	let queryPage = aPage([]);
	const galleryExtensions: IGalleryExtension[] = [];

	const workspaceRecommendationA = aGalleryExtension('workspace-recommendation-A');
	const workspaceRecommendationB = aGalleryExtension('workspace-recommendation-B');
	const configBasedRecommendationA = aGalleryExtension('configbased-recommendation-A');
	const configBasedRecommendationB = aGalleryExtension('configbased-recommendation-B');
	const fileBasedRecommendationA = aGalleryExtension('filebased-recommendation-A');
	const fileBasedRecommendationB = aGalleryExtension('filebased-recommendation-B');
	const otherRecommendationA = aGalleryExtension('other-recommendation-A');

	setup(async () => {
		instantiationService = disposableStore.add(new TestInstantiationService());
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(ILogService, NullLogService);
		instantiationService.stub(IFileService, disposableStore.add(new FileService(new NullLogService())));
		instantiationService.stub(IProductService, {});

		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(IConfigurationService, new TestConfigurationService());

		instantiationService.stub(IExtensionGalleryService, ExtensionGalleryService);
		instantiationService.stub(IExtensionGalleryManifestService, {
			onDidChangeExtensionGalleryManifest: Event.None,
			onDidChangeExtensionGalleryManifestStatus: Event.None,
			extensionGalleryManifestStatus: ExtensionGalleryManifestStatus.Unavailable,
			async getExtensionGalleryManifest() { return null; }
		});
		instantiationService.stub(ISharedProcessService, TestSharedProcessService);

		instantiationService.stub(IWorkbenchExtensionManagementService, {
			onInstallExtension: Event.None,
			onDidInstallExtensions: Event.None,
			onUninstallExtension: Event.None,
			onDidUninstallExtension: Event.None,
			onDidUpdateExtensionMetadata: Event.None,
			onDidChangeProfile: Event.None,
			onProfileAwareDidInstallExtensions: Event.None,
			async getInstalled() { return []; },
			async getInstalledWorkspaceExtensions() { return []; },
			async canInstall() { return true; },
			async getExtensionsControlManifest() { return { malicious: [], deprecated: {}, search: [], publisherMapping: {} }; },
			async getTargetPlatform() { return getTargetPlatform(platform, arch); },
			async updateMetadata(local) { return local; }
		});
		instantiationService.stub(IRemoteAgentService, RemoteAgentService);
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(IMenuService, new TestMenuService());

		const localExtensionManagementServer = { extensionManagementService: instantiationService.get(IExtensionManagementService) as IProfileAwareExtensionManagementService, label: 'local', id: 'vscode-local' };
		instantiationService.stub(IExtensionManagementServerService, {
			get localExtensionManagementServer(): IExtensionManagementServer {
				return localExtensionManagementServer;
			},
			getExtensionManagementServer(extension: IExtension): IExtensionManagementServer | null {
				if (extension.location.scheme === Schemas.file) {
					return localExtensionManagementServer;
				}
				throw new Error(`Invalid Extension ${extension.location}`);
			}
		});

		instantiationService.stub(IWorkbenchExtensionEnablementService, disposableStore.add(new TestExtensionEnablementService(instantiationService)));
		instantiationService.stub(IUserDataProfileService, disposableStore.add(new UserDataProfileService(toUserDataProfile('test', 'test', URI.file('foo'), URI.file('cache')))));

		const reasons: { [key: string]: any } = {};
		reasons[workspaceRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[workspaceRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[fileBasedRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[fileBasedRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[otherRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Executable };
		reasons[configBasedRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.WorkspaceConfig };
		instantiationService.stub(IExtensionRecommendationsService, {
			getWorkspaceRecommendations() {
				return Promise.resolve([
					workspaceRecommendationA.identifier.id,
					workspaceRecommendationB.identifier.id]);
			},
			getConfigBasedRecommendations() {
				return Promise.resolve({
					important: [configBasedRecommendationA.identifier.id],
					others: [configBasedRecommendationB.identifier.id],
				});
			},
			getImportantRecommendations(): Promise<string[]> {
				return Promise.resolve([]);
			},
			getFileBasedRecommendations() {
				return [
					fileBasedRecommendationA.identifier.id,
					fileBasedRecommendationB.identifier.id
				];
			},
			getOtherRecommendations() {
				return Promise.resolve([
					configBasedRecommendationB.identifier.id,
					otherRecommendationA.identifier.id
				]);
			},
			getAllRecommendationsWithReason() {
				return reasons;
			}
		});
		instantiationService.stub(IURLService, NativeURLService);

		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localEnabledTheme, localEnabledLanguage, localRandom, localDisabledTheme, localDisabledLanguage, builtInTheme, builtInBasic]);
		instantiationService.stubPromise(IExtensionManagementService, 'getExtensgetExtensionsControlManifestionsReport', {});

		instantiationService.stub(IExtensionGalleryService, <Partial<IExtensionGalleryService>>{
			query: async () => {
				return queryPage;
			},
			getCompatibleExtension: async (gallery) => {
				return gallery;
			},
			getExtensions: async (infos) => {
				const result: IGalleryExtension[] = [];
				for (const info of infos) {
					const extension = galleryExtensions.find(e => e.identifier.id === info.id);
					if (extension) {
						result.push(extension);
					}
				}
				return result;
			},
			isEnabled: () => true,
			isExtensionCompatible: async () => true,
		});

		instantiationService.stub(IViewDescriptorService, {
			getViewLocationById(): ViewContainerLocation {
				return ViewContainerLocation.Sidebar;
			},
			onDidChangeLocation: Event.None
		});

		instantiationService.stub(IExtensionService, {
			onDidChangeExtensions: Event.None,
			extensions: [
				toExtensionDescription(localEnabledTheme),
				toExtensionDescription(localEnabledLanguage),
				toExtensionDescription(localRandom),
				toExtensionDescription(builtInTheme),
				toExtensionDescription(builtInBasic)
			],
			canAddExtension: (extension) => true,
			whenInstalledExtensionsRegistered: () => Promise.resolve(true)
		});
		await (<TestExtensionEnablementService>instantiationService.get(IWorkbenchExtensionEnablementService)).setEnablement([localDisabledTheme], EnablementState.DisabledGlobally);
		await (<TestExtensionEnablementService>instantiationService.get(IWorkbenchExtensionEnablementService)).setEnablement([localDisabledLanguage], EnablementState.DisabledGlobally);

		instantiationService.stub(IUpdateService, { onStateChange: Event.None, state: State.Uninitialized });
		instantiationService.stub(IMeteredConnectionService, { isConnectionMetered: false, onDidChangeIsConnectionMetered: Event.None });
		instantiationService.set(IExtensionsWorkbenchService, disposableStore.add(instantiationService.createInstance(ExtensionsWorkbenchService)));
		testableView = disposableStore.add(instantiationService.createInstance(ExtensionsListView, {}, { id: '', title: '' }));
		queryPage = aPage([]);

		galleryExtensions.splice(0, galleryExtensions.length, ...[
			workspaceRecommendationA,
			workspaceRecommendationB,
			configBasedRecommendationA,
			configBasedRecommendationB,
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			otherRecommendationA
		]);
	});

	test('Test query types', () => {
		assert.strictEqual(ExtensionsListView.isBuiltInExtensionsQuery('@builtin'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@installed'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@enabled'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@disabled'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@outdated'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@updates'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@sort:name'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@sort:updateDate'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@installed searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@enabled searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@disabled searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@outdated searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@updates searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@agentPlugins @installed'), false);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@agentPlugins @installed searchText'), false);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@mcp @installed'), false);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@mcp @installed searchText'), false);
	});

	test('Test empty query equates to sort by install count', async () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		await testableView.show('');
		assert.ok(target.calledOnce);
		const options: IQueryOptions = target.args[0][0];
		assert.strictEqual(options.sortBy, SortBy.InstallCount);
	});

	test('releases listeners when an installed extensions query completes after disposal', async () => {
		const extensionsChanged = disposableStore.add(new Emitter<never>());
		const extensionService = {
			...instantiationService.get(IExtensionService),
			onDidChangeExtensions: extensionsChanged.event
		};
		const viewInstantiationService = disposableStore.add(instantiationService.createChild(new ServiceCollection([IExtensionService, extensionService])));
		const view = disposableStore.add(viewInstantiationService.createInstance(ExtensionsListView, {}, { id: '', title: '' }));
		const installed = new DeferredPromise<[]>();
		stub(instantiationService.get(IExtensionsWorkbenchService), 'queryLocal').returns(installed.p);

		const cancelled = assert.rejects(view.show('@installed'), isCancellationError);
		view.dispose();

		// Wait for a second query through the same local pipeline. Its result is
		// handled after the disposed view's result and adds no change listener.
		const replacement = disposableStore.add(viewInstantiationService.createInstance(ExtensionsListView, {}, { id: '', title: '' }));
		const builtins = replacement.show('@builtin');
		await installed.complete([]);
		await Promise.all([cancelled, builtins]);
		assert.strictEqual(extensionsChanged.hasListeners(), false);
	});

	test('still cancels the current query on disposal after a previous query was cancelled', async () => {
		const installed = new DeferredPromise<[]>();
		stub(instantiationService.get(IExtensionsWorkbenchService), 'queryLocal').returns(installed.p);

		const previous = assert.rejects(testableView.show('@installed'), isCancellationError);
		const current = assert.rejects(testableView.show('@builtin'), isCancellationError);
		await previous;
		testableView.dispose();
		await installed.complete([]);
		await current;
	});

	test('does not start an installed query on a disposed pane', async () => {
		const queryLocal = stub(instantiationService.get(IExtensionsWorkbenchService), 'queryLocal').resolves([]);
		testableView.dispose();

		const result = await testableView.show('@installed');
		assert.deepStrictEqual({ length: result.length, queries: queryLocal.callCount }, { length: 0, queries: 0 });
	});

	test('does not search when an Extensions refresh completes after disposal', async () => {
		const services = workbenchInstantiationService({
			configurationService: () => new TestConfigurationService({ [AutoCheckUpdatesConfigurationKey]: true }),
		}, disposableStore);
		class TestExtensionsViewPaneContainer extends ExtensionsViewPaneContainer {
			protected override getMemento() { return {}; }
		}
		const viewContainer: ViewContainer = {
			id: 'test.extensions',
			title: { value: 'Extensions', original: 'Extensions' },
			ctorDescriptor: new SyncDescriptor(TestExtensionsViewPaneContainer),
		};
		services.stub(IViewDescriptorService, {
			getViewContainerById: () => viewContainer,
			getViewContainerModel: () => new (mock<IViewContainerModel>())(),
		});
		services.stub(IExtensionManagementServerService, {});
		services.stub(IPreferencesService, {});
		const manifest = Promise.resolve(null);
		services.stub(IExtensionGalleryManifestService, {
			getExtensionGalleryManifest: () => manifest,
			onDidChangeExtensionGalleryManifest: Event.None,
		});
		const local = new DeferredPromise<IWorkbenchExtension[]>();
		const queryLocal = stub().resolves([]);
		queryLocal.onSecondCall().returns(local.p);
		const checkForUpdates = stub().resolves();
		services.stub(IExtensionsWorkbenchService, { onReset: Event.None, queryLocal, checkForUpdates });
		const container = disposableStore.add(services.createInstance(TestExtensionsViewPaneContainer));
		const view = container as unknown as {
			doSearch(refresh: boolean): Promise<void>;
			hasInstalledExtensionsContextKey: IContextKey<boolean>;
		};
		const doSearch = stub(view, 'doSearch').resolves();
		const setInstalled = spy(view.hasInstalledExtensionsContextKey, 'set');
		await manifest;

		await container.refresh();
		const pending = container.refresh();
		assert.strictEqual(queryLocal.callCount, 2);
		container.dispose();
		await local.complete([]);
		await pending;
		assert.deepStrictEqual({ searches: doSearch.args, installed: setInstalled.args, updateChecks: checkForUpdates.callCount }, {
			searches: [[true]], installed: [[false]], updateChecks: 2,
		});
	});

	test('an empty workspace query replaces both completed and pending results', async () => {
		const extensionsChanged = disposableStore.add(new Emitter<never>());
		const extensionService = {
			...instantiationService.get(IExtensionService),
			onDidChangeExtensions: extensionsChanged.event
		};
		instantiationService.stub(IWorkspaceTrustManagementService, { isWorkspaceTrusted: () => false });
		instantiationService.stub(IExtensionManifestPropertiesService, { getExtensionUntrustedWorkspaceSupportType: () => false });
		const child = disposableStore.add(instantiationService.createChild(new ServiceCollection([IExtensionService, extensionService])));
		const view = disposableStore.add(child.createInstance(UntrustedWorkspaceUnsupportedExtensionsView, {}, { id: '', title: '' }));
		const query = spy(view as unknown as { query(): Promise<unknown> }, 'query');
		const workbenchService = instantiationService.get(IExtensionsWorkbenchService);
		const extension = (await workbenchService.queryLocal()).find(candidate => candidate.identifier.id === localEnabledLanguage.identifier.id);
		assert.ok(extension);
		const local = new DeferredPromise<IWorkbenchExtension[]>();
		const queryLocal = stub(workbenchService, 'queryLocal').resolves([extension]);
		queryLocal.onSecondCall().returns(local.p);

		await view.show('@workspaceUnsupported:untrusted');
		assert.strictEqual(view.count(), 1);
		assert.strictEqual(extensionsChanged.hasListeners(), true);
		const { publications } = observeModelPublications(view);
		const empty = await view.show('@workspaceUnsupported:untrustedPartial');
		assert.strictEqual(empty.length, 0);
		assert.deepStrictEqual({ count: view.count(), listeners: extensionsChanged.hasListeners() }, { count: 0, listeners: false });

		const cancelled = assert.rejects(view.show('@workspaceUnsupported:untrusted'), isCancellationError);
		const emptyAfterPending = await view.show('@workspaceUnsupported:untrustedPartial');
		await local.complete([extension]);
		await Promise.all([cancelled, query.secondCall.returnValue]);
		assert.strictEqual(emptyAfterPending.length, 0);
		assert.deepStrictEqual(publications, [
			{ model: empty, count: 0, featureId: undefined, message: undefined },
			{ model: emptyAfterPending, count: 0, featureId: undefined, message: undefined },
		]);
		assert.deepStrictEqual({ count: view.count(), listeners: extensionsChanged.hasListeners() }, { count: 0, listeners: false });
	});

	test('releases each model listener when its completed query is replaced', async () => {
		const sandbox = createSandbox();
		disposableStore.add(toDisposable(() => sandbox.restore()));
		sandbox.stub(instantiationService.get(IExtensionsWorkbenchService), 'queryLocal').resolves([]);
		const { queryResultListeners } = testableView as unknown as { queryResultListeners: DisposableStore };
		const addListener = sandbox.spy(queryResultListeners, 'add');

		await testableView.show('@installed first');
		const firstListener = sandbox.spy(addListener.firstCall.returnValue, 'dispose');
		await testableView.show('@installed second');
		const secondListener = sandbox.spy(addListener.secondCall.returnValue, 'dispose');
		assert.deepStrictEqual([firstListener.callCount, secondListener.callCount], [1, 0]);

		testableView.dispose();
		assert.deepStrictEqual([firstListener.callCount, secondListener.callCount], [1, 1]);
	});

	test('publishes feature display state only for the current query', async () => {
		registerTestFeature();
		const state: Pick<IExtensionsViewState, 'filters'> = { filters: {} };
		const view = testableView as unknown as {
			extensionsViewState: typeof state;
			query(): Promise<unknown>;
		};
		view.extensionsViewState = state;
		const query = spy(view, 'query');
		const local = new DeferredPromise<IWorkbenchExtension[]>();
		stub(instantiationService.get(IExtensionsWorkbenchService), 'queryLocal').resolves([]).onFirstCall().returns(local.p);

		const featureQuery = `@contribute:${featureId}`;
		const cancelled = assert.rejects(testableView.show(featureQuery), isCancellationError);
		await testableView.show('@installed');
		await local.complete([]);
		await Promise.all([cancelled, query.firstCall.returnValue]);
		assert.strictEqual(state.filters.featureId, undefined);

		await testableView.show(featureQuery);
		assert.strictEqual(state.filters.featureId, featureId);
		await testableView.show('@installed');
		assert.strictEqual(state.filters.featureId, undefined);
	});

	test('applies the current feature filter when a collapsed pane first renders its body', async () => {
		registerTestFeature();
		const services = workbenchInstantiationService(undefined, disposableStore);
		const viewContainer: ViewContainer = {
			id: 'test.extensions',
			title: { value: 'Extensions', original: 'Extensions' },
			ctorDescriptor: new SyncDescriptor(ExtensionsViewPaneContainer),
		};
		const model = new class extends mock<IViewContainerModel>() {
			override readonly onDidChangeContainerInfo = Event.None;
		}();
		services.stub(IViewDescriptorService, {
			getViewContainerByViewId: () => viewContainer,
			getDefaultContainerById: () => viewContainer,
			getViewDescriptorById: () => null,
			getViewContainerModel: () => model,
			getViewLocationById: () => ViewContainerLocation.Sidebar,
			onDidChangeLocation: Event.None,
		});
		const extension = (await instantiationService.get(IExtensionsWorkbenchService).queryLocal()).find(candidate => candidate.identifier.id === localEnabledLanguage.identifier.id);
		assert.ok(extension);
		services.stub(IExtensionsWorkbenchService, { queryLocal: async () => [extension], onChange: Event.None });
		services.stub(IExtensionFeaturesManagementService, { getAccessData: () => ({ accessTimes: [] }) });
		services.set(IWorkbenchExtensionEnablementService, instantiationService.get(IWorkbenchExtensionEnablementService));
		const view = disposableStore.add(services.createInstance(ExtensionsListView, {}, { id: 'test.extensions.list', title: 'Extensions', expanded: false }));
		view.render();
		const featureQuery = `@contribute:${featureId}`;
		const result = await view.show(featureQuery);
		assert.strictEqual(result.get(0).identifier.id, extension.identifier.id);
		assert.strictEqual(view.element.querySelector('.extensions-list'), null);

		const { publications } = observeModelPublications(view);
		view.setExpanded(true);
		const installed = await view.show('@installed');
		const feature = await view.show(featureQuery);
		assert.strictEqual(feature.get(0).identifier.id, extension.identifier.id);
		assert.deepStrictEqual(publications, [
			{ model: result, count: 1, featureId, message: undefined },
			{ model: installed, count: 1, featureId: undefined, message: undefined },
			{ model: feature, count: 1, featureId, message: undefined },
		]);
	});

	for (const outcome of ['result', 'error']) {
		test(`keeps the current installed query live after a superseded ${outcome}`, async () => {
			let listenerCount = 0;
			const extensionsChanged = disposableStore.add(new Emitter<{ added: readonly IExtensionDescription[]; removed: readonly IExtensionDescription[] }>({
				onDidAddListener: () => { listenerCount++; },
				onWillRemoveListener: () => { listenerCount--; }
			}));
			const extensionService = {
				...instantiationService.get(IExtensionService),
				onDidChangeExtensions: extensionsChanged.event
			};
			const child = disposableStore.add(instantiationService.createChild(new ServiceCollection([IExtensionService, extensionService])));
			const view = disposableStore.add(child.createInstance(ExtensionsListView, {}, { id: '', title: '' }));
			const query = spy(view as unknown as { query(): Promise<unknown> }, 'query');
			const { publications, updates } = observeModelPublications(view);

			const workbenchService = instantiationService.get(IExtensionsWorkbenchService);
			const installed = await workbenchService.queryLocal();
			const currentExtension = installed.find(extension => extension.identifier.id === localEnabledLanguage.identifier.id);
			const addedExtension = installed.find(extension => extension.identifier.id === localDisabledLanguage.identifier.id);
			assert.ok(currentExtension && addedExtension);
			const previousResult = new DeferredPromise<IWorkbenchExtension[]>();
			const queryLocal = stub(workbenchService, 'queryLocal');
			queryLocal.onFirstCall().returns(previousResult.p);
			queryLocal.onSecondCall().resolves([currentExtension]);

			const cancelled = assert.rejects(view.show('@installed first'), isCancellationError);
			// show() already awaits this promise, so its continuation runs before
			// ours even though the cancelable promise has already rejected.
			const previousQuery = query.firstCall.returnValue;
			const failure = new Error('Superseded query failed');
			const handled = outcome === 'error' ? assert.rejects(previousQuery, failure) : previousQuery;
			const currentModel = await view.show('@installed second');
			assert.strictEqual(currentModel.get(0).identifier.id, currentExtension.identifier.id);

			if (outcome === 'error') {
				await previousResult.error(failure);
			} else {
				await previousResult.complete(installed);
			}
			await Promise.all([cancelled, handled]);
			assert.deepStrictEqual(publications, [{ model: currentModel, count: 1, featureId: undefined, message: undefined }]);
			assert.strictEqual(listenerCount, 1);

			stub(workbenchService, 'local').get(() => [currentExtension, addedExtension]);
			const clock = useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			try {
				extensionsChanged.fire({ added: [toExtensionDescription(localDisabledLanguage)], removed: [] });
				await clock.tickAsync(100);
				assert.strictEqual(updates.length, 1);
				const { model, count } = updates[0];
				assert.deepStrictEqual({ count, extensions: [model.get(0).identifier.id, model.get(1).identifier.id] }, {
					count: 2, extensions: [currentExtension.identifier.id, addedExtension.identifier.id],
				});
			} finally {
				clock.restore();
			}

			view.dispose();
			assert.strictEqual(extensionsChanged.hasListeners(), false);
		});
	}

	test('Test non empty query without sort doesnt use sortBy', async () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		await testableView.show('some extension');
		assert.ok(target.calledOnce);
		const options: IQueryOptions = target.args[0][0];
		assert.strictEqual(options.sortBy, undefined);
	});

	test('Test query with sort uses sortBy', async () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		await testableView.show('some extension @sort:rating');
		assert.ok(target.calledOnce);
		const options: IQueryOptions = target.args[0][0];
		assert.strictEqual(options.sortBy, SortBy.WeightedRating);
	});

	test('Test default view actions required sorting', async () => {
		queryPage = aPage([aGalleryExtension(localEnabledLanguage.manifest.name, { ...localEnabledLanguage.manifest, version: '1.0.1', identifier: localDisabledLanguage.identifier })]);

		const workbenchService = instantiationService.get(IExtensionsWorkbenchService);
		const extension = (await workbenchService.queryLocal()).find(ex => ex.identifier.id === localEnabledLanguage.identifier.id);

		await new Promise<void>(c => {
			const disposable = workbenchService.onChange(() => {
				if (extension?.outdated) {
					disposable.dispose();
					c();
				}
			});
			instantiationService.get(IExtensionsWorkbenchService).queryGallery(CancellationToken.None);
		});

		const result = await testableView.show('@installed');
		assert.strictEqual(result.length, 5, 'Unexpected number of results for @installed query');
		const actual = [result.get(0).name, result.get(1).name, result.get(2).name, result.get(3).name, result.get(4).name];
		const expected = [localEnabledLanguage.manifest.name, localEnabledTheme.manifest.name, localRandom.manifest.name, localDisabledTheme.manifest.name, localDisabledLanguage.manifest.name];
		for (let i = 0; i < result.length; i++) {
			assert.strictEqual(actual[i], expected[i], 'Unexpected extension for @installed query with outadted extension.');
		}
	});

	test('Test installed query results', async () => {
		await testableView.show('@installed').then(result => {
			assert.strictEqual(result.length, 5, 'Unexpected number of results for @installed query');
			const actual = [result.get(0).name, result.get(1).name, result.get(2).name, result.get(3).name, result.get(4).name].sort();
			const expected = [localDisabledTheme.manifest.name, localEnabledTheme.manifest.name, localRandom.manifest.name, localDisabledLanguage.manifest.name, localEnabledLanguage.manifest.name];
			for (let i = 0; i < result.length; i++) {
				assert.strictEqual(actual[i], expected[i], 'Unexpected extension for @installed query.');
			}
		});

		await testableView.show('@installed first').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
		});

		await testableView.show('@disabled').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @disabled query');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query.');
			assert.strictEqual(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query.');
		});

		await testableView.show('@enabled').then(result => {
			assert.strictEqual(result.length, 3, 'Unexpected number of results for @enabled query');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query.');
			assert.strictEqual(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @enabled query.');
			assert.strictEqual(result.get(2).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query.');
		});

		await testableView.show('@builtin category:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin category:themes query');
			assert.strictEqual(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin:themes query.');
		});

		await testableView.show('@builtin category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin:basics query');
			assert.strictEqual(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin:basics query.');
		});

		await testableView.show('@builtin').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @builtin query');
			assert.strictEqual(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin query.');
			assert.strictEqual(result.get(1).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});

		await testableView.show('@builtin my-theme').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin query');
			assert.strictEqual(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});
	});

	test('Test installed query with category', async () => {
		await testableView.show('@installed category:themes').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
		});

		await testableView.show('@installed category:"themes"').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with quoted category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
		});

		await testableView.show('@installed category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with quoted category including space');
			assert.strictEqual(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category including space.');
			assert.strictEqual(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category inlcuding space.');
		});

		await testableView.show('@installed category:themes category:random').then(result => {
			assert.strictEqual(result.length, 3, 'Unexpected number of results for @installed query with multiple category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.strictEqual(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.strictEqual(result.get(2).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
		});

		await testableView.show('@enabled category:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with category.');
		});

		await testableView.show('@enabled category:"themes"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with quoted category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with quoted category.');
		});

		await testableView.show('@enabled category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with quoted category inlcuding space');
			assert.strictEqual(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query with quoted category including space.');
		});

		await testableView.show('@disabled category:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with category');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with category.');
		});

		await testableView.show('@disabled category:"themes"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with quoted category');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with quoted category.');
		});

		await testableView.show('@disabled category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with quoted category inlcuding space');
			assert.strictEqual(result.get(0).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query with quoted category including space.');
		});
	});

	test('Test local query with sorting order', async () => {
		await testableView.show('@recentlyUpdated').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @recentlyUpdated');
			assert.strictEqual(result.get(0).name, localDisabledLanguage.manifest.name, 'Unexpected default sort order of extensions for @recentlyUpdate query');
		});

		await testableView.show('@installed @sort:updateDate').then(result => {
			assert.strictEqual(result.length, 5, 'Unexpected number of results for @sort:updateDate. Expected all localy installed Extension which are not builtin');
			const actual = [result.get(0).local?.installedTimestamp, result.get(1).local?.installedTimestamp, result.get(2).local?.installedTimestamp, result.get(3).local?.installedTimestamp, result.get(4).local?.installedTimestamp];
			const expected = [localEnabledLanguage.installedTimestamp, localDisabledLanguage.installedTimestamp, localRandom.installedTimestamp, localDisabledTheme.installedTimestamp, localEnabledTheme.installedTimestamp];
			for (let i = 0; i < result.length; i++) {
				assert.strictEqual(actual[i], expected[i], 'Unexpected extension sorting for @sort:updateDate query.');
			}
		});
	});

	test('Test @recommended:workspace query', () => {
		const workspaceRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			configBasedRecommendationA,
		];

		return testableView.show('@recommended:workspace').then(result => {
			assert.strictEqual(result.length, workspaceRecommendedExtensions.length);
			for (let i = 0; i < workspaceRecommendedExtensions.length; i++) {
				assert.strictEqual(result.get(i).identifier.id, workspaceRecommendedExtensions[i].identifier.id);
			}
		});
	});

	test('Test @recommended query', async () => {
		const allRecommendedExtensions = [
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			configBasedRecommendationB,
			otherRecommendationA
		];

		const result = await testableView.show('@recommended');
		assert.strictEqual(result.length, allRecommendedExtensions.length);
		for (let i = 0; i < allRecommendedExtensions.length; i++) {
			assert.strictEqual(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
		}
	});


	test('Test @recommended:all query', async () => {
		const allRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			configBasedRecommendationA,
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			configBasedRecommendationB,
			otherRecommendationA,
		];

		const result = await testableView.show('@recommended:all');
		assert.strictEqual(result.length, allRecommendedExtensions.length);
		for (let i = 0; i < allRecommendedExtensions.length; i++) {
			assert.strictEqual(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
		}
	});

	test('Test search', async () => {
		const results = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		queryPage = aPage(results);
		const result = await testableView.show('search-me');
		assert.strictEqual(result.length, results.length);
		for (let i = 0; i < results.length; i++) {
			assert.strictEqual(result.get(i).identifier.id, results[i].identifier.id);
		}
	});

	test('Test preferred search experiment', async () => {
		queryPage = aPage([
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		], 5);
		const notInFirstPage = aGalleryExtension('not-in-first-page');
		galleryExtensions.push(notInFirstPage);
		const expected = [
			workspaceRecommendationA,
			notInFirstPage,
			workspaceRecommendationB,
			fileBasedRecommendationA,
			otherRecommendationA,
		];

		instantiationService.stubPromise(IWorkbenchExtensionManagementService, 'getExtensionsControlManifest', {
			malicious: [], deprecated: {},
			search: [{
				query: 'search-me',
				preferredResults: [
					workspaceRecommendationA.identifier.id,
					notInFirstPage.identifier.id,
					workspaceRecommendationB.identifier.id
				]
			}]
		});

		const testObject = disposableStore.add(instantiationService.createInstance(ExtensionsListView, {}, { id: '', title: '' }));
		const result = await testObject.show('search-me');
		assert.strictEqual(result.length, expected.length);
		for (let i = 0; i < expected.length; i++) {
			assert.strictEqual(result.get(i).identifier.id, expected[i].identifier.id);
		}
	});

	test('Skip preferred search experiment when user defines sort order', async () => {
		const realResults = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		queryPage = aPage(realResults);

		const result = await testableView.show('search-me @sort:installs');
		assert.strictEqual(result.length, realResults.length);
		for (let i = 0; i < realResults.length; i++) {
			assert.strictEqual(result.get(i).identifier.id, realResults[i].identifier.id);
		}
	});

	function observeModelPublications(view: ExtensionsListView) {
		type Message = { text: string; severity: Severity };
		const target = view as unknown as {
			extensionsViewState?: IExtensionsViewState;
			setModel(model: IPagedModel<IWorkbenchExtension>, message?: Message, donotResetScrollTop?: boolean): void;
			updateModel(model: IPagedModel<IWorkbenchExtension>): void;
		};
		const publications: { model: IPagedModel<IWorkbenchExtension>; count: number; featureId: string | undefined; message: Message | undefined }[] = [];
		const updates: { model: IPagedModel<IWorkbenchExtension>; count: number }[] = [];
		const setModel = target.setModel.bind(target);
		const updateModel = target.updateModel.bind(target);
		stub(target, 'setModel').callsFake((...args) => {
			publications.push({ model: args[0], count: view.count(), featureId: target.extensionsViewState?.filters.featureId, message: args[1] });
			setModel(...args);
		});
		stub(target, 'updateModel').callsFake(model => {
			updates.push({ model, count: view.count() });
			updateModel(model);
		});
		return { publications, updates };
	}

	function registerTestFeature(): void {
		disposableStore.add(Registry.as<IExtensionFeaturesRegistry>(ExtensionFeatureExtensions.ExtensionFeaturesRegistry).registerExtensionFeature({
			id: featureId,
			label: 'Test feature',
			access: {},
		}));
	}

	function aLocalExtension(name: string = 'someext', manifest: any = {}, properties: any = {}): ILocalExtension {
		manifest = { name, publisher: 'pub', version: '1.0.0', ...manifest };
		properties = {
			type: ExtensionType.User,
			location: URI.file(`pub.${name}`),
			identifier: { id: getGalleryExtensionId(manifest.publisher, manifest.name) },
			metadata: { id: getGalleryExtensionId(manifest.publisher, manifest.name), publisherId: manifest.publisher, publisherDisplayName: 'somename' },
			...properties,
			isValid: properties.isValid ?? true,
		};
		properties.isBuiltin = properties.type === ExtensionType.System;
		return <ILocalExtension>Object.create({ manifest, ...properties });
	}

	function aGalleryExtension(name: string, properties: any = {}, galleryExtensionProperties: any = {}, assets: any = {}): IGalleryExtension {
		const targetPlatform = getTargetPlatform(platform, arch);
		const galleryExtension = <IGalleryExtension>Object.create({ name, publisher: 'pub', version: '1.0.0', allTargetPlatforms: [targetPlatform], properties: {}, assets: {}, ...properties });
		galleryExtension.properties = { ...galleryExtension.properties, dependencies: [], targetPlatform, ...galleryExtensionProperties };
		galleryExtension.assets = { ...galleryExtension.assets, ...assets };
		galleryExtension.identifier = { id: getGalleryExtensionId(galleryExtension.publisher, galleryExtension.name), uuid: generateUuid() };
		return <IGalleryExtension>galleryExtension;
	}

	function aPage<T>(objects: IGalleryExtension[] = [], total?: number): IPager<IGalleryExtension> {
		return { firstPage: objects, total: total ?? objects.length, pageSize: objects.length, getPage: () => null! };
	}

});
