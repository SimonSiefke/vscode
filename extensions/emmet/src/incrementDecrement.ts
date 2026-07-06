/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Based on @sergeche's work in his emmet plugin */

import * as vscode from 'vscode';
const regexp1 = /\.(\d+)$/;
const regexp2 = /\.0+$/;
const regexp3 = /^(\-?)(\d+)/;
const regexp4 = /^\-?(0\d+)/;
const regexp5 = /^(\-?)0+/;
const regexp6 = /^\-?\./;


const reNumber = /[0-9]/;

/**
 * Incerement number under caret of given editor
 */
export function incrementDecrement(delta: number): Thenable<boolean> | undefined {
	if (!vscode.window.activeTextEditor) {
		vscode.window.showInformationMessage('No editor is active');
		return;
	}
	const editor = vscode.window.activeTextEditor;

	return editor.edit(editBuilder => {
		editor.selections.forEach(selection => {
			const rangeToReplace = locate(editor.document, selection.isReversed ? selection.anchor : selection.active);
			if (!rangeToReplace) {
				return;
			}

			const text = editor.document.getText(rangeToReplace);
			if (isValidNumber(text)) {
				editBuilder.replace(rangeToReplace, update(text, delta));
			}
		});
	});
}

/**
 * Updates given number with `delta` and returns string formatted according
 * to original string format
 */
export function update(numString: string, delta: number): string {
	let m: RegExpMatchArray | null;
	const decimals = (m = numString.match(regexp1)) ? m[1].length : 1;
	let output = String((parseFloat(numString) + delta).toFixed(decimals)).replace(regexp2, '');

	if (m = numString.match(regexp4)) {
		// padded number: preserve padding
		output = output.replace(regexp3, (_, minus, prefix) =>
			minus + '0'.repeat(Math.max(0, (m ? m[1].length : 0) - prefix.length)) + prefix);
	}

	if (regexp6.test(numString)) {
		// omit integer part
		output = output.replace(regexp5, '$1');
	}

	return output;
}

/**
 * Locates number from given position in the document
 *
 * @return Range of number or `undefined` if not found
 */
export function locate(document: vscode.TextDocument, pos: vscode.Position): vscode.Range | undefined {

	const line = document.lineAt(pos.line).text;
	let start = pos.character;
	let end = pos.character;
	let hadDot = false, hadMinus = false;
	let ch;

	while (start > 0) {
		ch = line[--start];
		if (ch === '-') {
			hadMinus = true;
			break;
		} else if (ch === '.' && !hadDot) {
			hadDot = true;
		} else if (!reNumber.test(ch)) {
			start++;
			break;
		}
	}

	if (line[end] === '-' && !hadMinus) {
		end++;
	}

	while (end < line.length) {
		ch = line[end++];
		if (ch === '.' && !hadDot && reNumber.test(line[end])) {
			// A dot must be followed by a number. Otherwise stop parsing
			hadDot = true;
		} else if (!reNumber.test(ch)) {
			end--;
			break;
		}
	}

	// ensure that found range contains valid number
	if (start !== end && isValidNumber(line.slice(start, end))) {
		return new vscode.Range(pos.line, start, pos.line, end);
	}

	return;
}

/**
 * Check if given string contains valid number
 */
function isValidNumber(str: string): boolean {
	return str ? !isNaN(parseFloat(str)) : false;
}
