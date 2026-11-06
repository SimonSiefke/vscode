/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../common/buffer.js';
import { URI } from '../../../common/uri.js';
import type { IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from './ipc.js';

/** Marshal channel data without exposing native frames to byte transports. */
export function sendStructuredCloneMessage(protocol: IStructuredCloneMessagePassingProtocol, header: unknown, body: unknown): number {
	const vsBuffers: { buffer: Uint8Array }[] = [];
	const message = transformStructuredCloneData({ header, body }, value => {
		if (value instanceof URI) {
			return value.toJSON();
		}
		if (value instanceof VSBuffer) {
			const buffer = { buffer: value.buffer };
			vsBuffers.push(buffer);
			return buffer;
		}
		return value;
	}) as IStructuredCloneMessage;
	if (vsBuffers.length > 0) {
		message.vsBuffers = vsBuffers;
	}
	protocol.send(message);
	return 0;
}

/**
 * Convert channel values without mutating them or losing structured-clone graph identity.
 * Native cloneable values, including binary payloads, are left to the transport.
 */
function transformStructuredCloneData(data: unknown, transform: (value: object) => unknown, seen = new Map<object, unknown>()): unknown {
	if (!data || typeof data !== 'object') {
		return data;
	}
	if (seen.has(data)) {
		return seen.get(data);
	}
	const transformed = transform(data);
	if (transformed !== data) {
		seen.set(data, transformed);
		return transformed;
	}
	if (data instanceof Map) {
		const result = new Map();
		seen.set(data, result);
		// Snapshot internal entries before getters can mutate the collection.
		for (const [key, value] of Array.from(Map.prototype.entries.call(data))) {
			result.set(transformStructuredCloneData(key, transform, seen), transformStructuredCloneData(value, transform, seen));
		}
		return result;
	}
	if (data instanceof Set) {
		const result = new Set();
		seen.set(data, result);
		for (const value of Array.from(Set.prototype.values.call(data))) {
			result.add(transformStructuredCloneData(value, transform, seen));
		}
		return result;
	}
	// Classifying plain objects must not invoke Symbol.toStringTag getters.
	const isArray = Array.isArray(data);
	const prototype = isArray ? undefined : Object.getPrototypeOf(data);
	if (data instanceof Error || isArray || prototype === Object.prototype || prototype === null || Object.prototype.toString.call(data) === '[object Object]') {
		const result: object = isArray ? new Array(data.length) : {};
		seen.set(data, result);
		// Native Error cloning drops provider names and codes. Send a DTO so
		// existing consumers can reconstruct the same error classification.
		const keys = Object.keys(data);
		if (data instanceof Error) {
			for (const key of ['name', 'message', 'stack']) {
				if (!keys.includes(key)) {
					keys.push(key);
				}
			}
		}
		for (const key of keys) {
			// Keep the initial enumerable keys, but omit keys deleted by earlier getters.
			if (!Object.hasOwn(data, key) && !(data instanceof Error && key === 'name')) {
				continue;
			}
			const original = (data as Record<string, unknown>)[key];
			// Local callbacks are omitted by the legacy JSON transport as well.
			if (typeof original === 'function' || typeof original === 'symbol') {
				continue;
			}
			const value = transformStructuredCloneData(original, transform, seen);
			if (key === '__proto__') {
				// Assignment would invoke Object.prototype's setter instead of copying the key.
				Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
			} else {
				(result as Record<string, unknown>)[key] = value;
			}
		}
		return result;
	}
	return data;
}

export function deserializeStructuredCloneMessage(message: IStructuredCloneMessage): IStructuredCloneMessage {
	// Structured cloning preserves the references in this table, including aliases
	// in Map keys and Set entries. Restore those wrappers directly without walking
	// or copying the received graph a second time.
	for (const value of message.vsBuffers ?? []) {
		if (value instanceof VSBuffer) {
			continue;
		}
		const buffer = VSBuffer.wrap(value.buffer);
		Object.setPrototypeOf(value, VSBuffer.prototype);
		Object.assign(value, buffer);
	}
	return message;
}

