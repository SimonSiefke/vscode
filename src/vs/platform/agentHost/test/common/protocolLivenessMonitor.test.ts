/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { useFakeTimers } from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ProtocolLivenessMonitor } from '../../common/protocolLivenessMonitor.js';

suite('ProtocolLivenessMonitor', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('samples load only while a connection can time out', () => {
		const clock = useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		const options = {
			pingIntervalMs: 10_000,
			timeoutMs: 20_000,
			canCheck: () => true,
			onPing: () => { },
			onTimeout: () => { },
		};
		const local = disposables.add(new ProtocolLivenessMonitor({ ...options, canTimeout: () => false }));
		const firstRemote = disposables.add(new ProtocolLivenessMonitor(options));
		const secondRemote = disposables.add(new ProtocolLivenessMonitor(options));

		try {
			assert.strictEqual(clock.countTimers(), 0);
			local.reset();
			assert.strictEqual(clock.countTimers(), 0);

			firstRemote.reset();
			assert.strictEqual(clock.countTimers(), 1);
			firstRemote.recordInboundTraffic();
			assert.strictEqual(clock.countTimers(), 1);
			secondRemote.reset();
			assert.strictEqual(clock.countTimers(), 1);

			firstRemote.stop();
			assert.strictEqual(clock.countTimers(), 1);
			secondRemote.dispose();
			assert.strictEqual(clock.countTimers(), 0);

			firstRemote.reset();
			assert.strictEqual(clock.countTimers(), 1);
			firstRemote.dispose();
			assert.strictEqual(clock.countTimers(), 0);

			assert.throws(() => firstRemote.reset(), /disposed TimeoutTimer/);
			assert.strictEqual(clock.countTimers(), 0);
		} finally {
			firstRemote.dispose();
			secondRemote.dispose();
			local.dispose();
			clock.restore();
		}
	});
});
