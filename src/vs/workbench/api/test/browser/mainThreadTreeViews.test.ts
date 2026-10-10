/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import assert from 'assert';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { NullTelemetryService } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { MainThreadTreeViews } from '../../browser/mainThreadTreeViews.js';
import { DataTransferDTO, ExtHostTreeViewsShape } from '../../common/extHost.protocol.js';
import { CustomTreeView } from '../../../browser/parts/views/treeView.js';
import { Extensions, ITreeItem, ITreeView, ITreeViewDescriptor, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, TreeItemCollapsibleState, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { ExtensionHostKind } from '../../../services/extensions/common/extensionHostKind.js';
import { ViewDescriptorService } from '../../../services/views/browser/viewDescriptorService.js';
import { TestViewsService, workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestExtensionService } from '../../../test/common/workbenchTestServices.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Mimes } from '../../../../base/common/mime.js';
import { URI } from '../../../../base/common/uri.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { createFileDataTransferItem, VSDataTransfer } from '../../../../base/common/dataTransfer.js';

suite('MainThreadHostTreeView', function () {
	const testTreeViewId = 'testTreeView';
	const customValue = 'customValue';
	const ViewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);

	interface CustomTreeItem extends ITreeItem {
		customProp: string;
	}

	class MockExtHostTreeViewsShape extends mock<ExtHostTreeViewsShape>() {
		dropHandler: ExtHostTreeViewsShape['$handleDrop'] | undefined;

		override $handleDrop(...args: Parameters<ExtHostTreeViewsShape['$handleDrop']>): Promise<void> {
			return this.dropHandler?.(...args) ?? Promise.resolve();
		}
		override async $getChildren(treeViewId: string, treeItemHandle?: string[]): Promise<(number | ITreeItem)[][]> {
			return [[0, <CustomTreeItem>{ handle: 'testItem1', collapsibleState: TreeItemCollapsibleState.Expanded, customProp: customValue }]];
		}

		override async $hasResolve(): Promise<boolean> {
			return false;
		}

		override $setVisible(): void { }
	}

	let container: ViewContainer;
	let mainThreadTreeViews: MainThreadTreeViews;
	let extHostTreeViewsShape: MockExtHostTreeViewsShape;
	let instantiationService: TestInstantiationService;

	teardown(() => {
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(container), container);
	});

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	setup(async () => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		const viewDescriptorService = disposables.add(instantiationService.createInstance(ViewDescriptorService));
		instantiationService.stub(IViewDescriptorService, viewDescriptorService);
		// eslint-disable-next-line local/code-no-any-casts
		container = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({ id: 'testContainer', title: nls.localize2('test', 'test'), ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const viewDescriptor: ITreeViewDescriptor = {
			id: testTreeViewId,
			ctorDescriptor: null!,
			name: nls.localize2('Test View 1', 'Test View 1'),
			treeView: disposables.add(instantiationService.createInstance(CustomTreeView, 'testTree', 'Test Title', 'extension.id')),
		};
		ViewsRegistry.registerViews([viewDescriptor], container);

		const testExtensionService = new TestExtensionService();
		extHostTreeViewsShape = new MockExtHostTreeViewsShape();
		mainThreadTreeViews = disposables.add(new MainThreadTreeViews(
			new class implements IExtHostContext {
				remoteAuthority = '';
				extensionHostKind = ExtensionHostKind.LocalProcess;
				dispose() { }
				assertRegistered() { }
				set(v: any): any { return null; }
				getProxy(): any {
					return extHostTreeViewsShape;
				}
				drain(): any { return null; }
			}, new TestViewsService(), new TestNotificationService(), testExtensionService, new NullLogService(), NullTelemetryService));
		mainThreadTreeViews.$registerTreeViewDataProvider(testTreeViewId, { showCollapseAll: false, canSelectMany: false, dropMimeTypes: [], dragMimeTypes: [], hasHandleDrag: false, hasHandleDrop: false, manuallyManageCheckboxes: false });
		await testExtensionService.whenInstalledExtensionsRegistered();
	});

	test('getChildren keeps custom properties', async () => {
		const treeView: ITreeView = (<ITreeViewDescriptor>ViewsRegistry.getView(testTreeViewId)).treeView;
		const children = await treeView.dataProvider?.getChildren({ handle: 'root', collapsibleState: TreeItemCollapsibleState.Expanded });
		assert(children!.length === 1, 'Exactly one child should be returned');
		assert((<CustomTreeItem>children![0]).customProp === customValue, 'Tree Items should keep custom properties');
	});

	async function registerDropController() {
		await mainThreadTreeViews.$registerTreeViewDataProvider(testTreeViewId, {
			showCollapseAll: false, canSelectMany: false, dropMimeTypes: ['application/octet-stream'], dragMimeTypes: [], hasHandleDrag: false, hasHandleDrop: true, manuallyManageCheckboxes: false
		});
		return (ViewsRegistry.getView(testTreeViewId) as ITreeViewDescriptor).treeView.dragAndDropController!;
	}

	function fileTransfer(bytes: number[]) {
		const transfer = new VSDataTransfer();
		transfer.replace('application/octet-stream', createFileDataTransferItem('test.bin', undefined, async () => Uint8Array.from(bytes), 'same-file-id'));
		return transfer;
	}

	for (const replace of [false, true]) {
		test(`pending drop can perform its first file read after tree disposal (replacement: ${replace})`, async () => {
			const started = new DeferredPromise<{ requestId: number; fileId: string }>();
			const resume = new DeferredPromise<void>();
			extHostTreeViewsShape.dropHandler = async (viewId, requestId, dto) => {
				const fileId = dto.items[0][1].fileData!.id;
				await started.complete({ requestId, fileId });
				await resume.p;
				assert.deepStrictEqual(Array.from((await mainThreadTreeViews.$resolveDropFileData(viewId, requestId, fileId)).buffer), [7, 8]);
			};
			const controller = await registerDropController();
			const completed = assert.doesNotReject(controller.handleDrop(fileTransfer([7, 8]), undefined, CancellationToken.None));
			const request = await started.p;
			await mainThreadTreeViews.$disposeTree(testTreeViewId);
			assert.strictEqual((Reflect.get(mainThreadTreeViews, '_dndControllers') as Map<string, object>).size, 0);
			if (replace) {
				await registerDropController();
			}
			await resume.complete();
			await completed;
			assert.throws(() => mainThreadTreeViews.$resolveDropFileData(testTreeViewId, request.requestId, request.fileId));
		});
	}

	test('overlapping drop generations keep independent files and release each request on settlement', async () => {
		const starts = [new DeferredPromise<{ requestId: number; fileId: string }>(), new DeferredPromise<{ requestId: number; fileId: string }>()];
		const gates = [new DeferredPromise<void>(), new DeferredPromise<void>()];
		let index = 0;
		extHostTreeViewsShape.dropHandler = async (_viewId, requestId, dto) => {
			const current = index++;
			await starts[current].complete({ requestId, fileId: dto.items[0][1].fileData!.id });
			await gates[current].p;
		};
		const oldController = await registerDropController();
		const oldDrop = oldController.handleDrop(fileTransfer([7, 8]), undefined, CancellationToken.None);
		const oldId = await starts[0].p;
		await mainThreadTreeViews.$disposeTree(testTreeViewId);
		const newController = await registerDropController();
		const newDrop = newController.handleDrop(fileTransfer([9, 10]), undefined, CancellationToken.None);
		const newId = await starts[1].p;
		try {
			assert.notStrictEqual(oldId.requestId, newId.requestId);
			assert.throws(() => mainThreadTreeViews.$resolveDropFileData('another-tree', oldId.requestId, oldId.fileId));
			const read = async (request: { requestId: number; fileId: string }) => Array.from((await mainThreadTreeViews.$resolveDropFileData(testTreeViewId, request.requestId, request.fileId)).buffer);
			assert.deepStrictEqual([await read(oldId), await read(newId)], [[7, 8], [9, 10]]);
			await gates[0].complete();
			await oldDrop;
			assert.throws(() => mainThreadTreeViews.$resolveDropFileData(testTreeViewId, oldId.requestId, oldId.fileId));
			assert.deepStrictEqual(await read(newId), [9, 10]);
		} finally {
			await gates[0].complete();
			await gates[1].complete();
			await Promise.allSettled([oldDrop, newDrop]);
		}
		assert.strictEqual((Reflect.get(mainThreadTreeViews, '_dropRequests') as Map<number, string>).size, 0);
		assert.throws(() => mainThreadTreeViews.$resolveDropFileData(testTreeViewId, newId.requestId, newId.fileId));
	});

	for (const completion of ['cancelled', 'error'] as const) {
		test(`drop file requests are released after ${completion}`, async () => {
			const error = new Error('drop failed');
			extHostTreeViewsShape.dropHandler = async () => { throw error; };
			const controller = await registerDropController();
			const drop = controller.handleDrop(fileTransfer([7, 8]), undefined, completion === 'cancelled' ? CancellationToken.Cancelled : CancellationToken.None);
			if (completion === 'error') {
				await assert.rejects(drop, error);
			} else {
				await drop;
			}
			const cache = Reflect.get(controller, 'dataTransfersCache') as { readonly dataTransferFiles: Map<number, object> };
			assert.strictEqual(cache.dataTransferFiles.size, 0);
		});
	}

	test('handleDrag reconstructs URI list from uriListData', async () => {
		const testTreeViewIdWithDrag = 'testTreeViewWithDrag';

		// Create a mock that returns URI list data
		const mockExtHostWithDrag = new class extends mock<ExtHostTreeViewsShape>() {
			override async $getChildren(treeViewId: string, treeItemHandle?: string[]): Promise<(number | ITreeItem)[][]> {
				return [[0, { handle: 'item1', collapsibleState: TreeItemCollapsibleState.None }]];
			}

			override async $hasResolve(): Promise<boolean> {
				return false;
			}

			override $setVisible(): void { }

			override async $handleDrag(_sourceViewId: string, _sourceTreeItemHandles: string[], _operationUuid: string, _token: CancellationToken): Promise<DataTransferDTO | undefined> {
				// Return a DataTransferDTO with text/uri-list containing uriListData
				// This simulates what the extension host sends after URI transformation
				return {
					items: [
						[Mimes.uriList, {
							id: 'test-id',
							// This is the original (untransformed) string - should NOT be used
							asString: 'file:///original/untransformed/path.txt',
							fileData: undefined,
							// This is the transformed URI data - should be used
							uriListData: [
								{ scheme: 'file', authority: '', path: '/transformed/correct/path.txt', query: '', fragment: '' }
							]
						}]
					]
				};
			}
		}();

		// Register a view with drag support
		const viewDescriptorWithDrag: ITreeViewDescriptor = {
			id: testTreeViewIdWithDrag,
			ctorDescriptor: null!,
			name: nls.localize2('Test View 2', 'Test View 2'),
			treeView: disposables.add(instantiationService.createInstance(CustomTreeView, 'testTree2', 'Test Title 2', 'extension.id')),
		};
		ViewsRegistry.registerViews([viewDescriptorWithDrag], container);

		const dragTestExtensionService = new TestExtensionService();
		const dragTestMainThreadTreeViews = disposables.add(new MainThreadTreeViews(
			new class implements IExtHostContext {
				remoteAuthority = '';
				extensionHostKind = ExtensionHostKind.LocalProcess;
				dispose() { }
				assertRegistered() { }
				set(v: any): any { return null; }
				getProxy(): any {
					return mockExtHostWithDrag;
				}
				drain(): any { return null; }
			}, new TestViewsService(), new TestNotificationService(), dragTestExtensionService, new NullLogService(), NullTelemetryService));
		dragTestMainThreadTreeViews.$registerTreeViewDataProvider(testTreeViewIdWithDrag, {
			showCollapseAll: false,
			canSelectMany: false,
			dropMimeTypes: [],
			dragMimeTypes: [Mimes.uriList],
			hasHandleDrag: true,
			hasHandleDrop: false,
			manuallyManageCheckboxes: false
		});
		await dragTestExtensionService.whenInstalledExtensionsRegistered();

		// Get the tree view and its drag controller
		const dragTestTreeView: ITreeView = (<ITreeViewDescriptor>ViewsRegistry.getView(testTreeViewIdWithDrag)).treeView;
		const dragController = dragTestTreeView.dragAndDropController;
		assert(dragController, 'Drag controller should exist');

		// Call handleDrag
		const result = await dragController.handleDrag(['item1'], 'test-operation-uuid', CancellationToken.None);
		assert(result, 'Result should not be undefined');

		// Verify that the URI list was reconstructed from uriListData, not asString
		const uriListItem = result.get(Mimes.uriList);
		assert(uriListItem, 'URI list item should exist');

		const uriListValue = await uriListItem.asString();
		// The value should be the transformed URI, not the original untransformed one
		assert.strictEqual(uriListValue, URI.from({ scheme: 'file', authority: '', path: '/transformed/correct/path.txt', query: '', fragment: '' }).toString());
	});


});
