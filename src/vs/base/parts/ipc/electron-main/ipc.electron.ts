/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents } from 'electron';
import { validatedIpcMain } from './ipcMain.js';
import { VSBuffer } from '../../../common/buffer.js';
import { Emitter, Event } from '../../../common/event.js';
import { IDisposable, toDisposable } from '../../../common/lifecycle.js';
import { ClientConnectionEvent, IPCServer } from '../common/ipc.js';
import { Protocol as ElectronProtocol } from '../common/ipc.electron.js';

interface IIPCEvent {
	event: { sender: WebContents };
	message: Buffer | null;
}

interface IScopedEventResult extends IDisposable {
	readonly event: Event<VSBuffer | null>;
}

function createScopedOnMessageEvent(senderId: number, eventName: string): IScopedEventResult {
	const emitter = new Emitter<IIPCEvent>({ onWillAddFirstListener: () => validatedIpcMain.on(eventName, fn), onDidRemoveLastListener: () => validatedIpcMain.removeListener(eventName, fn) });
	const fn = (event: Electron.IpcMainEvent, message: Buffer | null) => {
		if (event.sender.id === senderId) {
			emitter.fire({ event: { sender: event.sender as WebContents }, message });
		}
	};

	const onMessage = emitter.event;
	const scopedEvent = Event.map(onMessage, ({ message }) => message ? VSBuffer.wrap(message) : message);

	return {
		event: scopedEvent,
		dispose: () => emitter.dispose()
	};
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
			const client = Server.Clients.get(id);

			client?.dispose();

			const onDidClientReconnect = new Emitter<void>();
			const messageEvent = createScopedOnMessageEvent(id, 'vscode:message');
			const disconnectEvent = createScopedOnMessageEvent(id, 'vscode:disconnect');

			Server.Clients.set(id, toDisposable(() => {
				onDidClientReconnect.fire();
				messageEvent.dispose();
				disconnectEvent.dispose();
				onDidClientReconnect.dispose();
			}));

			const onMessage = messageEvent.event as Event<VSBuffer>;
			const onDidClientDisconnect = Event.any(Event.signal(disconnectEvent.event), onDidClientReconnect.event);
			const protocol = new ElectronProtocol(webContents, onMessage);

			return { protocol, onDidClientDisconnect };
		});
	}

	constructor() {
		super(Server.getOnDidClientConnect());
	}

	override dispose(): void {
		Server.Clients.forEach(disposable => disposable.dispose());
		Server.Clients.clear();
		super.dispose();
	}
}
