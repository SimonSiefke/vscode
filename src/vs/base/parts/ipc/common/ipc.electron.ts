/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../common/event.js';
import { IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from './ipc.js';

export interface Sender {
	send(channel: string, ...args: unknown[]): void;
}

/**
 * The Electron `Protocol` leverages Electron style IPC communication (`ipcRenderer`, `ipcMain`)
 * for the implementation of the `IMessagePassingProtocol`. That style of API requires a channel
 * name for sending data.
 */
export class Protocol implements IStructuredCloneMessagePassingProtocol {

	readonly type = 'structuredClone';

	constructor(private sender: Sender, readonly onMessage: Event<IStructuredCloneMessage>) { }

	send(header: unknown, body?: unknown): void {
		try {
			if (typeof body === 'undefined') {
				this.sender.send('vscode:message', header);
			} else {
				this.sender.send('vscode:message', header, body);
			}
		} catch (e) {
			// systems are going down
		}
	}

	disconnect(): void {
		this.sender.send('vscode:disconnect', null);
	}
}
