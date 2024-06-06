/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';


export function activate(): void {
	vscode.commands.registerCommand('hello-error.hello-error', () => {
		try {

			throw new TypeError('x is not a function');
		} catch (error) {
			console.error(error);
		} finally {
			vscode.window.showInformationMessage('check devtools');
		}
	});
}
