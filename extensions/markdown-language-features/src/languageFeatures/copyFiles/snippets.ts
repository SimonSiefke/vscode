/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexpEscapeNamePattern = /(?<escape>\\\$)|(?<!\\)\$\{(?<name>\w+)(?:\/(?<pattern>(?:\\\/|[^\}])+?)\/(?<replacement>(?:\\\/|[^\}])+?)\/)?\}/g;
const regexp2 = /\\\//g;

/**
 * Resolves variables in a VS Code snippet style string
 */
export function resolveSnippet(snippetString: string, vars: ReadonlyMap<string, string>): string {
	return snippetString.replaceAll(new RegExp(regexpEscapeNamePattern), (match, _escape, name, pattern, replacement, _offset, _str, groups) => {
		if (groups?.['escape']) {
			return '$';
		}

		const entry = vars.get(name);
		if (typeof entry !== 'string') {
			return match;
		}

		if (pattern && replacement) {
			return entry.replace(new RegExp(replaceTransformEscapes(pattern)), replaceTransformEscapes(replacement));
		}

		return entry;
	});
}


function replaceTransformEscapes(str: string): string {
	return str.replaceAll(new RegExp(regexp2), '/');
}

