/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, ok } from 'assert';
import { clearMarks, getMarks, mark, PerformanceMark } from '../../../../base/common/performance.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { markWindowPerformance } from '../../electron-main/windowPerformance.js';

suite('Window performance marks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const names = [
		'code/willCreateCodeWindow',
		'code/didCreateCodeWindow',
		'code/willRestoreCodeWindowState',
		'code/didRestoreCodeWindowState',
		'code/willCreateCodeBrowserWindow',
		'code/didCreateCodeBrowserWindow',
		'code/willOpenNewWindow'
	];
	const unrelated = 'window-performance-test/startup';
	const ownedNames = new Set([...names, unrelated]);
	let savedMarks: PerformanceMark[];

	setup(() => {
		savedMarks = getMarks().filter(mark => ownedNames.has(mark.name));
		for (const name of ownedNames) {
			clearMarks(name);
		}
	});

	teardown(() => {
		for (const name of ownedNames) {
			clearMarks(name);
		}
		for (const saved of savedMarks) {
			mark(saved.name, { startTime: saved.startTime });
		}
	});

	for (const name of names) {
		test(`keeps only the latest ${name} sample`, () => {
			for (let index = 0; index < 3; index++) {
				markWindowPerformance(name);
			}
			deepStrictEqual(getMarks().filter(mark => mark.name === name).map(mark => mark.name), [name]);
		});
	}

	test('replaces the previous timestamp instead of retaining the first window', () => {
		mark(names[0], { startTime: 1 });
		markWindowPerformance(names[0]);
		const samples = getMarks().filter(mark => mark.name === names[0]);
		deepStrictEqual(samples.length, 1);
		ok(samples[0].startTime > 1);
	});

	test('preserves unrelated main-process marks and other window sample names', () => {
		mark(unrelated, { startTime: 1 });
		mark(unrelated, { startTime: 2 });
		markWindowPerformance(names[1]);
		const previous = getMarks().filter(mark => mark.name === unrelated || mark.name === names[1]);
		markWindowPerformance(names[0]);
		markWindowPerformance(names[0]);
		deepStrictEqual(getMarks().filter(mark => mark.name === unrelated || mark.name === names[1]), previous);
	});

	test('does not mutate snapshots already sent to a renderer', () => {
		markWindowPerformance(names[0]);
		const snapshot = getMarks().filter(mark => mark.name === names[0]);
		const previous = snapshot.map(mark => ({ ...mark }));
		markWindowPerformance(names[0]);
		deepStrictEqual(snapshot, previous);
	});
});
