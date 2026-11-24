/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindow } from '../../../../../base/browser/dom.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { TestColorTheme, TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { McpServerIconWidget } from '../../browser/mcpServerWidgets.js';
import { IWorkbenchMcpServer } from '../../common/mcpTypes.js';

suite('McpServerIconWidget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps shared icon dimensions through image, theme, fallback and server changes', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const themeService = new TestThemeService();
		const widget = store.add(new McpServerIconWidget(container, themeService));
		const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
		const server = upcastPartial<IWorkbenchMcpServer>({ icon: { dark: icon, light: icon } });
		widget.mcpServer = server;

		const image = container.querySelector('img')!;
		const glyph = container.querySelector<HTMLElement>('.codicon')!;
		const imageSize = () => {
			const style = getWindow(image).getComputedStyle(image);
			return [style.width, style.height, style.marginRight];
		};
		const glyphSize = () => {
			const style = getWindow(glyph).getComputedStyle(glyph);
			return [style.fontSize, style.paddingRight];
		};
		assert.deepStrictEqual(imageSize(), ['36px', '36px', '16px']);
		themeService.setTheme(new TestColorTheme({}, ColorScheme.LIGHT));
		assert.deepStrictEqual(imageSize(), ['36px', '36px', '16px']);

		image.dispatchEvent(new Event('error'));
		assert.strictEqual(glyph.style.display, 'inherit');
		assert.deepStrictEqual(glyphSize(), ['36px', '16px']);
		widget.mcpServer = null;
		widget.mcpServer = upcastPartial<IWorkbenchMcpServer>({ codicon: 'codicon-tools' });
		assert.strictEqual(glyph.classList.contains('codicon-tools'), true);
		assert.deepStrictEqual(glyphSize(), ['36px', '16px']);
		widget.mcpServer = server;
		assert.deepStrictEqual(imageSize(), ['36px', '36px', '16px']);
	});
});
