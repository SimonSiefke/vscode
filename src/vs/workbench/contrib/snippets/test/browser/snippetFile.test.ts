/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { SnippetFile, Snippet, SnippetSource } from '../../browser/snippetsFile.js';
import { URI } from '../../../../../base/common/uri.js';
import { SnippetParser } from '../../../../../editor/contrib/snippet/browser/snippetParser.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Snippets', function () {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => sinon.restore());

	class TestSnippetFile extends SnippetFile {
		constructor(filepath: URI, snippets: Snippet[]) {
			super(SnippetSource.Extension, filepath, undefined, undefined, undefined!, undefined!);
			this.data.push(...snippets);
		}
	}

	test('SnippetFile#select', () => {
		let file = new TestSnippetFile(URI.file('somepath/foo.code-snippets'), []);
		let bucket: Snippet[] = [];
		file.select('', bucket);
		assert.strictEqual(bucket.length, 0);

		file = new TestSnippetFile(URI.file('somepath/foo.code-snippets'), [
			new Snippet(false, ['foo'], 'FooSnippet1', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['foo'], 'FooSnippet2', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['bar'], 'BarSnippet1', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['bar.comment'], 'BarSnippet2', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['bar.strings'], 'BarSnippet2', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['bazz', 'bazz'], 'BazzSnippet1', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
		]);

		bucket = [];
		file.select('foo', bucket);
		assert.strictEqual(bucket.length, 2);

		bucket = [];
		file.select('fo', bucket);
		assert.strictEqual(bucket.length, 0);

		bucket = [];
		file.select('bar', bucket);
		assert.strictEqual(bucket.length, 1);

		bucket = [];
		file.select('bar.comment', bucket);
		assert.strictEqual(bucket.length, 2);

		bucket = [];
		file.select('bazz', bucket);
		assert.strictEqual(bucket.length, 1);
	});

	test('SnippetFile#select - any scope', function () {

		const file = new TestSnippetFile(URI.file('somepath/foo.code-snippets'), [
			new Snippet(false, [], 'AnySnippet1', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
			new Snippet(false, ['foo'], 'FooSnippet1', 'foo', '', 'snippet', 'test', SnippetSource.User, generateUuid()),
		]);

		const bucket: Snippet[] = [];
		file.select('foo', bucket);
		assert.strictEqual(bucket.length, 2);

	});

	test('Snippet#needsClipboard', function () {

		function assertNeedsClipboard(body: string, expected: boolean): void {
			const snippet = new Snippet(false, ['foo'], 'FooSnippet1', 'foo', '', body, 'test', SnippetSource.User, generateUuid());
			assert.strictEqual(snippet.needsClipboard, expected);

			assert.strictEqual(SnippetParser.guessNeedsClipboard(body), expected);
		}

		assertNeedsClipboard('foo$CLIPBOARD', true);
		assertNeedsClipboard('${CLIPBOARD}', true);
		assertNeedsClipboard('foo${CLIPBOARD}bar', true);
		assertNeedsClipboard('foo$clipboard', false);
		assertNeedsClipboard('foo${clipboard}', false);
		assertNeedsClipboard('baba', false);
	});

	for (const warm of [false, true]) {
		for (const [body, expected] of [
			['plain text', false],
			['${SELECTION}', true],
			['$TM_SELECTED_TEXT', true],
			['${1:${TM_SELECTED_TEXT}}', true],
			['$CLIPBOARD', false],
		] as const) {
			test(`Snippet#usesSelection reuses one parse (${warm ? 'warm' : 'cold'}, ${body})`, () => {
				const parse = sinon.spy(SnippetParser.prototype, 'parse');
				const snippet = store.add(new Snippet(false, [], 'selection', '', '', body, 'test', SnippetSource.User, generateUuid()));
				if (warm) {
					void snippet.codeSnippet;
				}

				const first = snippet.usesSelection;
				const second = snippet.usesSelection;
				void snippet.codeSnippet;
				assert.deepStrictEqual({ first, second, parses: parse.callCount }, { first: expected, second: expected, parses: 1 });
			});
		}
	}

	test('Snippet#isTrivial', function () {

		function assertIsTrivial(body: string, expected: boolean): void {
			const snippet = new Snippet(false, ['foo'], 'FooSnippet1', 'foo', '', body, 'test', SnippetSource.User, generateUuid());
			assert.strictEqual(snippet.isTrivial, expected);
		}

		assertIsTrivial('foo', true);
		assertIsTrivial('foo$0', true);
		assertIsTrivial('foo$0bar', false);
		assertIsTrivial('foo$1', false);
		assertIsTrivial('foo$1$0', false);
		assertIsTrivial('${1:foo}', false);
	});

});
