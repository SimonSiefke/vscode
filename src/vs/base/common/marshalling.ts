/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from './buffer.js';
import { URI, UriComponents } from './uri.js';
import { MarshalledId } from './marshallingIds.js';

export function stringify(obj: unknown): string {
	return JSON.stringify(obj, replacer);
}

export function parse(text: string): any {
	let data = JSON.parse(text);
	data = revive(data);
	return data;
}

export interface MarshalledObject {
	$mid: MarshalledId;
}

function replacer(key: string, value: any): any {
	// URI is done via toJSON-member
	if (value instanceof RegExp) {
		return {
			$mid: MarshalledId.Regexp,
			source: value.source,
			flags: value.flags,
		};
	}
	return value;
}


type Deserialize<T> = T extends UriComponents ? URI
	: T extends VSBuffer ? VSBuffer
	: T extends object
	? Revived<T>
	: T;

export type Revived<T> = { [K in keyof T]: Deserialize<T[K]> };

export function revive<T = any>(obj: any, depth = 0): Revived<T> {
	return obj && typeof obj === 'object' ? doRevive(obj, depth, new Map()) : obj;
}

function doRevive(obj: any, depth: number, seen: Map<object, { value: any; depth?: number }>): any {
	if (!obj) {
		return obj;
	}

	if (typeof obj === 'object') {
		const cached = seen.get(obj);
		// A shallower alias can reach members skipped by an earlier depth-limited visit.
		if (cached && (cached.depth === undefined || cached.depth <= depth)) {
			return cached.value;
		}
		if (depth > 200) {
			return obj;
		}
		seen.set(obj, { value: obj, depth });

		switch ((<MarshalledObject>obj).$mid) {
			case MarshalledId.Uri: {
				const uri = URI.revive(obj);
				seen.set(obj, { value: uri });
				return uri;
			}
			case MarshalledId.Regexp: {
				const regexp = new RegExp(obj.source, obj.flags);
				seen.set(obj, { value: regexp });
				return regexp;
			}
			case MarshalledId.Date: {
				const date = new Date(obj.source);
				seen.set(obj, { value: date });
				return date;
			}
		}

		if (
			obj instanceof VSBuffer
			|| obj instanceof Uint8Array
		) {
			// eslint-disable-next-line local/code-no-any-casts
			return <any>obj;
		}

		if (Array.isArray(obj)) {
			for (let i = 0; i < obj.length; ++i) {
				obj[i] = doRevive(obj[i], depth + 1, seen);
			}
		} else {
			// walk object
			for (const key in obj) {
				if (Object.hasOwnProperty.call(obj, key)) {
					obj[key] = doRevive(obj[key], depth + 1, seen);
				}
			}
		}
	}

	return obj;
}
