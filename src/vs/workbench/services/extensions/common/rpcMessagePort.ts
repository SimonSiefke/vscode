/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IMessagePassingProtocol, IStructuredCloneMessage, wrapStructuredCloneMessage } from '../../../../base/parts/ipc/common/ipc.js';
import { BufferedEmitter } from '../../../../base/parts/ipc/common/ipc.net.js';

/** Batch immutable native RPC frames while retaining binary/control ordering. */
export class RPCMessagePort implements IMessagePassingProtocol, IDisposable {
	private readonly messages = new BufferedEmitter<VSBuffer | IStructuredCloneMessage>();
	readonly onMessageWithStructuredClone = this.messages.event;
	readonly onMessage = Event.map(this.onMessageWithStructuredClone, message => message instanceof VSBuffer ? message : wrapStructuredCloneMessage(message));
	private pending: IStructuredCloneMessage[] | undefined;
	private pendingCharacters = 0;
	private scheduled = false;
	private nativeSentSinceReceive = false;
	private disposed = false;

	constructor(private readonly postMessage: (message: unknown) => void) { }

	acceptMessage(data: unknown): void {
		if (this.disposed) {
			return;
		}
		this.nativeSentSinceReceive = false;
		if (ArrayBuffer.isView(data)) {
			this.messages.fire(VSBuffer.wrap(data as Uint8Array));
		} else if (Array.isArray(data)) {
			for (const message of data) {
				if (this.disposed) {
					break;
				}
				this.messages.fire(message);
			}
		} else {
			this.messages.fire(data as IStructuredCloneMessage);
		}
	}

	send(buffer: VSBuffer): void {
		this.flush();
		if (!this.disposed) {
			this.postMessage(buffer.buffer);
		}
	}

	sendStructuredClone(message: IStructuredCloneMessage): void {
		if (this.disposed) {
			return;
		}
		if (!this.nativeSentSinceReceive) {
			this.nativeSentSinceReceive = true;
			this.flush();
			// A sequential request/reply exchange needs no batching microtask.
			this.postMessage(message);
			return;
		}
		const characters = typeof message.body === 'string' ? message.body.length : 0;
		// Keep large DTOs pipelined rather than building one long parsing task.
		if (this.pending && (this.pending.length >= 64 || this.pendingCharacters + characters > 16 * 1024)) {
			this.flush();
		}
		(this.pending ??= []).push(message);
		this.pendingCharacters += characters;
		if (characters >= 16 * 1024) {
			this.flush();
			return;
		}
		if (!this.scheduled) {
			this.scheduled = true;
			queueMicrotask(() => {
				this.scheduled = false;
				this.flush();
			});
		}
	}

	async drain(): Promise<void> {
		this.flush();
	}

	private flush(): void {
		const pending = this.pending;
		this.pending = undefined;
		this.pendingCharacters = 0;
		if (pending) {
			this.postMessage(pending.length === 1 ? pending[0] : pending);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.pending = undefined;
		this.pendingCharacters = 0;
		this.messages.flushBuffer();
	}
}
