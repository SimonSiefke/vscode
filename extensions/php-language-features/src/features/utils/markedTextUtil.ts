/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkedString } from 'vscode';
const regexp1 = /[\\`*_{}[\]()#+\-.!]/g;


export function textToMarkedString(text: string): MarkedString {
	return text.replace(regexp1, '\\$&'); // escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
}