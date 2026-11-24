/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { Position } from '../../../../common/core/position.js';
import { Range } from '../../../../common/core/range.js';
import { getSelectionSearchString } from '../../browser/findController.js';
import { FindReplaceState } from '../../browser/findState.js';
import { FindWidget } from '../../browser/findWidget.js';
import { createCodeEditorServices, instantiateTestCodeEditor, withTestCodeEditor } from '../../../../test/browser/testCodeEditor.js';
import { instantiateTextModel } from '../../../../test/common/testTextModel.js';


suite('Find', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposing the find widget cancels the pending history update', () => runWithFakedTimers({}, async () => {
		const instantiationService = createCodeEditorServices(store);
		const model = store.add(instantiateTextModel(instantiationService, 'first second'));
		const editor = store.add(instantiateTestCodeEditor(instantiationService, model));
		const searchHistory = new Set<string>();
		const state = store.add(new FindReplaceState());
		const widget = store.add(instantiationService.invokeFunction(accessor => new FindWidget(
			editor,
			{ replace() { }, replaceAll() { }, async getGlobalBufferTerm() { return ''; } },
			state,
			{ showContextView() { }, hideContextView() { }, layout() { } },
			accessor.get(IKeybindingService),
			accessor.get(IContextKeyService),
			accessor.get(IHoverService),
			searchHistory,
			undefined,
			accessor.get(IConfigurationService),
			accessor.get(IAccessibilityService),
		)));

		state.change({ searchString: 'first' }, false);
		assert.deepStrictEqual([...searchHistory], []);
		await timeout(501);
		assert.deepStrictEqual([...searchHistory], ['first']);

		state.change({ searchString: 'second' }, false);
		widget.dispose();
		await timeout(501);
		assert.deepStrictEqual([...searchHistory], ['first']);
	}));

	test('search string at position', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// The cursor is at the very top, of the file, at the first ABC
			const searchStringAtTop = getSelectionSearchString(editor);
			assert.strictEqual(searchStringAtTop, 'ABC');

			// Move cursor to the end of ABC
			editor.setPosition(new Position(1, 3));
			const searchStringAfterABC = getSelectionSearchString(editor);
			assert.strictEqual(searchStringAfterABC, 'ABC');

			// Move cursor to DEF
			editor.setPosition(new Position(1, 5));
			const searchStringInsideDEF = getSelectionSearchString(editor);
			assert.strictEqual(searchStringInsideDEF, 'DEF');

		});
	});

	test('search string with selection', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// Select A of ABC
			editor.setSelection(new Range(1, 1, 1, 2));
			const searchStringSelectionA = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionA, 'A');

			// Select BC of ABC
			editor.setSelection(new Range(1, 2, 1, 4));
			const searchStringSelectionBC = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionBC, 'BC');

			// Select BC DE
			editor.setSelection(new Range(1, 2, 1, 7));
			const searchStringSelectionBCDE = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionBCDE, 'BC DE');

		});
	});

	test('search string with multiline selection', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// Select first line and newline
			editor.setSelection(new Range(1, 1, 2, 1));
			const searchStringSelectionWholeLine = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionWholeLine, null);

			// Select first line and chunk of second
			editor.setSelection(new Range(1, 1, 2, 4));
			const searchStringSelectionTwoLines = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionTwoLines, null);

			// Select end of first line newline and chunk of second
			editor.setSelection(new Range(1, 7, 2, 4));
			const searchStringSelectionSpanLines = getSelectionSearchString(editor);
			assert.strictEqual(searchStringSelectionSpanLines, null);

		});
	});

});
