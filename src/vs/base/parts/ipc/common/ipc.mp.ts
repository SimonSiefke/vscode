/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../common/lifecycle.js';
import { IPCClient, IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from './ipc.js';

/**
 * Declare minimal `MessageEvent` and `MessagePort` interfaces here
 * so that this utility can be used both from `browser` and
 * `electron-main` namespace where message ports are available.
 */

export interface MessageEvent {

	data: IStructuredCloneMessage;
}

export interface MessagePort {

	addEventListener(type: 'message', listener: (this: MessagePort, e: MessageEvent) => unknown): void;
	removeEventListener(type: 'message', listener: (this: MessagePort, e: MessageEvent) => unknown): void;

	postMessage(message: IStructuredCloneMessage): void;

	start(): void;
	close(): void;
}

/**
 * The MessagePort `Protocol` leverages MessagePort style IPC communication
 * for the implementation of the `IMessagePassingProtocol`. That style of API
 * is a simple `onmessage` / `postMessage` pattern.
 */
export class Protocol implements IStructuredCloneMessagePassingProtocol {

	readonly type = 'structuredClone';
	private readonly listeners = new Set<(header: unknown, body: unknown) => void>();
	private readonly messageListener = (event: MessageEvent) => {
		for (const listener of this.listeners) {
			listener(event.data.header, event.data.body);
		}
	};

	constructor(private port: MessagePort) {
		// we must call start() to ensure messages are flowing
		port.start();
	}

	onMessage(listener: (header: unknown, body: unknown) => void): IDisposable {
		if (this.listeners.size === 0) {
			this.port.addEventListener('message', this.messageListener);
		}
		this.listeners.add(listener);
		return toDisposable(() => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.port.removeEventListener('message', this.messageListener);
			}
		});
	}

	send(header: unknown, body?: unknown): void {
		this.port.postMessage({ header, body });
	}

	disconnect(): void {
		this.port.close();
	}
}

/**
 * An implementation of a `IPCClient` on top of MessagePort style IPC communication.
 */
export class Client extends IPCClient implements IDisposable {

	private protocol: Protocol;

	constructor(port: MessagePort, clientId: string) {
		const protocol = new Protocol(port);
		super(protocol, clientId);

		this.protocol = protocol;
	}

	override dispose(): void {
		this.protocol.disconnect();

		super.dispose();
	}
}
