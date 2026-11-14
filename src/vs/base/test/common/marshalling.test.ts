/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { parse, revive, stringify } from '../../common/marshalling.js';
import { MarshalledId } from '../../common/marshallingIds.js';
import { URI } from '../../common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';

suite('Marshalling', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('RegExp', () => {
		const value = /foo/img;
		const raw = stringify(value);
		const clone = <RegExp>parse(raw);

		assert.strictEqual(value.source, clone.source);
		assert.strictEqual(value.global, clone.global);
		assert.strictEqual(value.ignoreCase, clone.ignoreCase);
		assert.strictEqual(value.multiline, clone.multiline);
	});

	test('URI', () => {
		const value = URI.from({ scheme: 'file', authority: 'server', path: '/shares/c#files', query: 'q', fragment: 'f' });
		const raw = stringify(value);
		const clone = <URI>parse(raw);

		assert.strictEqual(value.scheme, clone.scheme);
		assert.strictEqual(value.authority, clone.authority);
		assert.strictEqual(value.path, clone.path);
		assert.strictEqual(value.query, clone.query);
		assert.strictEqual(value.fragment, clone.fragment);
	});

	test('Bug 16793:# in folder name => mirror models get out of sync', () => {
		const uri1 = URI.file('C:\\C#\\file.txt');
		assert.strictEqual(parse(stringify(uri1)).toString(), uri1.toString());
	});

	test('revives cyclic graphs once and preserves converted aliases', () => {
		const uri = URI.file('/graph').toJSON();
		const regexp = { $mid: MarshalledId.Regexp, source: 'graph', flags: 'gi' };
		const date = { $mid: MarshalledId.Date, source: '2026-01-01T00:00:00.000Z' };
		const graph = { uri, regexp, date, aliases: [uri, regexp, date], left: undefined as unknown, right: undefined as unknown };
		graph.left = graph;
		graph.right = graph;
		let visits = 0;
		Object.defineProperty(graph, '$mid', { get: () => { assert.strictEqual(++visits, 1); return undefined; } });

		const result = revive<typeof graph>(graph);

		assert.deepStrictEqual({
			uri: result.uri instanceof URI,
			regexp: result.regexp instanceof RegExp,
			date: result.date instanceof Date,
			aliases: result.aliases.map((value, i) => value === [result.uri, result.regexp, result.date][i]),
			cycles: result.left === result && result.right === result,
			visits
		}, { uri: true, regexp: true, date: true, aliases: [true, true, true], cycles: true, visits: 1 });
	});


	for (const initialDepth of [0, 198]) {
		test(`finishes a previously depth-limited object through a shallower alias at depth ${initialDepth}`, () => {
			const shared = { uri: URI.file('/depth').toJSON() };
			let deep: object = shared;
			for (let i = 0; i < 199 - initialDepth; i++) {
				deep = { child: deep };
			}
			const root = { deep, shallow: shared };

			const result = revive<typeof root>(root, initialDepth);

			assert.strictEqual(result.shallow, shared);
			assert.ok(result.shallow.uri instanceof URI);
		});
	}

	test('keeps a converted URI alias beyond the depth boundary', () => {
		const uri = URI.file('/converted').toJSON();
		const root = { first: uri, deep: { child: { child: uri } } };

		const result = revive<typeof root>(root, 198);

		assert.ok(result.first instanceof URI);
		assert.strictEqual(result.deep.child.child, result.first);
	});

});
