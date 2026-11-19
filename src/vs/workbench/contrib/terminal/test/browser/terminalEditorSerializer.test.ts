/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, throws } from 'assert';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IDeserializedTerminalEditorInput, ITerminalEditorService, ITerminalInstance } from '../../browser/terminal.js';
import { TerminalEditorInput } from '../../browser/terminalEditorInput.js';
import { TerminalInputSerializer } from '../../browser/terminalEditorSerializer.js';

suite('TerminalInputSerializer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('persists the current attachment identity through editor restore', () => {
		const restored: IDeserializedTerminalEditorInput[] = [];
		const serializer = new TerminalInputSerializer(upcastPartial<ITerminalEditorService>({
			reviveInput: input => { restored.push(input); return upcastPartial<EditorInput>({}); }
		}));
		const input = upcastPartial<TerminalEditorInput>({ terminalInstance: upcastPartial<ITerminalInstance>({
			persistentProcessId: 17,
			persistentProcessCreationId: 'current owner',
			processId: 1234,
			shouldPersist: true,
			shellLaunchConfig: { attachPersistentProcess: upcastPartial<NonNullable<ITerminalInstance['shellLaunchConfig']['attachPersistentProcess']>>({ creationId: 'old owner' }) }
		}) });
		const serialized = serializer.serialize(input)!;
		serializer.deserialize(upcastPartial<IInstantiationService>({}), serialized);
		deepStrictEqual(restored.map(({ id, pid, creationId }) => ({ id, pid, creationId })), [{ id: 17, pid: 1234, creationId: 'current owner' }]);
	});

	test('accepts legacy editor state and rejects a malformed allocation identity', () => {
		const restored: IDeserializedTerminalEditorInput[] = [];
		const serializer = new TerminalInputSerializer(upcastPartial<ITerminalEditorService>({
			reviveInput: input => { restored.push(input); return upcastPartial<EditorInput>({}); }
		}));
		serializer.deserialize(upcastPartial<IInstantiationService>({}), JSON.stringify({ id: 17, pid: 1234 }));
		throws(() => serializer.deserialize(upcastPartial<IInstantiationService>({}), JSON.stringify({ id: 17, pid: 1234, creationId: 17 })));
		deepStrictEqual(restored, [{ id: 17, pid: 1234 }]);
	});
});
