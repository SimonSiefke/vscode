/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Color } from '../common/color.js';
import { FileAccess } from '../common/network.js';
import { URI } from '../common/uri.js';
const regexpVar = /^\s*var\((.+)\)$/;
const regexp2 = /[^\w.%+-]/gi;
const regexp9aFA = /[^[0-9a-fA-F#]]/gi;
const regexpZ0 = /[^_\-a-z0-9]/gi;
const regexp5 = /'/g;


export type CssFragment = string & { readonly __cssFragment: unique symbol };

function asFragment(raw: string): CssFragment {
	return raw as CssFragment;
}

export function asCssValueWithDefault(cssPropertyValue: string | undefined, dflt: string): string {
	if (cssPropertyValue !== undefined) {
		const variableMatch = cssPropertyValue.match(regexpVar);
		if (variableMatch) {
			const varArguments = variableMatch[1].split(',', 2);
			if (varArguments.length === 2) {
				dflt = asCssValueWithDefault(varArguments[1].trim(), dflt);
			}
			return `var(${varArguments[0]}, ${dflt})`;
		}
		return cssPropertyValue;
	}
	return dflt;
}

export function sizeValue(value: string): CssFragment {
	const out = value.replaceAll(new RegExp(regexp2), '');
	if (out !== value) {
		console.warn(`CSS size ${value} modified to ${out} to be safe for CSS`);
	}
	return asFragment(out);
}

export function hexColorValue(value: string): CssFragment {
	const out = value.replaceAll(new RegExp(regexp9aFA), '');
	if (out !== value) {
		console.warn(`CSS hex color ${value} modified to ${out} to be safe for CSS`);
	}
	return asFragment(out);
}

export function identValue(value: string): CssFragment {
	const out = value.replaceAll(new RegExp(regexpZ0), '');
	if (out !== value) {
		console.warn(`CSS ident value ${value} modified to ${out} to be safe for CSS`);
	}
	return asFragment(out);
}

export function stringValue(value: string): CssFragment {
	return asFragment(`'${value.replaceAll(new RegExp(regexp5), '\\000027')}'`);
}

/**
 * returns url('...')
 */
export function asCSSUrl(uri: URI | null | undefined): CssFragment {
	if (!uri) {
		return asFragment(`url('')`);
	}
	return inline`url('${asFragment(CSS.escape(FileAccess.uriToBrowserUri(uri).toString(true)))}')`;
}

export function className(value: string, escapingExpected = false): CssFragment {
	const out = CSS.escape(value);
	if (!escapingExpected && out !== value) {
		console.warn(`CSS class name ${value} modified to ${out} to be safe for CSS`);
	}
	return asFragment(out);
}

type InlineCssTemplateValue = CssFragment | Color;

/**
 * Template string tag that that constructs a CSS fragment.
 *
 * All expressions in the template must be css safe values.
 */
export function inline(strings: TemplateStringsArray, ...values: InlineCssTemplateValue[]): CssFragment {
	return asFragment(strings.reduce((result, str, i) => {
		const value = values[i] || '';
		return result + str + value;
	}, ''));
}


export class Builder {
	private readonly _parts: CssFragment[] = [];

	push(...parts: CssFragment[]): void {
		this._parts.push(...parts);
	}

	join(joiner = '\n'): CssFragment {
		return asFragment(this._parts.join(joiner));
	}
}
