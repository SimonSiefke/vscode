/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { buildReplaceStringWithCasePreserved } from '../../../../../base/common/search.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseReplaceString, ReplacePattern, ReplacePiece } from '../../browser/replacePattern.js';
const regexpFunc = /func (\w+)\(/;
const regexpHello = /hello(\w+)/;
const regexpHi = /hi/;
const regexpHi1 = /(hi)/;
const regexpHi2 = /(hi)()()()()()()()()()/;
const regexpBla = /bla/;
const regexpBla1 = /(bla)/;
const regexpLetRequire = /let\s+(\w+)\s*=\s*require\s*\(\s*['"]([\w\.\-/]+)\s*['"]\s*\)\s*/;
const regexpFor = /for(.*)/;
const regexp10 = /\b\s{3}\b/;
const regexpThisBla = /this(?=.*bla)/;
const regexpThIsBla = /(th)is(?=.*bla)/;
const regexpBlaStext = /bla(?=\stext$)/;
const regexpLaStext = /b(la)(?=\stext$)/;
const regexp15 = /a(z)?/;


suite('Replace Pattern test', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('parse replace string', () => {
		const testParse = (input: string, expectedPieces: ReplacePiece[]) => {
			const actual = parseReplaceString(input);
			const expected = new ReplacePattern(expectedPieces);
			assert.deepStrictEqual(actual, expected, 'Parsing ' + input);
		};

		// no backslash => no treatment
		testParse('hello', [ReplacePiece.staticValue('hello')]);

		// \t => TAB
		testParse('\\thello', [ReplacePiece.staticValue('\thello')]);
		testParse('h\\tello', [ReplacePiece.staticValue('h\tello')]);
		testParse('hello\\t', [ReplacePiece.staticValue('hello\t')]);

		// \n => LF
		testParse('\\nhello', [ReplacePiece.staticValue('\nhello')]);

		// \\t => \t
		testParse('\\\\thello', [ReplacePiece.staticValue('\\thello')]);
		testParse('h\\\\tello', [ReplacePiece.staticValue('h\\tello')]);
		testParse('hello\\\\t', [ReplacePiece.staticValue('hello\\t')]);

		// \\\t => \TAB
		testParse('\\\\\\thello', [ReplacePiece.staticValue('\\\thello')]);

		// \\\\t => \\t
		testParse('\\\\\\\\thello', [ReplacePiece.staticValue('\\\\thello')]);

		// \ at the end => no treatment
		testParse('hello\\', [ReplacePiece.staticValue('hello\\')]);

		// \ with unknown char => no treatment
		testParse('hello\\x', [ReplacePiece.staticValue('hello\\x')]);

		// \ with back reference => no treatment
		testParse('hello\\0', [ReplacePiece.staticValue('hello\\0')]);

		testParse('hello$&', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(0)]);
		testParse('hello$0', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(0)]);
		testParse('hello$02', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(0), ReplacePiece.staticValue('2')]);
		testParse('hello$1', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(1)]);
		testParse('hello$2', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(2)]);
		testParse('hello$9', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(9)]);
		testParse('$9hello', [ReplacePiece.matchIndex(9), ReplacePiece.staticValue('hello')]);

		testParse('hello$12', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(12)]);
		testParse('hello$99', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(99)]);
		testParse('hello$99a', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(99), ReplacePiece.staticValue('a')]);
		testParse('hello$1a', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(1), ReplacePiece.staticValue('a')]);
		testParse('hello$100', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(10), ReplacePiece.staticValue('0')]);
		testParse('hello$100a', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(10), ReplacePiece.staticValue('0a')]);
		testParse('hello$10a0', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(10), ReplacePiece.staticValue('a0')]);
		testParse('hello$$', [ReplacePiece.staticValue('hello$')]);
		testParse('hello$$0', [ReplacePiece.staticValue('hello$0')]);

		testParse('hello$`', [ReplacePiece.staticValue('hello$`')]);
		testParse('hello$\'', [ReplacePiece.staticValue('hello$\'')]);
	});

	test('parse replace string with case modifiers', () => {
		const testParse = (input: string, expectedPieces: ReplacePiece[]) => {
			const actual = parseReplaceString(input);
			const expected = new ReplacePattern(expectedPieces);
			assert.deepStrictEqual(actual, expected, 'Parsing ' + input);
		};
		function assertReplace(target: string, search: RegExp, replaceString: string, expected: string): void {
			const replacePattern = parseReplaceString(replaceString);
			const m = search.exec(target);
			const actual = replacePattern.buildReplaceString(m);

			assert.strictEqual(actual, expected, `${target}.replace(${search}, ${replaceString}) === ${expected}`);
		}

		// \U, \u => uppercase  \L, \l => lowercase  \E => cancel

		testParse('hello\\U$1', [ReplacePiece.staticValue('hello'), ReplacePiece.caseOps(1, ['U'])]);
		assertReplace('func privateFunc(', regexpFunc, 'func \\U$1(', 'func PRIVATEFUNC(');

		testParse('hello\\u$1', [ReplacePiece.staticValue('hello'), ReplacePiece.caseOps(1, ['u'])]);
		assertReplace('func privateFunc(', regexpFunc, 'func \\u$1(', 'func PrivateFunc(');

		testParse('hello\\L$1', [ReplacePiece.staticValue('hello'), ReplacePiece.caseOps(1, ['L'])]);
		assertReplace('func privateFunc(', regexpFunc, 'func \\L$1(', 'func privatefunc(');

		testParse('hello\\l$1', [ReplacePiece.staticValue('hello'), ReplacePiece.caseOps(1, ['l'])]);
		assertReplace('func PrivateFunc(', regexpFunc, 'func \\l$1(', 'func privateFunc(');

		testParse('hello$1\\u\\u\\U$4goodbye', [ReplacePiece.staticValue('hello'), ReplacePiece.matchIndex(1), ReplacePiece.caseOps(4, ['u', 'u', 'U']), ReplacePiece.staticValue('goodbye')]);
		assertReplace('hellogooDbye', regexpHello, 'hello\\u\\u\\l\\l\\U$1', 'helloGOodBYE');
	});

	test('replace has JavaScript semantics', () => {
		const testJSReplaceSemantics = (target: string, search: RegExp, replaceString: string, expected: string) => {
			const replacePattern = parseReplaceString(replaceString);
			const m = search.exec(target);
			const actual = replacePattern.buildReplaceString(m);

			assert.deepStrictEqual(actual, expected, `${target}.replace(${search}, ${replaceString})`);
		};

		testJSReplaceSemantics('hi', regexpHi, 'hello', 'hi'.replace(regexpHi, 'hello'));
		testJSReplaceSemantics('hi', regexpHi, '\\t', 'hi'.replace(regexpHi, '\t'));
		testJSReplaceSemantics('hi', regexpHi, '\\n', 'hi'.replace(regexpHi, '\n'));
		testJSReplaceSemantics('hi', regexpHi, '\\\\t', 'hi'.replace(regexpHi, '\\t'));
		testJSReplaceSemantics('hi', regexpHi, '\\\\n', 'hi'.replace(regexpHi, '\\n'));

		// implicit capture group 0
		testJSReplaceSemantics('hi', regexpHi, 'hello$&', 'hi'.replace(regexpHi, 'hello$&'));
		testJSReplaceSemantics('hi', regexpHi, 'hello$0', 'hi'.replace(regexpHi, 'hello$&'));
		testJSReplaceSemantics('hi', regexpHi, 'hello$&1', 'hi'.replace(regexpHi, 'hello$&1'));
		testJSReplaceSemantics('hi', regexpHi, 'hello$01', 'hi'.replace(regexpHi, 'hello$&1'));

		// capture groups have funny semantics in replace strings
		// the replace string interprets $nn as a captured group only if it exists in the search regex
		testJSReplaceSemantics('hi', regexpHi1, 'hello$10', 'hi'.replace(regexpHi1, 'hello$10'));
		testJSReplaceSemantics('hi', regexpHi2, 'hello$10', 'hi'.replace(regexpHi2, 'hello$10'));
		testJSReplaceSemantics('hi', regexpHi1, 'hello$100', 'hi'.replace(regexpHi1, 'hello$100'));
		testJSReplaceSemantics('hi', regexpHi1, 'hello$20', 'hi'.replace(regexpHi1, 'hello$20'));
	});

	test('get replace string if given text is a complete match', () => {
		function assertReplace(target: string, search: RegExp, replaceString: string, expected: string): void {
			const replacePattern = parseReplaceString(replaceString);
			const m = search.exec(target);
			const actual = replacePattern.buildReplaceString(m);

			assert.strictEqual(actual, expected, `${target}.replace(${search}, ${replaceString}) === ${expected}`);
		}

		assertReplace('bla', regexpBla, 'hello', 'hello');
		assertReplace('bla', regexpBla1, 'hello', 'hello');
		assertReplace('bla', regexpBla1, 'hello$0', 'hellobla');

		const searchRegex = regexpLetRequire;
		assertReplace('let fs = require(\'fs\')', searchRegex, 'import * as $1 from \'$2\';', 'import * as fs from \'fs\';');
		assertReplace('let something = require(\'fs\')', searchRegex, 'import * as $1 from \'$2\';', 'import * as something from \'fs\';');
		assertReplace('let something = require(\'fs\')', searchRegex, 'import * as $1 from \'$1\';', 'import * as something from \'something\';');
		assertReplace('let something = require(\'fs\')', searchRegex, 'import * as $2 from \'$1\';', 'import * as fs from \'something\';');
		assertReplace('let something = require(\'fs\')', searchRegex, 'import * as $0 from \'$0\';', 'import * as let something = require(\'fs\') from \'let something = require(\'fs\')\';');
		assertReplace('let fs = require(\'fs\')', searchRegex, 'import * as $1 from \'$2\';', 'import * as fs from \'fs\';');
		assertReplace('for ()', regexpFor, 'cat$1', 'cat ()');

		// issue #18111
		assertReplace('HRESULT OnAmbientPropertyChange(DISPID   dispid);', regexp10, ' ', ' ');
	});

	test('get replace string if match is sub-string of the text', () => {
		function assertReplace(target: string, search: RegExp, replaceString: string, expected: string): void {
			const replacePattern = parseReplaceString(replaceString);
			const m = search.exec(target);
			const actual = replacePattern.buildReplaceString(m);

			assert.strictEqual(actual, expected, `${target}.replace(${search}, ${replaceString}) === ${expected}`);
		}
		assertReplace('this is a bla text', regexpBla, 'hello', 'hello');
		assertReplace('this is a bla text', regexpThisBla, 'that', 'that');
		assertReplace('this is a bla text', regexpThIsBla, '$1at', 'that');
		assertReplace('this is a bla text', regexpThIsBla, '$1e', 'the');
		assertReplace('this is a bla text', regexpThIsBla, '$1ere', 'there');
		assertReplace('this is a bla text', regexpThIsBla, '$1', 'th');
		assertReplace('this is a bla text', regexpThIsBla, 'ma$1', 'math');
		assertReplace('this is a bla text', regexpThIsBla, 'ma$1s', 'maths');
		assertReplace('this is a bla text', regexpThIsBla, '$0', 'this');
		assertReplace('this is a bla text', regexpThIsBla, '$0$1', 'thisth');
		assertReplace('this is a bla text', regexpBlaStext, 'foo', 'foo');
		assertReplace('this is a bla text', regexpLaStext, 'f$1', 'fla');
		assertReplace('this is a bla text', regexpLaStext, 'f$0', 'fbla');
		assertReplace('this is a bla text', regexpLaStext, '$0ah', 'blaah');
	});

	test('issue #19740 Find and replace capture group/backreference inserts `undefined` instead of empty string', () => {
		const replacePattern = parseReplaceString('a{$1}');
		const matches = regexp15.exec('abcd');
		const actual = replacePattern.buildReplaceString(matches);
		assert.strictEqual(actual, 'a{}');
	});

	test('buildReplaceStringWithCasePreserved test', () => {
		function assertReplace(target: string[], replaceString: string, expected: string): void {
			let actual: string = '';
			actual = buildReplaceStringWithCasePreserved(target, replaceString);
			assert.strictEqual(actual, expected);
		}

		assertReplace(['abc'], 'Def', 'def');
		assertReplace(['Abc'], 'Def', 'Def');
		assertReplace(['ABC'], 'Def', 'DEF');
		assertReplace(['abc', 'Abc'], 'Def', 'def');
		assertReplace(['Abc', 'abc'], 'Def', 'Def');
		assertReplace(['ABC', 'abc'], 'Def', 'DEF');
		assertReplace(['aBc', 'abc'], 'Def', 'def');
		assertReplace(['AbC'], 'Def', 'Def');
		assertReplace(['aBC'], 'Def', 'def');
		assertReplace(['aBc'], 'DeF', 'deF');
		assertReplace(['Foo-Bar'], 'newfoo-newbar', 'Newfoo-Newbar');
		assertReplace(['Foo-Bar-Abc'], 'newfoo-newbar-newabc', 'Newfoo-Newbar-Newabc');
		assertReplace(['Foo-Bar-abc'], 'newfoo-newbar', 'Newfoo-newbar');
		assertReplace(['foo-Bar'], 'newfoo-newbar', 'newfoo-Newbar');
		assertReplace(['foo-BAR'], 'newfoo-newbar', 'newfoo-NEWBAR');
		assertReplace(['foO-BAR'], 'NewFoo-NewBar', 'newFoo-NEWBAR');
		assertReplace(['Foo_Bar'], 'newfoo_newbar', 'Newfoo_Newbar');
		assertReplace(['Foo_Bar_Abc'], 'newfoo_newbar_newabc', 'Newfoo_Newbar_Newabc');
		assertReplace(['Foo_Bar_abc'], 'newfoo_newbar', 'Newfoo_newbar');
		assertReplace(['Foo_Bar-abc'], 'newfoo_newbar-abc', 'Newfoo_newbar-abc');
		assertReplace(['foo_Bar'], 'newfoo_newbar', 'newfoo_Newbar');
		assertReplace(['Foo_BAR'], 'newfoo_newbar', 'Newfoo_NEWBAR');
	});

	test('preserve case', () => {
		function assertReplace(target: string[], replaceString: string, expected: string): void {
			const replacePattern = parseReplaceString(replaceString);
			const actual = replacePattern.buildReplaceString(target, true);
			assert.strictEqual(actual, expected);
		}

		assertReplace(['abc'], 'Def', 'def');
		assertReplace(['Abc'], 'Def', 'Def');
		assertReplace(['ABC'], 'Def', 'DEF');
		assertReplace(['abc', 'Abc'], 'Def', 'def');
		assertReplace(['Abc', 'abc'], 'Def', 'Def');
		assertReplace(['ABC', 'abc'], 'Def', 'DEF');
		assertReplace(['aBc', 'abc'], 'Def', 'def');
		assertReplace(['AbC'], 'Def', 'Def');
		assertReplace(['aBC'], 'Def', 'def');
		assertReplace(['aBc'], 'DeF', 'deF');
		assertReplace(['Foo-Bar'], 'newfoo-newbar', 'Newfoo-Newbar');
		assertReplace(['Foo-Bar-Abc'], 'newfoo-newbar-newabc', 'Newfoo-Newbar-Newabc');
		assertReplace(['Foo-Bar-abc'], 'newfoo-newbar', 'Newfoo-newbar');
		assertReplace(['foo-Bar'], 'newfoo-newbar', 'newfoo-Newbar');
		assertReplace(['foo-BAR'], 'newfoo-newbar', 'newfoo-NEWBAR');
		assertReplace(['foO-BAR'], 'NewFoo-NewBar', 'newFoo-NEWBAR');
		assertReplace(['Foo_Bar'], 'newfoo_newbar', 'Newfoo_Newbar');
		assertReplace(['Foo_Bar_Abc'], 'newfoo_newbar_newabc', 'Newfoo_Newbar_Newabc');
		assertReplace(['Foo_Bar_abc'], 'newfoo_newbar', 'Newfoo_newbar');
		assertReplace(['Foo_Bar-abc'], 'newfoo_newbar-abc', 'Newfoo_newbar-abc');
		assertReplace(['foo_Bar'], 'newfoo_newbar', 'newfoo_Newbar');
		assertReplace(['foo_BAR'], 'newfoo_newbar', 'newfoo_NEWBAR');
	});
});
