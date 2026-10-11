/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ITerminalChildProcess } from '../../common/terminal.js';
import { AutoRepliesPtyServiceContribution } from '../../node/terminalContrib/autoReplies/autoRepliesContribController.js';

suite('AutoRepliesPtyServiceContribution', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const configureBeforeReady of [true, false]) {
		test(`isolates configuration changes across terminals configured ${configureBeforeReady ? 'before' : 'after'} ready`, () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const contribution = new AutoRepliesPtyServiceContribution(new NullLogService());
			const dataA = store.add(new Emitter<string>());
			const dataB = store.add(new Emitter<string>());
			const repliesA: string[] = [];
			const repliesB: string[] = [];
			const processA = new class extends mock<ITerminalChildProcess>() {
				override readonly onProcessData = dataA.event;
				override input(value: string): void { repliesA.push(value); }
			};
			const processB = new class extends mock<ITerminalChildProcess>() {
				override readonly onProcessData = dataB.event;
				override input(value: string): void { repliesB.push(value); }
			};
			try {
				if (!configureBeforeReady) {
					contribution.handleProcessReady(1, processA);
					contribution.handleProcessReady(2, processB);
				}
				contribution.setAutoReplies(1, { prompt: 'A', 'A only': 'A only reply' });
				contribution.setAutoReplies(2, { prompt: 'B', 'B only': 'B only reply' });
				if (configureBeforeReady) {
					contribution.handleProcessReady(1, processA);
					contribution.handleProcessReady(2, processB);
				}
				dataA.fire('prompt');
				dataB.fire('prompt');
				assert.deepStrictEqual([repliesA, repliesB], [['A'], ['B']]);
				await timeout(1100);
				contribution.setAutoReplies(2, { prompt: 'B updated', 'B only': null });
				dataA.fire('prompt');
				dataB.fire('prompt');
				dataB.fire('B only');
				dataB.fire('A only');
				assert.deepStrictEqual([repliesA, repliesB], [['A', 'A'], ['B', 'B updated']]);
				await timeout(1100);
				contribution.setAutoReplies(2, {});
				contribution.handleProcessReady(2, processB);
				dataA.fire('prompt');
				dataB.fire('prompt');
				assert.deepStrictEqual([repliesA, repliesB], [['A', 'A', 'A'], ['B', 'B updated']]);
			} finally {
				contribution.handleProcessDispose(1);
				contribution.handleProcessDispose(2);
				await timeout(1100);
			}
		}));
	}

	test('replaces configuration on reattachment and forgets disposed processes', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const contribution = new AutoRepliesPtyServiceContribution(new NullLogService());
		const data = store.add(new Emitter<string>());
		const replies: string[] = [];
		const process = new class extends mock<ITerminalChildProcess>() {
			override readonly onProcessData = data.event;
			override input(value: string): void { replies.push(value); }
		};
		try {
			contribution.setAutoReplies(1, { prompt: 'old' });
			contribution.handleProcessReady(1, process);
			contribution.setAutoReplies(1, { prompt: 'new', '': 'invalid', empty: '', disabled: null });
			contribution.handleProcessReady(1, process);
			data.fire('prompt');
			assert.deepStrictEqual(replies, ['new']);
			contribution.handleProcessDispose(1);
			assert.strictEqual(data.hasListeners(), false);
			contribution.handleProcessReady(1, process);
			data.fire('prompt');
			assert.deepStrictEqual(replies, ['new']);
		} finally {
			contribution.handleProcessDispose(1);
			await timeout(1100);
		}
	}));

	test('does not duplicate replies when a persistent process becomes ready again', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const data = store.add(new Emitter<string>());
		const replies: string[] = [];
		const process = new class extends mock<ITerminalChildProcess>() {
			override readonly onProcessData = data.event;
			override input(value: string): void { replies.push(value); }
		};
		const contribution = new AutoRepliesPtyServiceContribution(new NullLogService());
		try {
			contribution.setAutoReplies(1, { prompt: 'reply' });
			contribution.handleProcessReady(1, process);
			// Simulates the replay that happens when the process is reattached
			contribution.handleProcessReady(1, process);
			data.fire('prompt');

			assert.deepStrictEqual(replies, ['reply']);
		} finally {
			contribution.handleProcessDispose(1);
			// Let the response throttle finish (in virtual time) before checking disposable ownership.
			await timeout(1100);
		}
	}));
});
