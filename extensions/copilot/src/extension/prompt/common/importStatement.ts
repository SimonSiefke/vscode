/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexpImport = /^\s*import\s/;
const regexpImportVarConst = /^\s*import[\s{*]|^\s*[var|const|let].*=\s*require\(/;
const regexpUse = /^\s*use/;
const regexpUseAs = /^\s*use\s+[\w:{}, ]+\s*(as\s+\w+)?;/;
const regexpFromImport = /^\s*from\s+[\w.]+\s+import\s+[\w, *]+$/;
const regexpImport1 = /^\s*import\s+[\w, ]+$/;

export function isImportStatement(line: string, languageId: string): boolean {
	switch (languageId) {
		case 'java':
			return !!line.match(regexpImport);
		case 'typescript':
		case 'typescriptreact':
		case 'javascript':
		case 'javascriptreact':
			return !!line.match(regexpImportVarConst);
		case 'php':
			return !!line.match(regexpUse);
		case 'rust':
			return !!line.match(regexpUseAs);
		case 'python':
			return !!line.match(regexpFromImport)
				|| !!line.match(regexpImport1);
		default:
			return false;
	}
}
