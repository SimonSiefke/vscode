/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { ICustomEditorLabelService } from '../../../../services/editor/common/customEditorLabelService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { CustomEditorInput } from '../../browser/customEditorInput.js';
import { ICustomEditorModel, ICustomEditorService } from '../../common/customEditor.js';
import { CustomEditorModelManager } from '../../common/customEditorModelManager.js';

suite('CustomEditorInput', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/file.custom');
	const target = URI.file('/workspace/saved.custom');
	const viewType = 'test.customEditor';

	async function createInput(expectedRetains = 1) {
		const dirty = store.add(new Emitter<void>());
		const readonly = store.add(new Emitter<void>());
		const disposed = store.add(new Emitter<void>());
		const retained = new DeferredPromise<void>();
		const pendingRetains: DeferredPromise<void>[] = [];
		const picker = new DeferredPromise<URI | undefined>();
		const pickerOpened = new DeferredPromise<void>();
		const saves: URI[] = [];
		let disposeCount = 0;
		let delayRetain = false;
		const model = new class extends mock<ICustomEditorModel>() {
			override onDidChangeDirty = dirty.event;
			override onDidChangeReadonly = readonly.event;
			override isDirty() { return false; }
			override isReadonly() { return false; }
			override async saveCustomEditorAs(_resource: URI, target: URI) { saves.push(target); return true; }
			override dispose() { disposeCount++; }
		};
		const models = new class extends CustomEditorModelManager {
			override tryRetain(resource: URI, viewType: string) {
				const reference = super.tryRetain(resource, viewType);
				if (!delayRetain) {
					return reference;
				}
				const pending = new DeferredPromise<void>();
				pendingRetains.push(pending);
				if (pendingRetains.length === expectedRetains) {
					retained.complete();
				}
				return reference?.then(async ref => { await pending.p; return ref; });
			}
		};
		const externalReference = await models.add(resource, viewType, Promise.resolve(model));
		store.add(externalReference);
		delayRetain = true;
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IThemeService, new TestThemeService());
		instantiationService.stub(IWebviewWorkbenchService, { resolveWebview: async () => { } });
		instantiationService.stub(ICustomEditorService, { models, getCustomEditorCapabilities: () => undefined });
		instantiationService.stub(ILabelService, { onDidChangeFormatters: Event.None });
		instantiationService.stub(IFileService, { onDidChangeFileSystemProviderRegistrations: Event.None, onDidChangeFileSystemProviderCapabilities: Event.None });
		instantiationService.stub(IFilesConfigurationService, { onDidChangeReadonly: Event.None, isReadonly: () => false });
		instantiationService.stub(ICustomEditorLabelService, { onDidChange: Event.None });
		instantiationService.stub(IFileDialogService, { pickFileToSave: () => { pickerOpened.complete(); return picker.p; } });
		instantiationService.stub(IUndoRedoService, {});
		instantiationService.stub(IEditorGroupsService, {});
		instantiationService.stub(IWorkbenchLayoutService, {});
		const webview = new class extends mock<IOverlayWebview>() {
			override onDidDispose = disposed.event;
			override dispose() { disposed.fire(); }
		};
		const input = store.add(instantiationService.createInstance(CustomEditorInput, { resource, viewType, webviewTitle: undefined, preferredName: 'file.custom', iconPath: undefined }, webview, {}));
		return { input, webview, models, retained, pendingRetains, externalReference, dirty, readonly, picker, pickerOpened, saves, disposeCount: () => disposeCount };
	}

	for (const count of [1, 2, 37]) {
		for (const reversed of [false, true]) {
			test(`releases references and listeners after ${count} resolutions completed in ${reversed ? 'reverse' : 'request'} order`, async () => {
				const fixture = await createInput(count);
				const resolving = Array.from({ length: count }, () => fixture.input.resolve());
				await fixture.retained.p;
				for (const pending of reversed ? fixture.pendingRetains.toReversed() : fixture.pendingRetains) {
					await pending.complete();
					await timeout(0);
				}
				await Promise.all(resolving);
				let dirtyChanges = 0;
				let readonlyChanges = 0;
				store.add(fixture.input.onDidChangeDirty(() => dirtyChanges++));
				store.add(fixture.input.onDidChangeCapabilities(() => readonlyChanges++));
				fixture.dirty.fire();
				fixture.readonly.fire();
				fixture.externalReference.dispose();
				fixture.input.dispose();
				await timeout(0);
				assert.deepStrictEqual({ dirtyChanges, readonlyChanges, dirtyListeners: fixture.dirty.hasListeners(), readonlyListeners: fixture.readonly.hasListeners(), disposeCount: fixture.disposeCount(), knownModel: await fixture.models.get(resource, viewType) }, {
					dirtyChanges: 1, readonlyChanges: 1, dirtyListeners: false, readonlyListeners: false, disposeCount: 1, knownModel: undefined,
				});
			});
		}
	}

	for (const disposeInput of [false, true]) {
		test(`releases a model acquired after ${disposeInput ? 'input' : 'panel'} disposal`, async () => {
			const fixture = await createInput();
			const resolving = fixture.input.resolve();
			await fixture.retained.p;
			if (disposeInput) {
				fixture.input.dispose();
			} else {
				fixture.webview.dispose();
			}
			fixture.externalReference.dispose();
			await fixture.pendingRetains[0].complete();
			await resolving;
			await timeout(0);
			assert.deepStrictEqual({ dirtyListeners: fixture.dirty.hasListeners(), readonlyListeners: fixture.readonly.hasListeners(), disposeCount: fixture.disposeCount(), knownModel: await fixture.models.get(resource, viewType) }, {
				dirtyListeners: false, readonlyListeners: false, disposeCount: 1, knownModel: undefined,
			});
		});
	}

	for (const outcome of ['save', 'cancel', 'dispose panel', 'dispose input'] as const) {
		test(`Save As handles ${outcome} while the file picker is open`, async () => {
			const fixture = await createInput();
			const resolving = fixture.input.resolve();
			await fixture.retained.p;
			await fixture.pendingRetains[0].complete();
			await resolving;
			const saving = fixture.input.saveAs(1);
			await fixture.pickerOpened.p;
			if (outcome === 'dispose panel') {
				fixture.webview.dispose();
			} else if (outcome === 'dispose input') {
				fixture.input.dispose();
			}
			await fixture.picker.complete(outcome === 'cancel' ? undefined : target);
			assert.deepStrictEqual({ result: await saving, saves: fixture.saves }, {
				result: outcome === 'save' ? { resource: target } : undefined,
				saves: outcome === 'save' ? [target] : [],
			});
		});
	}
});
