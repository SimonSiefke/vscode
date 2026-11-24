/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { inputLatency } from '../../browser/performance.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('Browser performance', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('clears an incomplete input latency sample before starting another', async () => {
		performance.clearMarks();
		performance.clearMeasures();

		inputLatency.onKeyDown();
		await Promise.resolve();
		inputLatency.onKeyDown();
		await Promise.resolve();

		assert.strictEqual(performance.getEntriesByName('inputlatency/start').length, 1);
		assert.strictEqual(performance.getEntriesByName('keydown/start').length, 1);
		assert.strictEqual(performance.getEntriesByName('keydown/end').length, 1);

		inputLatency.onBeforeInput();
		inputLatency.onInput();
		await Promise.resolve();
		inputLatency.onRenderStart();
		await Promise.resolve();
		inputLatency.onKeyUp();
	});
});
