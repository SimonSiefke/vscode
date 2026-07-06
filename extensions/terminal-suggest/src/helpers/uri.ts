/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
const regexpZA = /^[a-zA-Z]:\\/;


export function getFriendlyResourcePath(uri: vscode.Uri, pathSeparator: string, kind?: vscode.TerminalCompletionItemKind): string {
	let path = uri.fsPath;
	// Ensure drive is capitalized on Windows
	if (pathSeparator === '\\' && path.match(regexpZA)) {
		path = `${path[0].toUpperCase()}:${path.slice(2)}`;
	}
	if (kind === vscode.TerminalCompletionItemKind.Folder) {
		if (!path.endsWith(pathSeparator)) {
			path += pathSeparator;
		}
	}
	return path;
}
