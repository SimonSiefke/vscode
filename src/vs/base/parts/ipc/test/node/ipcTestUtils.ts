/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageChannel } from 'worker_threads';
import { Event } from '../../../../common/event.js';
import { DisposableStore, toDisposable } from '../../../../common/lifecycle.js';
import { IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from '../../common/ipc.js';

export function createMessagePortProtocols(store: Pick<DisposableStore, 'add'>): [IStructuredCloneMessagePassingProtocol, IStructuredCloneMessagePassingProtocol] {
	const { port1, port2 } = new MessageChannel();
	store.add(toDisposable(() => {
		port1.close();
		port2.close();
	}));
	const createProtocol = (port: typeof port1): IStructuredCloneMessagePassingProtocol => ({
		type: 'structuredClone',
		send: message => port.postMessage(message),
		onMessage: Event.fromNodeEventEmitter<IStructuredCloneMessage>(port, 'message')
	});
	return [createProtocol(port1), createProtocol(port2)];
}
