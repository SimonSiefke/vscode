/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { URITransformer } from '../../../../../base/common/uriIpc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseJsonAndRestoreBufferRefs, stringifyJsonWithBufferRefs } from '../../common/rpcProtocol.js';

suite('RPC JSON buffer references', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('ordinary large DTOs retain their JSON representation', () => {
		const value = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}`, { value: index, enabled: true, names: ['a', 'b'] }]));
		assert.deepStrictEqual(parseJsonAndRestoreBufferRefs(JSON.stringify(value), [], null), value);
	});

	test('buffer references retain aliases and methods', () => {
		const buffer = VSBuffer.fromString('payload');
		const value = { first: buffer, nested: [buffer] };
		const { jsonString, referencedBuffers } = stringifyJsonWithBufferRefs(value);
		const result = parseJsonAndRestoreBufferRefs(jsonString, referencedBuffers, null);
		assert.strictEqual(result.first, buffer);
		assert.strictEqual(result.nested[0], buffer);
		assert.strictEqual(result.first.toString(), 'payload');
	});

	test('undefined placeholders delete object fields and preserve array holes', () => {
		const input = { omitted: undefined, values: [undefined, null, { omitted: undefined }] };
		const { jsonString, referencedBuffers } = stringifyJsonWithBufferRefs(input);
		const result = parseJsonAndRestoreBufferRefs(jsonString, referencedBuffers, null);
		assert.strictEqual(Object.hasOwn(result, 'omitted'), false);
		assert.strictEqual(result.values.length, 3);
		assert.strictEqual(Object.hasOwn(result.values, 0), false);
		assert.strictEqual(result.values[1], null);
		assert.deepStrictEqual(result.values[2], {});
		assert.strictEqual(parseJsonAndRestoreBufferRefs('{"$$ref$$":-1}', [], null), undefined);
	});

	test('unicode-escaped reference names still resolve', () => {
		const buffer = VSBuffer.fromString('escaped');
		const result = parseJsonAndRestoreBufferRefs('{"\\u0024\\u0024r\\u0065f\\u0024\\u0024":0}', [buffer], null);
		assert.strictEqual(result, buffer);
	});

	test('URI transformation retains postorder even under a replaced buffer reference', () => {
		const seen: string[] = [];
		const transformer = new URITransformer({
			transformIncoming: uri => {
				seen.push(uri.path!);
				return { ...uri, path: '/incoming' + uri.path };
			},
			transformOutgoing: uri => uri,
			transformOutgoingScheme: scheme => scheme
		});
		const buffer = VSBuffer.fromString('reference');
		const value = { $$ref$$: 0, resource: URI.file('/nested').toJSON() };
		assert.strictEqual(parseJsonAndRestoreBufferRefs(JSON.stringify(value), [buffer], transformer), buffer);
		assert.deepStrictEqual(seen, ['/nested']);
		const uri = parseJsonAndRestoreBufferRefs('{"\\u0024mid":1,"scheme":"file","path":"/escaped"}', [], transformer);
		assert.strictEqual(uri.path, '/incoming/escaped');
	});

	test('restoring a __proto__ field preserves the parsed object prototype', () => {
		const buffer = VSBuffer.fromString('prototype');
		const result = parseJsonAndRestoreBufferRefs('{"__proto__":{"$$ref$$":0}}', [buffer], null);
		assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
		assert.strictEqual(Object.hasOwn(result, '__proto__'), true);
		assert.strictEqual(result.__proto__, buffer);
	});
});
