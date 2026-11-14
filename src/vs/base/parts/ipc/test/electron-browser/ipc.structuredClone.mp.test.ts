/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../common/event.js';
import { URI } from '../../../../common/uri.js';
import { VSBuffer } from '../../../../common/buffer.js';
import { Client } from '../../common/ipc.structuredClone.mp.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';

suite('Structured clone IPC, real MessagePort', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('bidirectional clients preserve contexts, URIs and buffer views', async () => {
		const { port1, port2 } = new MessageChannel();
		const one = store.add(new Client(port1, 'one'));
		const two = store.add(new Client(port2, 'two'));
		one.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
		two.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
		const value = { uri: URI.file('/test file'), bytes: VSBuffer.wrap(Uint8Array.from([9, 0xff, 0, 9]).subarray(1, 3)) };
		const results = await Promise.all([one.getChannel('echo').call<typeof value>('echo', value), two.getChannel('echo').call<typeof value>('echo', value)]);
		assert.deepStrictEqual(results.map(result => ({ uri: URI.revive(result.uri).toString(), bytes: [...result.bytes.buffer] })), [value, value].map(input => ({ uri: input.uri.toString(), bytes: [...input.bytes.buffer] })));
	});
});
