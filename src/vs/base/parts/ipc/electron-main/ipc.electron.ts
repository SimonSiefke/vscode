/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents } from 'electron';
import { validatedIpcMain } from './ipcMain.js';
import { VSBuffer } from '../../../common/buffer.js';
import { Emitter, Event } from '../../../common/event.js';
import { DisposableStore, IDisposable, combinedDisposable, toDisposable } from '../../../common/lifecycle.js';
import { ClientConnectionEvent, IPCServer } from '../common/ipc.js';
import { Protocol as ElectronProtocol } from '../common/ipc.electron.js';

interface IIPCEvent {
	event: { sender: WebContents };
	message: Buffer | null;
}

function createScopedOnMessageEvent(senderId: number, eventName: string, disposables: DisposableStore): Event<VSBuffer | null> {
	const onMessage = Event.fromNodeEventEmitter<IIPCEvent>(validatedIpcMain, eventName, (event, message) => ({ event, message }));
	const onMessageFromSender = Event.filter(onMessage, ({ event }) => event.sender.id === senderId, disposables);

	return Event.map(onMessageFromSender, ({ message }) => message ? VSBuffer.wrap(message) : message, disposables);
}

/**
 * An implementation of `IPCServer` on top of Electron `ipcMain` API.
 */
export class Server extends IPCServer {

	private static readonly Clients = new Map<number, IDisposable>();

	private static getOnDidClientConnect(): Event<ClientConnectionEvent> {
		const onHello = Event.fromNodeEventEmitter<WebContents>(validatedIpcMain, 'vscode:hello', ({ sender }) => sender);

		return Event.map(onHello, webContents => {
			const id = webContents.id;
			const oldClient = Server.Clients.get(id);

			oldClient?.dispose();

			const disposables = new DisposableStore();
			const onDidClientReconnect = new Emitter<void>();
			
			const clientDisposable = combinedDisposable([
				toDisposable(() => onDidClientReconnect.fire()),
				disposables
			]);
			
			Server.Clients.set(id, clientDisposable);

			const onMessage = createScopedOnMessageEvent(id, 'vscode:message', disposables) as Event<VSBuffer>;
			const disconnectEvent = createScopedOnMessageEvent(id, 'vscode:disconnect', disposables);
			
			const onDidClientDisconnect = Event.map(Event.any(Event.signal(disconnectEvent), onDidClientReconnect.event), () => {
				const currentClient = Server.Clients.get(id);
				if (currentClient === clientDisposable) {
					Server.Clients.delete(id);
					clientDisposable.dispose();
				}
			});
			
			const protocol = new ElectronProtocol(webContents, onMessage);

			return { protocol, onDidClientDisconnect };
		});
	}

	constructor() {
		super(Server.getOnDidClientConnect());
	}
}
