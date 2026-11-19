/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { clearMarks, getMarks, mark, markLatest } from '../../common/performance.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';
import { timeout } from '../../common/async.js';
import { runWithFakedTimers } from './virtualScheduling/index.js';

// Each test uses a unique prefix via a counter to avoid singleton state leaking between tests.
let testCounter = 0;
function uniquePrefix(): string {
	return `test/perf/${testCounter++}/`;
}

suite('clearMarks', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let prefix: string;

	setup(() => {
		prefix = uniquePrefix();
	});

	teardown(() => {
		clearMarks();
	});

	test('clears a specific mark by exact name', () => {
		const nameA = `${prefix}a`;
		const nameB = `${prefix}b`;
		mark(nameA);
		mark(nameB);

		clearMarks(nameA);

		const remaining = getMarks().filter(m => m.name.startsWith(prefix));
		assert.deepStrictEqual(remaining.map(m => m.name), [nameB]);
	});

	test('does not clear marks with a different name', () => {
		const name1 = `${prefix}a`;
		const name2 = `${uniquePrefix()}b`;
		mark(name1);
		mark(name2);

		clearMarks(name1);

		assert.strictEqual(getMarks().filter(m => m.name === name1).length, 0);
		assert.strictEqual(getMarks().filter(m => m.name === name2).length, 1);
	});
});

suite('markLatest', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => clearMarks());

	test('replaces the timestamp without creating native performance entries', () => {
		return runWithFakedTimers({ startTime: 1000 }, async () => {
			const first = `${uniquePrefix()}first`;
			const second = `${uniquePrefix()}second`;
			markLatest(first);
			await timeout(10);
			markLatest(second);
			await timeout(10);
			markLatest(first);

			assert.deepStrictEqual(getMarks().filter(mark => mark.name === first || mark.name === second), [
				{ name: second, startTime: 1010 },
				{ name: first, startTime: 1020 }
			]);
			assert.deepStrictEqual([first, second].map(name => performance.getEntriesByName(name, 'mark').length), [0, 0]);
		});
	});

	test('clears latest timestamps by exact name and together with other marks', () => {
		const prefix = uniquePrefix();
		const names = [`${prefix}a`, `${prefix}ab`, `${prefix}native`];
		const timeOrigin = getMarks().find(mark => mark.name === 'code/timeOrigin');
		markLatest(names[0]);
		markLatest(names[1]);
		mark(names[2]);

		clearMarks(names[0]);
		assert.deepStrictEqual(getMarks().filter(mark => mark.name.startsWith(prefix)).map(mark => mark.name).sort(), names.slice(1));

		clearMarks();
		assert.deepStrictEqual(getMarks(), timeOrigin ? [timeOrigin] : []);
	});
});
