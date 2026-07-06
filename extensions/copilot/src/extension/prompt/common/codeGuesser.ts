/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isBasicASCII } from '../../../util/vs/base/common/strings';
const regexp1 = /\r?\n/;
const regexp2 = /^\s/;
const regexp3 = /^[;{}()\[\]`~?]/;
const regexp4 = /[A-Z]/;


export function looksLikeCode(text: string): boolean {
	const lines = text.split(regexp1);
	const lineTypes = lines.map(guessLineType);
	const codeLineCount = lineTypes.filter(type => type === GuessedLineType.Code).length;
	const naturalLanguageLineCount = lineTypes.filter(type => type === GuessedLineType.NaturalLanguage).length;
	return codeLineCount > naturalLanguageLineCount;
}

const enum GuessedLineType {
	Unknown,
	Code,
	NaturalLanguage
}

function guessLineType(line: string): GuessedLineType {
	if (line.length === 0) {
		return GuessedLineType.Unknown;
	}
	let naturalLanguageScore = 0;
	let codeScore = 0;

	// There are some super strong low hanging hints that a line is code
	const obviousCodeSyntax = ['==', '!=', '===', '!==', '>=', '<=', '&&', '||', '>>', '>>>', '<<', '<<<', '+=', '-=', '*=', '/=', '%=', '<<=', '<<<=', '>>=', '>>>=', '++', '--', '=>', '->', '...', '??', '??='];
	if (obviousCodeSyntax.some(syntax => line.includes(syntax))) {
		return GuessedLineType.Code;
	}

	// If a line starts with whitespace or syntactical characters, it's probably code
	if (line.match(regexp2) || line.match(regexp3)) {
		return GuessedLineType.Code;
	}

	// Natural Language Hints
	{
		// if the first character is upper-case
		if (line.charAt(0).match(regexp4)) {
			naturalLanguageScore += 1;
		}
		// if the line ends with a period
		if (line[line.length - 1] === '.') {
			naturalLanguageScore += 1;
		}
		// if the line has CJK characters
		if (!isBasicASCII(line)) {
			naturalLanguageScore += 1;
		}
	}

	// Code Hints
	{
		// if the first character is ASCII but not upper-case
		if (isBasicASCII(line.charAt(0)) && !line.charAt(0).match(regexp4)) {
			codeScore += 1;
		}
		// if the line starts with tabs or spaces
		if (line.match(regexp2)) {
			codeScore += 1;
		}
		// if the line contains common characters used for programming
		const commonCodeChars = [';', '{', '}', '(', ')', '[', ']', '`', '~', '#', '$', '%', '^', '&', '*', '_', '=', '+', '\\', '|', '<', '>'];
		const commonCodeCharsCounts = commonCodeChars.map(char => (line.includes(char) ? 1 : 0)).filter(x => x).length;
		codeScore += commonCodeCharsCounts;
	}

	if (naturalLanguageScore > codeScore) {
		return GuessedLineType.NaturalLanguage;
	}
	if (codeScore > naturalLanguageScore) {
		return GuessedLineType.Code;
	}
	return GuessedLineType.Unknown;
}
