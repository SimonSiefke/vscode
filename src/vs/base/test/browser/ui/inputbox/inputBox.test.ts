/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getWindow } from '../../../../browser/dom.js';
import { FindInput } from '../../../../browser/ui/findinput/findInput.js';
import { InputBox, MessageType, unthemedInboxStyles } from '../../../../browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../browser/ui/toggle/toggle.js';
import { timeout } from '../../../../common/async.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('InputBox owner styling', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('applies the creation class before styles initialize and retains it through validation and value changes', async () => {
		const container = document.createElement('div');
		container.style.cssText = 'position: fixed; top: 0; left: 0;';
		const style = document.createElement('style');
		style.textContent = '.test-owned-input-box { padding-left: 7px; }';
		document.body.append(container, style);
		store.add(toDisposable(() => { container.remove(); style.remove(); }));
		const input = store.add(new class extends InputBox {
			protected override applyStyles(): void {
				assert.strictEqual(getWindow(this.element).getComputedStyle(this.element).paddingLeft, '7px');
				super.applyStyles();
			}
		}(container, undefined, {
			inputBoxClassName: 'test-owned-input-box',
			inputBoxStyles: unthemedInboxStyles,
			validationOptions: { validation: value => value === 'bad' ? { type: MessageType.ERROR, content: 'Invalid' } : null }
		}));
		input.value = 'bad';
		assert.strictEqual(input.validate(), MessageType.ERROR);
		assert.strictEqual(input.inputElement.getAttribute('aria-invalid'), 'true');
		input.value = 'valid';
		assert.strictEqual(input.validate(), undefined);
		assert.strictEqual(input.inputElement.hasAttribute('aria-invalid'), false);
		input.focus();
		input.disable();
		input.enable();
		assert.strictEqual(getWindow(input.element).getComputedStyle(input.element).paddingLeft, '7px');
		const neighbor = store.add(new InputBox(container, undefined, { inputBoxStyles: unthemedInboxStyles }));
		assert.strictEqual(neighbor.element.classList.contains('test-owned-input-box'), false);
		await timeout(0);
	});

	test('the real find input keeps its original font and full width through updates', async () => {
		const container = document.createElement('div');
		container.style.cssText = 'position: fixed; top: 0; left: 0; width: 160px;';
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const input = store.add(new FindInput(container, undefined, {
			label: 'Find',
			inputBoxStyles: unthemedInboxStyles,
			toggleStyles: unthemedToggleStyles
		}));
		for (const value of ['one', 'two', '']) {
			input.setValue(value);
			const style = getWindow(input.inputBox.element).getComputedStyle(input.inputBox.element);
			assert.strictEqual(style.fontSize, '13px');
			assert.strictEqual(input.inputBox.element.getBoundingClientRect().width, 160);
		}
		await timeout(0);
	});
});
