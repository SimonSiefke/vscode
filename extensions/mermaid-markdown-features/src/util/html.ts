/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const regexp1 = /'/g;
const regexp2 = /"/g;
const regexp3 = />/g;
const regexp4 = /</g;
const regexp5 = /&/g;

export function escapeHtmlText(str: string): string {
	return str
		.replace(new RegExp(regexp5), '&amp;')
		.replace(new RegExp(regexp4), '&lt;')
		.replace(new RegExp(regexp3), '&gt;')
		.replace(new RegExp(regexp2), '&quot;')
		.replace(new RegExp(regexp1), '&#39;');
}
