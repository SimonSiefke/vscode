/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IRPCMessage, RPCMessagePort, RPCMessageType } from '../../common/rpcMessagePort.js';

suite('RPCMessagePort', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const request: IRPCMessage = { type: RPCMessageType.Acknowledged, req: 1 };

	test('handshake listeners do not consume buffered RPC messages', async () => {
		const port = store.add(new RPCMessagePort(() => { }));
		const controls: string[] = [];
		store.add(port.onMessage(message => controls.push(message.toString())));
		port.acceptMessage(VSBuffer.fromString('ready').buffer);
		port.acceptMessage(request);
		assert.deepStrictEqual({ controls, request: await Event.toPromise(port.onRPCMessage) }, { controls: ['ready'], request });
	});

	test('sends frames immediately and keeps control/data order', async () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(structuredClone(message))));
		port.sendRPCMessage(request);
		port.send(VSBuffer.fromString('terminate'));
		port.sendRPCMessage({ type: RPCMessageType.Cancel, req: 1 });
		assert.deepStrictEqual(sent, [request, new Uint8Array(VSBuffer.fromString('terminate').buffer), { type: RPCMessageType.Cancel, req: 1 }]);
	});

	test('disposal drops buffered frames and prevents further sends', () => {
		const sent: unknown[] = [];
		const port = store.add(new RPCMessagePort(message => sent.push(message)));
		port.acceptMessage(request);
		port.dispose();
		store.add(port.onRPCMessage(message => sent.push(message)));
		port.sendRPCMessage(request);
		port.send(VSBuffer.fromString('ignored'));
		port.acceptMessage(request);
		assert.deepStrictEqual(sent, []);
	});
});
