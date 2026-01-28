/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents } from 'electron';
import { validatedIpcMain } from './ipcMain.js';
import { VSBuffer } from '../../../common/buffer.js';
import { Emitter, Event } from '../../../common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../common/lifecycle.js';
import { ClientConnectionEvent, IPCServer } from '../common/ipc.js';
import { Protocol as ElectronProtocol } from '../common/ipc.electron.js';

interface IIPCEvent {
	event: { sender: WebContents };
	message: Buffer | null;
}

function createScopedOnMessageEvent(senderId: number, eventName: string, store: DisposableStore): Event<VSBuffer | null> {
	const fn = (event: { sender: WebContents }, message: Buffer | null) => messageEmitter.fire({ event, message });
	const messageEmitter = store.add(new Emitter<IIPCEvent>({
		onWillAddFirstListener: () => validatedIpcMain.on(eventName, fn),
		onDidRemoveLastListener: () => validatedIpcMain.removeListener(eventName, fn)
	}));
	const onMessage = messageEmitter.event;
	const onMessageFromSender = Event.filter(onMessage, ({ event }) => event.sender.id === senderId, store);

	return Event.map(onMessageFromSender, ({ message }) => message ? VSBuffer.wrap(message) : message, store);
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

			const store = new DisposableStore();
			const onDidClientReconnect = store.add(new Emitter<void>());
			const onMessage = createScopedOnMessageEvent(id, 'vscode:message', store) as Event<VSBuffer>;

			let destroyedHandler: (() => void) | undefined;
			const destroyedEmitter = new Emitter<void>({
				onWillAddFirstListener: () => {
					destroyedHandler = () => destroyedEmitter.fire();
					webContents.once('destroyed', destroyedHandler);
				},
				onDidRemoveLastListener: () => {
					if (destroyedHandler && !webContents.isDestroyed()) {
						webContents.removeListener('destroyed', destroyedHandler);
					}
				}
			});
			store.add(destroyedEmitter);
			const onDidClientDisconnect = Event.any(
				Event.signal(createScopedOnMessageEvent(id, 'vscode:disconnect', store)),
				onDidClientReconnect.event,
				destroyedEmitter.event
			);

			const disposable = toDisposable(() => {
				onDidClientReconnect.fire();
				store.dispose();
			});

			Server.Clients.set(id, disposable);

			Event.once(onDidClientDisconnect)(() => {
				Server.Clients.delete(id);
				disposable.dispose();
			});

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
