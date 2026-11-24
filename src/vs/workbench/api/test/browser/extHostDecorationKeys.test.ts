/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TextEditorCursorStyle } from '../../../../editor/common/config/editorOptions.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { MainThreadTextEditorsShape } from '../../common/extHost.protocol.js';
import { ExtHostDocumentData } from '../../common/extHostDocumentData.js';
import { ExtHostDocumentsAndEditors } from '../../common/extHostDocumentsAndEditors.js';
import { ExtHostTextEditor } from '../../common/extHostTextEditor.js';
import { ExtHostEditors } from '../../common/extHostTextEditors.js';
import { Range } from '../../common/extHostTypes.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('Extension host decoration keys', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let service: ExtHostEditors;
	let editors: ExtHostTextEditor[];
	let calls: { editor: string; key: string; ranges: number[] }[];

	setup(() => {
		calls = [];
		const proxy = new class extends mock<MainThreadTextEditorsShape>() {
			override $registerTextEditorDecorationType(): void { }
			override $removeTextEditorDecorationType(): void { }
			override async $trySetDecorations(editor: string, key: string, ranges: Parameters<MainThreadTextEditorsShape['$trySetDecorations']>[2]): Promise<void> {
				assert.strictEqual(ranges.length, 0);
				calls.push({ editor, key, ranges: [] });
			}
			override async $trySetDecorationsFast(editor: string, key: string, ranges: number[]): Promise<void> {
				calls.push({ editor, key, ranges });
			}
		};
		const document = new ExtHostDocumentData(undefined!, URI.file('/decorations.txt'), ['sample text'], '\n', 1, 'plaintext', false, 'utf8');
		editors = ['first', 'second'].map(id => store.add(new ExtHostTextEditor(id, proxy, new NullLogService(), new Lazy(() => document.document), [], {
			cursorStyle: TextEditorCursorStyle.Line, insertSpaces: true, lineNumbers: 1, tabSize: 4, indentSize: 4, originalIndentSize: 'tabSize'
		}, [], 1)));
		service = store.add(new ExtHostEditors(SingleProxyRPCProtocol(proxy), new class extends mock<ExtHostDocumentsAndEditors>() {
			override readonly onDidChangeVisibleTextEditors = Event.None;
			override readonly onDidChangeActiveTextEditor = Event.None;
			override allEditors(): ExtHostTextEditor[] { return editors; }
		}));
	});

	test('forgets a disposed decoration type in every open editor', () => {
		const decoration = store.add(service.createTextEditorDecorationType(nullExtensionDescription, {}));
		for (const editor of editors) {
			editor.value.setDecorations(decoration, [new Range(0, 0, 0, 1)]);
		}
		assert.strictEqual(calls.length, 2);
		decoration.dispose();
		for (const editor of editors) {
			editor.value.setDecorations(decoration, []);
		}
		assert.strictEqual(calls.length, 2);
	});

	test('still clears another live decoration type', () => {
		const retired = store.add(service.createTextEditorDecorationType(nullExtensionDescription, {}));
		const active = store.add(service.createTextEditorDecorationType(nullExtensionDescription, {}));
		editors[0].value.setDecorations(retired, [new Range(0, 0, 0, 1)]);
		editors[0].value.setDecorations(active, [new Range(0, 1, 0, 2)]);
		retired.dispose();
		editors[0].value.setDecorations(active, []);
		assert.deepStrictEqual(calls.at(-1), { editor: 'first', key: active.key, ranges: [] });
		assert.strictEqual(calls.length, 3);
	});

	test('continues to recognize a decoration by key rather than object identity', () => {
		const decoration = store.add(service.createTextEditorDecorationType(nullExtensionDescription, {}));
		editors[0].value.setDecorations(decoration, [new Range(0, 0, 0, 1)]);
		editors[0].value.setDecorations({ ...decoration }, []);
		assert.strictEqual(calls.length, 2);
		assert.deepStrictEqual(calls.at(-1)?.ranges, []);
	});
});
