/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../common/lifecycle.js';
import { IPCClient } from '../common/ipc.js';
import { Protocol as ElectronProtocol } from '../common/ipc.electron.js';
import { ipcRenderer } from '../../sandbox/electron-browser/globals.js';

/**
 * An implementation of `IPCClient` on top of Electron `ipcRenderer` IPC communication
 * provided from sandbox globals (via preload script).
 */
export class Client extends IPCClient implements IDisposable {

	private protocol: ElectronProtocol;

	private static createProtocol(): ElectronProtocol {
		const listeners = new Set<(header: unknown, body: unknown) => void>();
		const handler = (_: unknown, header: unknown, body: unknown) => {
			for (const listener of listeners) {
				listener(header, body);
			}
		};
		const onMessage = (listener: (header: unknown, body: unknown) => void): IDisposable => {
			if (listeners.size === 0) {
				ipcRenderer.on('vscode:message', handler);
			}
			listeners.add(listener);
			return toDisposable(() => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					ipcRenderer.removeListener('vscode:message', handler);
				}
			});
		};
		ipcRenderer.send('vscode:hello');

		return new ElectronProtocol(ipcRenderer, onMessage);
	}

	constructor(id: string) {
		const protocol = Client.createProtocol();
		super(protocol, id);

		this.protocol = protocol;
	}

	override dispose(): void {
		this.protocol.disconnect();
		super.dispose();
	}
}
