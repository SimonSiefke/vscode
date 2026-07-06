/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { guessIndentation } from '../../src/extension/prompt/node/indentationGuesser';
const regexp1 = /^\s*/;
const regexp2 = /^('''|""")/;
const regexp3 = / /g;



export function validateDocstringFormat(fileContents: string, targetLineString: string): void {
	const lines = fileContents.split('\n');
	const targetLineIndex = lines.findIndex(line => line.includes(targetLineString));

	if (targetLineIndex === -1) {
		throw new Error('Target line not found in the file contents.');
	}

	if (targetLineIndex === lines.length - 1) {
		throw new Error('Target line is the last line of the file. No space for a docstring.');
	}

	const indentation = guessIndentation(lines, 4, true);
	const tabSize = indentation.tabSize;
	const insertSpaces = indentation.insertSpaces;

	const targetLine = lines[targetLineIndex];
	const targetIndentation = targetLine.match(regexp1)?.[0] || '';

	// Check the next line for a docstring start
	const nextLine = lines[targetLineIndex + 1];
	const docstringStart = nextLine.trim().match(regexp2);
	if (!docstringStart) {
		throw new Error('No docstring found after the target line.');
	}

	const docstringIndentation = nextLine.match(regexp1)?.[0] || '';

	// Calculate the expected indentation
	let expectedIndentation: string;
	if (insertSpaces) {
		expectedIndentation = targetIndentation + ' '.repeat(tabSize);
	} else {
		expectedIndentation = targetIndentation + '\t';
	}

	// The docstring should have the expected indentation
	if (docstringIndentation !== expectedIndentation) {
		throw new Error(`Incorrect docstring indentation. Expected: '${expectedIndentation.replace(regexp3, '·')}', but got: '${docstringIndentation.replace(regexp3, '·')}'`);
	}
}
