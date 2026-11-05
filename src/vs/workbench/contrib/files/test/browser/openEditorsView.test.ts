/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { IListRenderer, IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { URI } from '../../../../../base/common/uri.js';
import { isDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OpenEditor } from '../../common/files.js';
import { findFirstDirtyEditor, OpenEditorRenderer } from '../../browser/views/openEditorsView.js';
import { TestEditorGroupView, TestEditorInput, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { DEFAULT_LABELS_CONTAINER, ResourceLabels } from '../../../../browser/labels.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';

suite('Files - OpenEditorsView', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	class TestDirtyEditorInput extends TestEditorInput {
		override isDirty(): boolean {
			return true;
		}
	}

	const delegate: IListVirtualDelegate<OpenEditor> = {
		getHeight: () => 20,
		getTemplateId: () => 'openEditor'
	};
	const renderer: IListRenderer<OpenEditor, void> = {
		templateId: 'openEditor',
		renderTemplate: () => undefined,
		renderElement: () => undefined,
		disposeTemplate: () => undefined
	};

	function createList(): List<OpenEditor> {
		const editorIds = new WeakMap<object, number>();
		let editorIdPool = 0;

		return store.add(new List<OpenEditor>('OpenEditors', document.createElement('div'), delegate, [renderer], {
			identityProvider: {
				getId: openEditor => {
					let editorId = editorIds.get(openEditor.editor);
					if (editorId === undefined) {
						editorId = editorIdPool++;
						editorIds.set(openEditor.editor, editorId);
					}

					return `openeditor:${openEditor.groupId}:${editorId}`;
				}
			}
		}));
	}

	function createEditorList(onDidChangeVisibility: Event<boolean> = DEFAULT_LABELS_CONTAINER.onDidChangeVisibility) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const configurationService = new TestConfigurationService({ explorer: { decorations: { colors: true, badges: true } } });
		instantiationService.stub(IConfigurationService, configurationService);
		const decorations = store.add(instantiationService.createInstance(DecorationsService));
		instantiationService.stub(IDecorationsService, decorations);
		const changes = store.add(new Emitter<URI[]>());
		const calls = new Map<string, number>();
		store.add(decorations.registerDecorationsProvider({
			label: 'Test',
			onDidChange: changes.event,
			provideDecorations: resource => {
				const key = resource.toString();
				calls.set(key, (calls.get(key) ?? 0) + 1);
				return undefined;
			}
		}));
		const labels = store.add(instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility }));
		const createInstance = sinon.spy(instantiationService, 'createInstance');
		const renderer = new OpenEditorRenderer(labels, instantiationService, instantiationService.get(IKeybindingService), configurationService);
		for (const action of createInstance.returnValues) {
			if (isDisposable(action)) {
				store.add(action);
			}
		}
		createInstance.restore();
		const container = document.createElement('div');
		const list = store.add(new List<OpenEditor>('OpenEditors', container, {
			getHeight: () => 20,
			getTemplateId: () => renderer.templateId
		}, [renderer]));
		list.layout(100, 400);
		const cache = Reflect.get(decorations, '_data') as { get(uri: URI): object | undefined };
		return { instantiationService, renderer, labels, list, container, decorations, changes, calls, cache };
	}

	test('pooled editor labels do not restore cleared decorations after a delayed notification', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const { list, container, decorations, changes, calls, cache } = createEditorList();
			const group = new TestEditorGroupView(1);
			const saved = store.add(new TestEditorInput(URI.file('/zzzz.txt'), 'testEditor'));
			list.splice(0, 0, [new OpenEditor(saved, group)]);
			const expired: boolean[] = [];
			const providerCalls: number[] = [];
			let pooledLabel: HTMLElement | undefined;
			let reused = true;
			for (let index = 0; index < 3; index++) {
				const resource = URI.parse(`search-editor:#${index}`);
				const input = store.add(new TestEditorInput(resource, 'testEditor'));
				list.splice(0, 0, [new OpenEditor(input, group)]);
				const label = container.querySelector<HTMLElement>('.monaco-icon-label')!;
				reused &&= !pooledLabel || pooledLabel === label;
				pooledLabel = label;
				await clock.runAllAsync();
				list.splice(0, 1);
				input.dispose();
				decorations.clearCachedDecorations(resource);
				await clock.runAllAsync();
				expired.push(cache.get(resource) === undefined);
				providerCalls.push(calls.get(resource.toString()) ?? 0);
			}
			changes.fire([saved.resource]);
			await clock.runAllAsync();
			assert.deepStrictEqual({ expired, providerCalls, reused, savedCalls: calls.get(saved.resource.toString()), liveCached: !!cache.get(saved.resource) }, {
				expired: [true, true, true], providerCalls: [1, 1, 1], reused: true, savedCalls: 2, liveCached: true
			});
		} finally {
			sinon.restore();
		}
	});

	for (const hidden of [true, false]) {
		test(`disposed webview labels stay cleared before ${hidden ? 'hidden' : 'visible'} rows are removed`, async () => {
			const clock = sinon.useFakeTimers();
			try {
				const visibility = store.add(new Emitter<boolean>());
				const { instantiationService, list, container, changes, calls, cache } = createEditorList(visibility.event);
				const group = new TestEditorGroupView(1);
				const saved = store.add(new TestEditorInput(URI.file('/saved.txt'), 'testEditor'));
				list.splice(0, 0, [new OpenEditor(saved, group)]);
				let pooledLabel: HTMLElement | undefined;
				for (let index = 0; index < 3; index++) {
					const input = store.add(instantiationService.createInstance(WebviewInput, {
						viewType: 'markdown.preview', providedId: undefined, name: 'Preview', iconPath: undefined
					}, new class extends mock<IOverlayWebview>() { override dispose(): void { } }));
					const resource = input.resource;
					list.splice(0, 0, [new OpenEditor(input, group)]);
					const label = container.querySelector<HTMLElement>('.monaco-icon-label')!;
					if (pooledLabel) {
						assert.strictEqual(label, pooledLabel, 'the same pooled label is reused');
					}
					pooledLabel = label;
					await clock.runAllAsync();
					assert.ok(cache.get(resource));
					if (hidden) {
						visibility.fire(false);
					}

					input.dispose();
					assert.strictEqual(cache.get(resource), undefined);
					await clock.tickAsync(1000); // Decoration debounce runs while the stale row still exists.
					assert.strictEqual(list.length, 2);
					if (hidden) {
						visibility.fire(true); // ResourceLabels redraws synchronously, before list refresh.
					}
					assert.strictEqual(cache.get(resource), undefined, 'the stale label must not recreate the cache entry');
					assert.strictEqual(calls.get(resource.toString()), 1);
					assert.strictEqual(label.textContent, '');

					setTimeout(() => list.splice(0, 1), 0);
					await clock.runAllAsync();
					assert.strictEqual(cache.get(resource), undefined, 'deferred row removal keeps the cache empty');
				}
				changes.fire([saved.resource]);
				await clock.runAllAsync();
				assert.strictEqual(calls.get(saved.resource.toString()), 2, 'live file labels still update');
				assert.ok(cache.get(saved.resource));
				assert.ok(container.textContent?.includes(saved.getName()));
			} finally {
				sinon.restore();
			}
		});
	}

	test('input disposal listeners follow the rendered item and template lifetime', () => {
		const { renderer } = createEditorList();
		const template = renderer.renderTemplate(document.createElement('div'));
		try {
			const group = new TestEditorGroupView(1);
			const first = store.add(new TestEditorInput(URI.file('/first.txt'), 'testEditor'));
			const second = store.add(new TestEditorInput(URI.file('/second.txt'), 'testEditor'));
			const firstRow = new OpenEditor(first, group);
			const secondRow = new OpenEditor(second, group);
			renderer.renderElement(firstRow, 0, template);
			renderer.renderElement(secondRow, 0, template);
			first.dispose();
			assert.ok(template.root.element.textContent?.includes(second.getName()));
			assert.strictEqual(template.actionRunner.editor, secondRow);
			renderer.renderElement(firstRow, 0, template);
			assert.deepStrictEqual({ text: template.root.element.textContent, editor: template.actionRunner.editor }, { text: '', editor: undefined });
			renderer.renderElement(secondRow, 0, template);

			renderer.disposeElement(secondRow, 0, template);
			assert.strictEqual(template.actionRunner.editor, undefined);
			const clear = sinon.spy(template.root, 'clear');
			second.dispose();
			assert.strictEqual(clear.callCount, 0, 'removing a row detaches its input listener');
			clear.restore();

			const third = store.add(new TestEditorInput(URI.file('/third.txt'), 'testEditor'));
			renderer.renderElement(new OpenEditor(third, group), 0, template);
		} finally {
			renderer.disposeTemplate(template);
		}
	});

	test('preserves multi-selection when an editor is refreshed', () => {
		const group = new TestEditorGroupView(1);
		const firstEditor = store.add(new TestEditorInput(URI.parse('test:/first'), 'testEditor'));
		const secondEditor = store.add(new TestEditorInput(URI.parse('test:/second'), 'testEditor'));
		const list = createList();

		list.splice(0, 0, [new OpenEditor(firstEditor, group), new OpenEditor(secondEditor, group)]);
		list.setSelection([0, 1]);
		list.splice(1, 1, [new OpenEditor(secondEditor, group)]);

		assert.deepStrictEqual(list.getSelection(), [0, 1]);
	});

	test('preserves multi-selection when editors are resorted', () => {
		const group = new TestEditorGroupView(1);
		const firstEditor = store.add(new TestEditorInput(URI.parse('test:/first'), 'testEditor'));
		const secondEditor = store.add(new TestEditorInput(URI.parse('test:/second'), 'testEditor'));
		const thirdEditor = store.add(new TestEditorInput(URI.parse('test:/third'), 'testEditor'));
		const list = createList();

		list.splice(0, 0, [new OpenEditor(firstEditor, group), new OpenEditor(secondEditor, group), new OpenEditor(thirdEditor, group)]);
		list.setSelection([0, 1]);
		list.splice(0, list.length, [new OpenEditor(thirdEditor, group), new OpenEditor(firstEditor, group), new OpenEditor(secondEditor, group)]);

		assert.deepStrictEqual(list.getSelection(), [1, 2]);
	});

	test('finds the first unsaved editor in index order', () => {
		const firstGroup = new TestEditorGroupView(1);
		const secondGroup = new TestEditorGroupView(2);
		const savedEditor = store.add(new TestEditorInput(URI.parse('test:/saved'), 'testEditor'));
		const firstDirtyEditor = store.add(new TestDirtyEditorInput(URI.parse('test:/firstDirty'), 'testEditor'));
		const secondDirtyEditor = store.add(new TestDirtyEditorInput(URI.parse('test:/secondDirty'), 'testEditor'));

		firstGroup.editors = [savedEditor];
		secondGroup.editors = [savedEditor, firstDirtyEditor, secondDirtyEditor];

		const firstDirty = findFirstDirtyEditor([firstGroup, secondGroup]);

		assert.deepStrictEqual({ editor: firstDirty?.editor, group: firstDirty?.group }, { editor: firstDirtyEditor, group: secondGroup });
	});

	test('finds no unsaved editor when all editors are saved', () => {
		const group = new TestEditorGroupView(1);
		const savedEditor = store.add(new TestEditorInput(URI.parse('test:/saved'), 'testEditor'));

		group.editors = [savedEditor];

		assert.strictEqual(findFirstDirtyEditor([group]), undefined);
	});
});
