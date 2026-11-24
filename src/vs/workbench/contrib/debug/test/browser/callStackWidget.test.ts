/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { CallStackWidget, CustomStackFrame } from '../../browser/callStackWidget.js';

suite('CallStackWidget', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('collapse button styling survives icon updates and frame replacement', () => {
		const container = append(document.body, $('div'));
		disposables.add(toDisposable(() => container.remove()));
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const widget = disposables.add(instantiationService.createInstance(CallStackWidget, container, undefined));
		const frame = new class extends CustomStackFrame {
			readonly height = observableValue('test frame height', 40);
			readonly label = 'Custom frame';
			render(container: HTMLElement) {
				const content = append(container, $('div', undefined, 'Frame content'));
				return toDisposable(() => content.remove());
			}
		}();
		widget.layout(300, 600);
		widget.setFrames([frame]);
		const states: { cursor: string; expanded: string | null }[] = [];
		const sample = () => {
			const button = container.querySelector<HTMLElement>('.collapse-button a')!;
			states.push({ cursor: getWindow(button).getComputedStyle(button).cursor, expanded: button.getAttribute('aria-expanded') });
			return button;
		};
		sample();
		widget.collapseAll();
		sample().click();
		sample();
		widget.setFrames([frame]);
		sample();
		assert.deepStrictEqual(states, [
			{ cursor: 'pointer', expanded: 'true' },
			{ cursor: 'pointer', expanded: 'false' },
			{ cursor: 'pointer', expanded: 'true' },
			{ cursor: 'pointer', expanded: 'true' },
		]);
	});
});
