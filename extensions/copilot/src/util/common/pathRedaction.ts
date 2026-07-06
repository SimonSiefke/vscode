/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexpFile = /([\s|(]|file:\/\/)(\\[^\s]+)/gi;
const regexpFileZA = /([\s|(]|file:\/\/)([a-zA-Z]:[(\\|/){1,2}][^\s]+)/gi;
const regexpFile1 = /([\s|(]|file:\/\/)(\/[^\s]+)/g;

/**
 * Redacts all things that look like a file path from a given input string.
 */
export function redactPaths(input: string): string {
	return input
		.replace(regexpFile1, '$1[redacted]') // unix path
		.replace(regexpFileZA, '$1[redacted]') // windows path
		.replace(regexpFile, '$1[redacted]'); // unc path
}
