/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../browser/webviewEditorInput.js';
import { IWebviewWorkbenchService, LazilyResolvedWebviewEditorInput } from '../../browser/webviewWorkbenchService.js';

suite('WebviewInput', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const init = { viewType: 'test.webview', providedId: 'test', name: 'Test', iconPath: undefined };

	class TestWebview extends mock<IOverlayWebview>() {
		disposeCount = 0;
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
