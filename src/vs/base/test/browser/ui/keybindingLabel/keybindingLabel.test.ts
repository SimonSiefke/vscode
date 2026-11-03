/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeybindingLabel, unthemedKeybindingLabelOptions } from '../../../../browser/ui/keybindingLabel/keybindingLabel.js';
import { mainWindow } from '../../../../browser/window.js';
import { ResolvedChord, ResolvedKeybinding } from '../../../../common/keybindings.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { OperatingSystem } from '../../../../common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('KeybindingLabel key styling', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps key styles through highlighted chords, replacement keys and the unbound state', () => {
		const host = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(host);
		store.add(toDisposable(() => host.remove()));
		const style = host.appendChild(mainWindow.document.createElement('style'));
		style.textContent = '.monaco-keybinding > .monaco-keybinding-key:where(.test-created-keybinding-key) { padding-left: 9px; }';
		const label = store.add(new KeybindingLabel(host, OperatingSystem.Windows, { ...unthemedKeybindingLabelOptions, keyClassName: 'test-created-keybinding-key', renderUnboundKeybindings: true }));
		const read = () => Array.from(label.element.querySelectorAll('.monaco-keybinding-key'), element => ({ text: element.textContent, padding: mainWindow.getComputedStyle(element).paddingLeft, highlighted: element.classList.contains('highlight') }));
		const binding = (chords: ResolvedChord[]) => new class extends ResolvedKeybinding {
			override getChords() { return chords; }
			override getLabel() { return 'Test keybinding'; }
			override getAriaLabel() { return 'Test keybinding'; }
			override getElectronAccelerator() { return null; }
			override getUserSettingsLabel() { return null; }
			override isWYSIWYG() { return true; }
			override hasMultipleChords() { return chords.length > 1; }
			override getDispatchChords() { return chords.map(() => null); }
			override getSingleModifierDispatchChords() { return chords.map(() => null); }
		}();
		label.set(binding([
			new ResolvedChord(true, false, false, false, 'K', 'K'),
			new ResolvedChord(true, false, false, false, 'C', 'C'),
		]), { firstPart: { ctrlKey: true, keyCode: true }, chordPart: {} });
		const chord = read();
		label.set(binding([new ResolvedChord(false, true, false, false, 'Enter', 'Enter')]));
		const replacement = read();
		label.set(undefined);
		assert.deepStrictEqual({ chord, replacement, unbound: read() }, {
			chord: [
				{ text: 'Ctrl', padding: '9px', highlighted: true },
				{ text: 'K', padding: '9px', highlighted: true },
				{ text: 'Ctrl', padding: '9px', highlighted: false },
				{ text: 'C', padding: '9px', highlighted: false },
			],
			replacement: [{ text: 'Shift', padding: '9px', highlighted: false }, { text: 'Enter', padding: '9px', highlighted: false }],
			unbound: [{ text: 'Unbound', padding: '9px', highlighted: false }],
		});
	});
});
