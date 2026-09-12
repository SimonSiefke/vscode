/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { applyWorkbenchContainment, registerWorkbenchContainment } from '../../browser/containment.js';

suite('Workbench Containment', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createContainer(): HTMLElement {
		const container = document.createElement('div');
		container.classList.add('monaco-workbench');
		disposables.add({
			dispose: () => container.remove()
		});
		return container;
	}

	test('marks default elements with strict containment', () => {
		const container = createContainer();
		const child = document.createElement('div');
		container.appendChild(child);

		applyWorkbenchContainment(container);

		assert.deepStrictEqual({
			container: Array.from(container.classList),
			child: Array.from(child.classList)
		}, {
			container: ['monaco-workbench', 'contain'],
			child: ['contain']
		});
	});

	test('marks content tags and content widgets with content containment', () => {
		const container = createContainer();
		const span = document.createElement('span');
		const editor = document.createElement('div');
		editor.classList.add('monaco-editor');
		const editorChild = document.createElement('div');
		editor.appendChild(editorChild);
		container.append(span, editor);

		applyWorkbenchContainment(container);

		assert.deepStrictEqual({
			span: Array.from(span.classList),
			editor: Array.from(editor.classList),
			editorChild: Array.from(editorChild.classList)
		}, {
			span: ['contain-content'],
			editor: ['monaco-editor', 'contain-content'],
			editorChild: ['contain-content']
		});
	});

	test('content containment wins over strict containment', () => {
		const container = createContainer();
		const button = document.createElement('button');
		button.classList.add('contain');
		container.appendChild(button);

		applyWorkbenchContainment(container);

		assert.deepStrictEqual(Array.from(button.classList), ['contain-content']);
	});

	test('annotates dynamically appended subtrees', async () => {
		const container = createContainer();
		const store = disposables.add(new DisposableStore());
		registerWorkbenchContainment(container, store);

		const editor = document.createElement('div');
		editor.classList.add('monaco-editor');
		const editorChild = document.createElement('div');
		editor.appendChild(editorChild);
		container.appendChild(editor);

		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual({
			editor: Array.from(editor.classList),
			editorChild: Array.from(editorChild.classList)
		}, {
			editor: ['monaco-editor', 'contain-content'],
			editorChild: ['contain-content']
		});
	});

	test('disposes dynamic annotation observer', async () => {
		const container = createContainer();
		const store = new DisposableStore();
		registerWorkbenchContainment(container, store);
		store.dispose();

		const child = document.createElement('div');
		container.appendChild(child);

		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(Array.from(child.classList), []);
	});
});
