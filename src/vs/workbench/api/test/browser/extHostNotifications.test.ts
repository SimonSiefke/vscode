/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { Emitter } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IStructuredCloneMessage } from '../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TerminalDataBufferer } from '../../../../platform/terminal/common/terminalDataBuffering.js';
import { ProxyIdentifier } from '../../../services/extensions/common/proxyIdentifier.js';
import { RPCMessagePort } from '../../../services/extensions/common/rpcMessagePort.js';
import { RPCProtocol } from '../../../services/extensions/common/rpcProtocol.js';
import { IMarkerChange, MainContext, MainThreadDiagnosticsShape, MainThreadTerminalServiceShape } from '../../common/extHost.protocol.js';
import { DiagnosticCollection } from '../../common/extHostDiagnostics.js';
import { Diagnostic, Range } from '../../common/extHostTypes.js';
import type * as vscode from 'vscode';

suite('Extension host native notifications', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const barrierIdentifier = new ProxyIdentifier<{ $barrier(): number }>('notification-barrier');

	/** Use real ports and a completion-bearing barrier while observing ignored empty replies. */
	function createPeers() {
		const pair = new MessageChannel();
		store.add(toDisposable(() => {
			pair.port1.close();
			pair.port2.close();
		}));
		let emptyReplies = 0;
		const clientPort = store.add(new RPCMessagePort(message => pair.port1.postMessage(message)));
		const serverPort = store.add(new RPCMessagePort(message => {
			if (ArrayBuffer.isView(message)) {
				if ((message as Uint8Array)[0] === 7) {
					emptyReplies++;
				}
			} else {
				for (const frame of (Array.isArray(message) ? message : [message]) as IStructuredCloneMessage[]) {
					if (typeof frame.header === 'number' && (frame.header & 31) === 7) {
						emptyReplies++;
					}
				}
			}
			pair.port2.postMessage(message);
		}));
		pair.port1.onmessage = event => clientPort.acceptMessage(event.data);
		pair.port2.onmessage = event => serverPort.acceptMessage(event.data);
		pair.port1.start();
		pair.port2.start();
		const client = store.add(new RPCProtocol(clientPort));
		const server = store.add(new RPCProtocol(serverPort));
		server.set(barrierIdentifier, { $barrier: () => 1 });
		return { client, server, barrier: client.getProxy(barrierIdentifier), emptyReplies: () => emptyReplies };
	}

	test('diagnostic collection changes and disposal retain order without ignored replies', async () => {
		const clock = sinon.useFakeTimers({ toFake: ['Date'] });
		try {
			const peers = createPeers();
			const changes: [string, number][] = [];
			peers.server.set(MainContext.MainThreadDiagnostics, new class extends mock<MainThreadDiagnosticsShape>() {
				override $changeMany(owner: string, entries: IMarkerChange[]): void {
					for (const [resource, markers] of entries) {
						changes.push([`${owner}:${URI.from(resource).path}`, markers?.length ?? 0]);
					}
				}
				override $clear(owner: string): void {
					changes.push([`${owner}:clear`, 0]);
				}
			});
			const changed = store.add(new Emitter<readonly vscode.Uri[]>());
			const collection = store.add(new DiagnosticCollection('diagnostics', 'owner', 100, 100, () => undefined, extUri, peers.client.getProxy(MainContext.MainThreadDiagnostics), changed));
			await peers.barrier.$barrier();
			const resource = URI.parse('test:///diagnostics.txt');
			collection.set(resource, [new Diagnostic(new Range(0, 0, 0, 1), 'diagnostic')]);
			collection.delete(resource);
			collection.dispose();
			await peers.barrier.$barrier();
			assert.deepStrictEqual(changes, [['owner:/diagnostics.txt', 1], ['owner:/diagnostics.txt', 0], ['owner:clear', 0]]);
			assert.strictEqual(peers.emptyReplies(), 0);
		} finally {
			clock.restore();
		}
	});

	test('buffered terminal output is delivered before exit without ignored replies', async () => {
		const clock = sinon.useFakeTimers({ toFake: ['Date'] });
		try {
			const peers = createPeers();
			const events: [number, string][] = [];
			peers.server.set(MainContext.MainThreadTerminalService, new class extends mock<MainThreadTerminalServiceShape>() {
				override $sendProcessData(id: number, data: string): void {
					events.push([id, data]);
				}
				override $sendProcessExit(id: number, code: number | undefined): void {
					events.push([id, `exit:${code}`]);
				}
			});
			const proxy = peers.client.getProxy(MainContext.MainThreadTerminalService);
			const data = store.add(new Emitter<string>());
			const bufferer = store.add(new TerminalDataBufferer(proxy.$sendProcessData));
			store.add(bufferer.startBuffering(7, data.event));
			await peers.barrier.$barrier();
			data.fire('first');
			data.fire(' second');
			bufferer.stopBuffering(7);
			proxy.$sendProcessExit(7, undefined);
			await peers.barrier.$barrier();
			assert.deepStrictEqual(events, [[7, 'first second'], [7, 'exit:undefined']]);
			assert.strictEqual(peers.emptyReplies(), 0);
		} finally {
			clock.restore();
		}
	});
});
