/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';
import { Server } from '../../node/ipc.structuredClone.mp.js';

suite('Structured clone utility-process IPC', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('disposes parent-port listeners and filters with each server', () => {
		const parentPort = Object.assign(new EventEmitter(), { postMessage: (_message: unknown) => { } });
		let calls = 0;
		const counts: number[] = [parentPort.listenerCount('message')];
		for (let i = 0; i < 3; i++) {
			const server = store.add(new Server({ handledClientConnection: () => { calls++; return true; } }, parentPort));
			counts.push(parentPort.listenerCount('message'));
			parentPort.emit('message', { data: 'live', ports: [] });
			server.dispose();
			counts.push(parentPort.listenerCount('message'));
			parentPort.emit('message', { data: 'after disposal', ports: [] });
		}
		assert.deepStrictEqual({ counts, calls }, { counts: [0, 1, 0, 1, 0, 1, 0], calls: 3 });
	});
});
