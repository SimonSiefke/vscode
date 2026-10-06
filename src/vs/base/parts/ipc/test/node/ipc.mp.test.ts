/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { MessagePortMain } from '../../../sandbox/node/electronTypes.js';
import { Protocol } from '../../node/ipc.mp.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../test/common/utils.js';

class TestMessagePort extends EventEmitter implements MessagePortMain {
	start(): void { }
	close(): void { }
	postMessage(): void { }
}

suite('IPC, MessagePortMain', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('ignores empty frames and shares the native listener until the last consumer leaves', () => {
		const port = new TestMessagePort();
		const protocol = new Protocol(port);
		const received: { header: unknown; body: unknown }[] = [];
		const first = disposables.add(protocol.onMessage((header, body) => received.push({ header, body })));
		const second = disposables.add(protocol.onMessage(() => { }));
		const whileListening = port.listenerCount('message');

		port.emit('message', { data: null, ports: [] });
		port.emit('message', { data: undefined, ports: [] });
		port.emit('message', { data: { header: [200, 1], body: 'ready' }, ports: [] });
		first.dispose();
		const withOneConsumer = port.listenerCount('message');
		second.dispose();

		assert.deepStrictEqual({ received, whileListening, withOneConsumer, afterDispose: port.listenerCount('message') }, {
			received: [{ header: [200, 1], body: 'ready' }],
			whileListening: 1,
			withOneConsumer: 1,
			afterDispose: 0,
		});
	});
});
