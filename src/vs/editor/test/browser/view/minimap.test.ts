/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../base/browser/window.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CodeEditorWidget } from '../../../browser/widget/codeEditor/codeEditorWidget.js';
import { createTextModel } from '../../common/testTextModel.js';
import { createCodeEditorServices } from '../testCodeEditor.js';

suite('Minimap layout', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createEditor() {
		const container = document.createElement('div');
		container.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; height: 300px;';
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const instantiationService = createCodeEditorServices(disposables);
		const editor = disposables.add(instantiationService.createInstance(CodeEditorWidget, container, {
			minimap: { enabled: true, size: 'fill' },
		}, { contributions: [] }));
		editor.setModel(disposables.add(createTextModel(Array.from({ length: 100 }, (_, line) => `line ${line}`).join('\n'))));
		editor.render(true);
		return { container, editor };
	}

	test('keeps the owner-assigned minimap bounds when resized and moved to the left', () => {
		const { container, editor } = createEditor();
		const assertBounds = () => {
			const minimap = container.querySelector<HTMLElement>('.minimap');
			assert.ok(minimap);
			const bounds = minimap.getBoundingClientRect();
			const layout = editor.getLayoutInfo();
			assert.strictEqual(bounds.width, layout.minimap.minimapWidth);
			assert.strictEqual(bounds.height, layout.height);
			assert.strictEqual(bounds.left - container.getBoundingClientRect().left, layout.minimap.minimapLeft);
			assert.strictEqual(mainWindow.getComputedStyle(minimap).contain, 'size layout style');
		};
		assertBounds();
		editor.layout({ width: 450, height: 200 });
		editor.updateOptions({ minimap: { side: 'left' } });
		editor.render(true);
		assertBounds();
	});

	test('allows the minimap shadow to extend outside its layout box', async () => {
		const { container, editor } = createEditor();
		editor.getModel()!.setValue('long line '.repeat(100));
		editor.render(true);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		editor.render(true);
		const minimap = container.querySelector<HTMLElement>('.minimap');
		assert.ok(minimap);
		const shadow = minimap.querySelector<HTMLElement>('.minimap-shadow-visible');
		assert.ok(shadow, minimap.outerHTML);
		// Enable hit testing to detect clipping of the normally non-interactive shadow.
		shadow.style.pointerEvents = 'auto';
		const bounds = shadow.getBoundingClientRect();
		assert.ok(bounds.left < minimap.getBoundingClientRect().left);
		assert.strictEqual(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 20), shadow);
	});

});
