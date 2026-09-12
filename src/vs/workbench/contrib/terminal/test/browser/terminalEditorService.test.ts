/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TerminalEditorInput } from '../../browser/terminalEditorInput.js';
import { TerminalEditorService } from '../../browser/terminalEditorService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('Workbench - TerminalEditorService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('should dispose cached editor inputs', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const terminalEditorService = store.add(instantiationService.createInstance(TerminalEditorService));
		let didDisposeInput = false;
		const input = {
			dispose: () => {
				didDisposeInput = true;
			}
		} as unknown as TerminalEditorInput;
		const editorInputs = Reflect.get(terminalEditorService, '_editorInputs') as Map<string, TerminalEditorInput>;
		editorInputs.set('terminal-input', input);

		terminalEditorService.dispose();

		strictEqual(didDisposeInput, true);
	});
});
