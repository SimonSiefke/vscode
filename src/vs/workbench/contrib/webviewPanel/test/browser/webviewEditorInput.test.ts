/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { mainWindow } from '../../../../../base/browser/window.js';
import { RunOnceWorker } from '../../../../../base/common/async.js';
import { WindowTitle } from '../../../../browser/parts/titlebar/windowTitle.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { TestViewsService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../browser/webviewEditorInput.js';
import { IWebviewWorkbenchService, LazilyResolvedWebviewEditorInput } from '../../browser/webviewWorkbenchService.js';

suite('WebviewInput', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const init = { viewType: 'test.webview', providedId: 'test', name: 'Test', iconPath: undefined };

	class TestWebview extends mock<IOverlayWebview>() {
		disposeCount = 0;
		override setTitle(): void { }
		override dispose(): void {
			this.disposeCount++;
		}
	}

	class TransferableWebviewInput extends WebviewInput {
		transferTo(other: WebviewInput): WebviewInput | undefined {
			return this.transfer(other);
		}
	}

	function createDecorations() {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const decorations = store.add(instantiationService.createInstance(DecorationsService));
		store.add(decorations.registerDecorationsProvider({
			label: 'Test',
			onDidChange: Event.None,
			provideDecorations: () => undefined
		}));
		const cache = Reflect.get(decorations, '_data') as { get(uri: URI): object | undefined };
		return { decorations, cache };
	}

	test('queued window title update cannot recreate a disposed panel decoration', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const originalTitle = mainWindow.document.title;
		const clock = sinon.useFakeTimers();
		try {
			const activeChanges = store.add(new Emitter<void>());
			const decorations = store.add(instantiationService.createInstance(DecorationsService));
			store.add(decorations.registerDecorationsProvider({ label: 'Test', onDidChange: Event.None, provideDecorations: () => undefined }));
			const input = store.add(new WebviewInput(init, new TestWebview(), new TestThemeService(), decorations));
			let activeEditor: EditorInput | undefined = input;
			instantiationService.stub(IDecorationsService, decorations);
			instantiationService.stub(IViewsService, new TestViewsService());
			instantiationService.stub(IEditorService, new class extends mock<IEditorService>() {
				override get activeEditor() { return activeEditor; }
				override readonly onDidActiveEditorChange = activeChanges.event;
			});
			const title = store.add(instantiationService.createInstance(WindowTitle, mainWindow));
			// EditorGroupView defers closing inputs so that replacements can finish first.
			const closeWorker = store.add(new RunOnceWorker<EditorInput>(() => {
				activeEditor = undefined;
				activeChanges.fire();
				input.dispose();
			}, 0));
			store.add(input.onWillDispose(() => closeWorker.work(input)));
			try {
				activeChanges.fire();
				await clock.runAllAsync();
				const cache = Reflect.get(decorations, '_data') as { get(uri: URI): object | undefined };
				assert.ok(cache.get(input.resource));
				input.setWebviewTitle('Closing');
				input.dispose();
				assert.strictEqual(cache.get(input.resource), undefined);
				await clock.runAllAsync();
				assert.deepStrictEqual({ activeEditor, cached: cache.get(input.resource) }, { activeEditor: undefined, cached: undefined });
			} finally {
				title.dispose();
				closeWorker.dispose();
				input.dispose();
				decorations.dispose();
				await clock.runAllAsync();
			}
		} finally {
			clock.restore();
			mainWindow.document.title = originalTitle;
		}
	});

	test('clears cached decorations when disposed', () => {
		const { decorations, cache } = createDecorations();
		const webview = new TestWebview();
		const input = store.add(new WebviewInput(init, webview, new TestThemeService(), decorations));
		const other = store.add(new WebviewInput(init, new TestWebview(), new TestThemeService(), decorations));
		const resource = input.resource;
		decorations.getDecoration(resource, false);
		decorations.getDecoration(other.resource, false);

		input.dispose();
		input.dispose();

		assert.deepStrictEqual({ cached: cache.get(resource), otherCached: !!cache.get(other.resource), disposeCount: webview.disposeCount }, {
			cached: undefined, otherCached: true, disposeCount: 1
		});
	});

	test('clears cached decorations for revived webviews', () => {
		const { decorations, cache } = createDecorations();
		const input = store.add(new LazilyResolvedWebviewEditorInput(init, new TestWebview(), new TestThemeService(), new class extends mock<IWebviewWorkbenchService>() { }, decorations));
		const resource = input.resource;
		decorations.getDecoration(resource, false);

		input.dispose();

		assert.strictEqual(cache.get(resource), undefined);
	});

	test('clears the old input cache after a transfer while keeping the transferred webview alive', () => {
		const { decorations, cache } = createDecorations();
		const webview = new TestWebview();
		const input = store.add(new TransferableWebviewInput(init, webview, new TestThemeService(), decorations));
		const target = store.add(new WebviewInput(init, webview, new TestThemeService(), decorations));
		const resource = input.resource;
		decorations.getDecoration(resource, false);
		decorations.getDecoration(target.resource, false);

		assert.strictEqual(input.transferTo(target), target);
		input.dispose();

		assert.deepStrictEqual({ cached: cache.get(resource), targetCached: !!cache.get(target.resource), disposeCount: webview.disposeCount }, {
			cached: undefined, targetCached: true, disposeCount: 0
		});
		target.dispose();
		assert.strictEqual(webview.disposeCount, 1);
	});

	test('keeps cached decorations for file-backed subclasses', () => {
		const { decorations, cache } = createDecorations();
		const input = store.add(new class extends WebviewInput {
			override get resource(): URI { return URI.file('/test.md'); }
		}(init, new TestWebview(), new TestThemeService(), decorations));
		const resource = input.resource;
		decorations.getDecoration(resource, false);

		input.dispose();

		assert.ok(cache.get(resource));
	});
});
