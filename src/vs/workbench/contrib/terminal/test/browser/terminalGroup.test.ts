/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalInstance } from '../../browser/terminal.js';
import { TerminalGroup } from '../../browser/terminalGroup.js';

suite('TerminalGroup process layout', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('persists the current process generation and retains numeric legacy references', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const group = store.add(instantiationService.createInstance(TerminalGroup, undefined, undefined));
		let generation = 'original';
		for (const id of [1, 2, 3]) {
			group.addInstance(upcastPartial<ITerminalInstance>({
				instanceId: id,
				persistentProcessId: id,
				get persistentProcessCreationId() { return id === 1 ? generation : undefined; },
				shouldPersist: id !== 3,
				onDisposed: Event.None,
				onDidFocus: Event.None,
				capabilities: upcastPartial<ITerminalInstance['capabilities']>({ onDidChangeCapabilities: Event.None })
			}));
		}
		const before = group.getLayoutInfo(true);
		generation = 'current';
		const after = group.getLayoutInfo(false);
		deepStrictEqual([before, after], [
			{ isActive: true, activePersistentProcessId: 1, terminals: [{ relativeSize: 0, terminal: { id: 1, creationId: 'original' } }, { relativeSize: 0, terminal: 2 }] },
			{ isActive: false, activePersistentProcessId: 1, terminals: [{ relativeSize: 0, terminal: { id: 1, creationId: 'current' } }, { relativeSize: 0, terminal: 2 }] }
		]);
	});
});
