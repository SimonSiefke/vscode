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
		.replace(new RegExp(regexp3), '&amp;')
		.replace(new RegExp(regexp2), '&quot;')
		.replace(new RegExp(regexp1), '&#39;');
}

export function escapeHtml(text: string): string {
	return text
		.replace(new RegExp(regexp3), '&amp;')
		.replace(new RegExp(regexp5), '&lt;')
		.replace(new RegExp(regexp4), '&gt;')
		.replace(new RegExp(regexp2), '&quot;')
		.replace(new RegExp(regexp1), '&#39;');
}

