/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { OS } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { KeybindingsRegistry } from '../../common/keybindingsRegistry.js';

suite('KeybindingsRegistry', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposal removes primary and secondary bindings from a warm cache and platform rules', () => {
		const removedId = 'test.keybindingsRegistry.removed';
		const remainingId = 'test.keybindingsRegistry.remaining';
		const registration = disposables.add(KeybindingsRegistry.registerKeybindingRule({
			id: removedId, weight: 0, primary: KeyCode.KeyA, secondary: [KeyCode.KeyB],
		}));
		disposables.add(KeybindingsRegistry.registerKeybindingRule({ id: remainingId, weight: 0, primary: KeyCode.KeyC }));
		const before = KeybindingsRegistry.getDefaultKeybindings().filter(binding => binding.command === removedId).length;
		registration.dispose();
		registration.dispose();
		assert.deepStrictEqual({
			before,
			removed: KeybindingsRegistry.getDefaultKeybindings().filter(binding => binding.command === removedId).length,
			remaining: KeybindingsRegistry.getDefaultKeybindings().filter(binding => binding.command === remainingId).length,
			platformRemoved: KeybindingsRegistry.getDefaultKeybindingsForOS(OS).filter(binding => binding.command === removedId).length,
		}, { before: 2, removed: 0, remaining: 1, platformRemoved: 0 });
	});
});
