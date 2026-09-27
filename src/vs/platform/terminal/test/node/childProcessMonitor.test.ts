/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import * as sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ChildProcessMonitor } from '../../node/childProcessMonitor.js';

suite('ChildProcessMonitor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('dispose cancels scheduled process refreshes', () => {
		const clock = sinon.useFakeTimers();
		try {
			const monitor = store.add(new ChildProcessMonitor(process.pid, new NullLogService()));
			monitor.handleOutput();
			monitor.handleOutput();

			strictEqual(clock.countTimers(), 2);

			monitor.dispose();
			strictEqual(clock.countTimers(), 0);
		} finally {
			clock.restore();
		}
	});
});
