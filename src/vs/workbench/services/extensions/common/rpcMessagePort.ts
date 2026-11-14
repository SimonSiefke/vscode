/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IMessagePassingProtocol } from '../../../../base/parts/ipc/common/ipc.js';
import { BufferedEmitter } from '../../../../base/parts/ipc/common/ipc.net.js';

/** Native RPC frame; routing fields are carried only by requests. */
export interface IRPCMessage {
	readonly header: number;
	readonly body: unknown;
}

/** Local RPC transport; the byte stream is reserved for startup and termination handshakes. */
export interface IStructuredCloneRPCTransport extends IMessagePassingProtocol {
	readonly onRPCMessage: Event<IRPCMessage>;
	sendRPCBuffer(message: VSBuffer): void;

	sendRPCMessage(message: IRPCMessage): void;
}

export function isStructuredCloneRPCTransport(protocol: IMessagePassingProtocol): protocol is IStructuredCloneRPCTransport {
	return 'onRPCMessage' in protocol && 'sendRPCMessage' in protocol && 'sendRPCBuffer' in protocol;
}

/** Batch immutable native RPC frames while retaining binary/control ordering. */
export class RPCMessagePort implements IStructuredCloneRPCTransport, IDisposable {
	private readonly messages = new BufferedEmitter<IRPCMessage>();
	private readonly controls = new BufferedEmitter<VSBuffer>();
	private readonly subscriptions = new DisposableStore();
	readonly onRPCMessage = Event.map(this.messages.event, message => message, this.subscriptions);
	readonly onMessage = Event.map(this.controls.event, message => message, this.subscriptions);
	private deliveryDepth = 0;

	private pending: IRPCMessage[] | undefined;
	private pendingCharacters = 0;
	private scheduled = false;
	private nativeSentSinceReceive = false;
	private disposed = false;
	private readonly incoming: IRPCMessage[] = [];
	private incomingIndex = 0;
	private delivering = false;

	constructor(private readonly postMessage: (message: unknown) => void, private readonly batching = true) { }

	acceptMessage(data: unknown): void {
		if (this.disposed || !data) {
			return;
		}
		this.nativeSentSinceReceive = Array.isArray(data) && data.length > 1;
		if (ArrayBuffer.isView(data)) {
			if (data.byteLength > 0) {
				this.fireMessage(VSBuffer.wrap(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
			}
		} else {
			this.incoming.push(...(Array.isArray(data) ? data : [data]) as IRPCMessage[]);
			if (this.delivering) {
				return;
			}
			this.delivering = true;
			try {
				while (!this.disposed && this.incomingIndex < this.incoming.length) {
					this.fireMessage(this.incoming[this.incomingIndex++]);
				}
			} finally {
				this.incoming.length = 0;
				this.incomingIndex = 0;
				this.delivering = false;
			}
		}
	}

	private fireMessage(message: VSBuffer | IRPCMessage): void {
		this.deliveryDepth++;
		try {
			if (message instanceof VSBuffer) {
				this.controls.fire(message);
			} else {
				this.messages.fire(message);
			}
		} finally {
			if (--this.deliveryDepth === 0 && this.disposed) {
				this.subscriptions.dispose();
			}
		}
	}

	send(buffer: VSBuffer): void {
		this.flush();
		if (!this.disposed) {
			this.postMessage(buffer.buffer);
		}
	}

	/** Mixed payloads and cancellation use the byte codec inside an explicit native envelope. */
	sendRPCBuffer(buffer: VSBuffer): void {
		this.flush();
		if (!this.disposed) {
			this.postMessage({ header: 0, body: buffer.buffer } satisfies IRPCMessage);
		}
	}

	sendRPCMessage(message: IRPCMessage): void {
		if (this.disposed) {
			return;
		}
		if (!this.batching || !this.nativeSentSinceReceive) {
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
		this.incoming.length = 0;
		this.messages.flushBuffer();
		this.controls.flushBuffer();
		if (this.deliveryDepth === 0) {
			this.subscriptions.dispose();
		}
	}
}
