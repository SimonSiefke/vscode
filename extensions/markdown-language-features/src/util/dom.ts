/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
const regexp1 = /'/g;
const regexp2 = /"/g;
const regexp3 = /&/g;
const regexp4 = />/g;
const regexp5 = /</g;


export function escapeAttribute(value: string | vscode.Uri): string {
	return value.toString()
		.replace(regexp3, '&amp;')
		.replace(regexp2, '&quot;')
		.replace(regexp1, '&#39;');
}

export function escapeHtml(text: string): string {
	return text
		.replace(regexp3, '&amp;')
		.replace(regexp5, '&lt;')
		.replace(regexp4, '&gt;')
		.replace(regexp2, '&quot;')
		.replace(regexp1, '&#39;');
}

