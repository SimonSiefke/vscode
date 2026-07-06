/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexp1 = /,|\s+/g;

export function parseKindModifier(kindModifiers: string): Set<string> {
	return new Set(kindModifiers.split(new RegExp(regexp1)));
}
