/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';

createRequire(import.meta.url)
const vscode = require('vscode')

export const activate = () => {
	vscode.commands.registerCommand('hello-esm.hello', () => {
		vscode.window.showInformationMessage('hello world esm');
	})
};
