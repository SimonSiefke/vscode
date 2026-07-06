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
		.replace(regexp5, '&amp;')
		.replace(regexp4, '&lt;')
		.replace(regexp3, '&gt;')
		.replace(regexp2, '&quot;')
		.replace(regexp1, '&#39;');
}
