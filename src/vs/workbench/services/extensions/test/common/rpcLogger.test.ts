/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestTelemetryService } from '../../../../../platform/telemetry/test/common/testTelemetryService.js';
import { ExtensionHostKind } from '../../common/extensionHostKind.js';
import { RPCLogger, TelemetryRPCLogger } from '../../common/rpcLogger.js';
import { RequestInitiator } from '../../common/rpcProtocol.js';

suite('RPC loggers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('omits unknown telemetry sizes and preserves reply bookkeeping and real zero', () => {
		const telemetry = new TestTelemetryService<{ type: string; length: number }>();
		const logger = new TelemetryRPCLogger(telemetry);
		logger.logOutgoing(undefined, 1, RequestInitiator.LocalSide, 'request: unknown(');
		logger.logIncoming(undefined, 1, RequestInitiator.LocalSide, 'ack');
		logger.logIncoming(7, 1, RequestInitiator.LocalSide, 'receiveReply:');
		logger.logOutgoing(3, 2, RequestInitiator.LocalSide, 'request: known(');
		logger.logIncoming(undefined, 2, RequestInitiator.LocalSide, 'receiveReplyErr:');
		logger.logIncoming(5, 2, RequestInitiator.LocalSide, 'receiveReply:');
		logger.logIncoming(undefined, 3, RequestInitiator.OtherSide, 'receiveRequest unknown(');
		logger.logOutgoing(0, 4, RequestInitiator.LocalSide, 'request: zero(');
		logger.logIncoming(0, 4, RequestInitiator.LocalSide, 'receiveReply:');

		assert.deepStrictEqual(telemetry.events, [
			{ name: 'extensionhost.incoming', data: { type: 'receiveReply: request: unknown(', length: 7 } },
			{ name: 'extensionhost.outgoing', data: { type: 'request: known(', length: 3 } },
			{ name: 'extensionhost.incoming', data: { type: 'receiveReply: unknown_reply', length: 5 } },
			{ name: 'extensionhost.outgoing', data: { type: 'request: zero(', length: 0 } },
			{ name: 'extensionhost.incoming', data: { type: 'receiveReply: request: zero(', length: 0 } }
		]);
	});

	test('keeps unknown diagnostic totals unknown without changing measured byte totals', () => {
		const messages: string[] = [];
		const logger = new RPCLogger(ExtensionHostKind.LocalProcess, (...args) => messages.push(String(args[0])));
		logger.logOutgoing(18, 1, RequestInitiator.LocalSide, 'request: known(');
		logger.logOutgoing(undefined, 2, RequestInitiator.LocalSide, 'request: unknown(');
		logger.logOutgoing(8, 3, RequestInitiator.LocalSide, 'request: later(');
		logger.logIncoming(4, 1, RequestInitiator.LocalSide, 'receiveReply:');

		assert.deepStrictEqual(messages.map(message => /\[ *([^\]]+)\]%c\[len: *([^\]]+)\]/.exec(message)?.slice(1)), [
			['18', '18'], ['unknown', 'unknown'], ['unknown', '8'], ['4', '4']
		]);
	});
});
