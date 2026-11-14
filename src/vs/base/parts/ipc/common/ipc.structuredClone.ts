/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../common/buffer.js';
import { URI } from '../../../common/uri.js';
import type { IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from './ipc.js';

/** Marshal channel data without exposing native frames to byte transports. */
export function sendStructuredCloneMessage(protocol: IStructuredCloneMessagePassingProtocol, header: unknown, body: unknown): number {
	// Channel headers contain only request IDs and names. Connection contexts
	// can be arbitrary values and retain the full marshalling path below.
	if (!header || typeof header !== 'object' || Array.isArray(header) && header.every(value => !value || typeof value !== 'object')) {
		if (!body || typeof body !== 'object' || body instanceof Uint8Array) {
			protocol.send({ header, body });
			return 0;
		}
		if (body instanceof VSBuffer) {
			protocol.send({ header, body, vsBuffers: [body] });
			return 0;
		}
		if (body instanceof URI) {
			protocol.send({ header, body: body.toJSON() });
			return 0;
		}
		const json = trySerializeJSONBody(header, body);
		if (json) {
			protocol.send(json);
			return 0;
		}
	}
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

/** JSON strings avoid native cloning of large DTO trees and byte encoding. */
function trySerializeJSONBody(header: unknown, body: unknown): IStructuredCloneMessage | undefined {
	if (!canSerializeChannelJSON(body, new Set())) {
		return undefined;
	}
	try {
		return { header, body: JSON.stringify(body), jsonBody: true };
	} catch (error) {
		// Cycles and nested bigint values still require the native graph path.
		if (!(error instanceof TypeError)) {
			throw error;
		}
		return undefined;
	}
}

/** Prefer legacy JSON for bulk DTOs, retaining richer graph semantics for smaller values.
 * Optional fields and local callbacks retain the legacy JSON omission semantics.
 */
function canSerializeChannelJSON(data: unknown, seen: Set<object>): boolean {
	if (!data || typeof data !== 'object') {
		return false;
	}
	if (seen.has(data)) {
		return false;
	}
	seen.add(data);
	if (data instanceof URI) {
		return true;
	}
	const isArray = Array.isArray(data);
	const prototype = isArray ? undefined : Object.getPrototypeOf(data);
	if (!isArray && prototype !== Object.prototype && prototype !== null) {
		return false;
	}
	const keys = Object.keys(data);
	// Bulk channel payloads historically used JSON. Avoid recursively reflecting
	// their DTO trees while preserving top-level native values on the graph path.
	if (isArray && keys.length !== data.length) {
		return false;
	}
	let index = 0;
	for (const key of keys) {
		if (isArray && key !== String(index++)) {
			return false;
		}
		const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
		if (descriptor.get || descriptor.set) {
			return false;
		}
		const value: unknown = descriptor.value;
		if (key === 'toJSON' && typeof value === 'function' || isArray && (value === undefined || typeof value === 'function')) {
			return false;
		}
		if (value && typeof value === 'object') {
			if (!canSerializeChannelJSON(value, seen)) {
				return false;
			}
		} else if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
			return false;
		}
	}
	return true;
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
	if (isArray || prototype === Object.prototype || prototype === null || Object.prototype.toString.call(data) === '[object Object]') {
		const result: object = isArray ? new Array(data.length) : {};
		seen.set(data, result);
		for (const key of Object.keys(data)) {
			// Keep the initial enumerable keys, but omit keys deleted by earlier getters.
			if (!Object.hasOwn(data, key)) {
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
	if (message.jsonBody) {
		message.body = JSON.parse(message.body as string);
		// IPCClient shares this frame between its ChannelClient and ChannelServer.
		message.jsonBody = false;
	}
	return message;
}

