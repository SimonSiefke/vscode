/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../common/buffer.js';
import { URI, UriComponents } from '../../../common/uri.js';

interface ISerializedValue {
	readonly value: unknown;
	readonly buffers: readonly Uint8Array[];
	readonly uris: readonly UriComponents[];
}

/** Preserves VS Code value types while leaving native cloneable values in their native form. */
export function serializeStructuredClone(value: unknown): ISerializedValue {
	const buffers: Uint8Array[] = [];
	const uris: UriComponents[] = [];
	const result = transform(value, value => {
		if (value instanceof VSBuffer) {
			const buffer = value.buffer.subarray(0);
			buffers.push(buffer);
			return buffer;
		}
		if (value instanceof URI) {
			const uri = value.toJSON();
			uris.push(uri);
			return uri;
		}
		return undefined;
	});
	return { value: result, buffers, uris };
}

export function deserializeStructuredClone(value: unknown): unknown {
	const data = value as ISerializedValue;
	const buffers = new Set<object>(data.buffers);
	const uris = new Set<object>(data.uris);
	return transform(data.value, value => {
		if (buffers.has(value)) {
			return VSBuffer.wrap(value as Uint8Array);
		}
		if (uris.has(value)) {
			return URI.revive(value as UriComponents);
		}
		return undefined;
	});
}

function transform(value: unknown, convert: (value: object) => object | undefined, visited = new Map<object, object>()): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}
	const existing = visited.get(value);
	if (existing) {
		return existing;
	}
	const converted = convert(value);
	if (converted) {
		visited.set(value, converted);
		return converted;
	}
	if (value instanceof Map) {
		const result = new Map<unknown, unknown>();
		visited.set(value, result);
		for (const [key, entry] of value) {
			result.set(transform(key, convert, visited), transform(entry, convert, visited));
		}
		return result;
	}
	if (value instanceof Set) {
		const result = new Set<unknown>();
		visited.set(value, result);
		for (const entry of value) {
			result.add(transform(entry, convert, visited));
		}
		return result;
	}
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date || value instanceof RegExp || value instanceof Error
		|| typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer
		|| typeof Blob !== 'undefined' && value instanceof Blob) {
		return value;
	}
	const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? new Array(value.length) : {};
	visited.set(value, result);
	for (const key of Object.keys(value)) {
		Object.defineProperty(result, key, {
			value: transform((value as Record<string, unknown>)[key], convert, visited),
			enumerable: true, configurable: true, writable: true
		});
	}
	return result;
}
