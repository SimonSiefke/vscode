/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Lazy } from '../../common/lazy.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';
const regexpB1 = /\b1\b/;
const regexpCannotReadThe = /Cannot read the value of a lazy that is being initialized/;


suite('Lazy', () => {

	test('lazy values should only be resolved once', () => {
		let counter = 0;
		const value = new Lazy(() => ++counter);

		assert.strictEqual(value.hasValue, false);
		assert.strictEqual(value.value, 1);
		assert.strictEqual(value.hasValue, true);
		assert.strictEqual(value.value, 1); // make sure we did not evaluate again
	});

	test('lazy values handle error case', () => {
		let counter = 0;
		const value = new Lazy(() => { throw new Error(`${++counter}`); });

		assert.strictEqual(value.hasValue, false);
		assert.throws(() => value.value, regexpB1);
		assert.strictEqual(value.hasValue, true);
		assert.throws(() => value.value, regexpB1);
	});

	test('Should throw when accessing lazy value in initializer', () => {
		const value = new Lazy<string>((): string => { return value.value; });

		assert.throws(() => value.value, regexpCannotReadThe);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
