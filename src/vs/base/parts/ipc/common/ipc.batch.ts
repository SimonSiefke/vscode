/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../common/event.js';
import { IDisposable } from '../../../common/lifecycle.js';
import type { IChannelMessagePassingProtocol, IStructuredCloneMessage, IStructuredCloneMessagePassingProtocol } from './ipc.js';

const protocols = new WeakMap<IStructuredCloneMessagePassingProtocol, BatchedChannelProtocol>();

/** Share one native batch adapter between both channel roles on a connection. */
export function getBatchedChannelProtocol(protocol: IChannelMessagePassingProtocol): IChannelMessagePassingProtocol {
	if (protocol.type !== 'structuredClone' || protocol instanceof BatchedChannelProtocol) {
		return protocol;
	}
	let result = protocols.get(protocol);
	if (!result) {
		result = new BatchedChannelProtocol(protocol);
		protocols.set(protocol, result);
	}
	return result;
}

/** Flush immutable frames before disconnecting the native transport. */
export function flushBatchedChannelProtocol(protocol: IStructuredCloneMessagePassingProtocol): void {
	try {
		(protocol instanceof BatchedChannelProtocol ? protocol : protocols.get(protocol))?.flush();
	} catch {
		// A native peer may already have closed while this side disconnects.
	}
}

class BatchedChannelProtocol implements IStructuredCloneMessagePassingProtocol {
	readonly type = 'structuredClone';
	private listener: IDisposable | undefined;
	private subscribers = 0;
	private readonly messages = new Emitter<IStructuredCloneMessage>({
		onDidAddListener: () => {
			if (++this.subscribers === 1) {
				this.listen();
			}
		},
		onWillRemoveListener: () => {
			if (--this.subscribers === 0) {
				this.listener?.dispose();
				this.listener = undefined;
			}
		}
	});
	readonly onMessage: Event<IStructuredCloneMessage> = this.messages.event;
	private pending: IStructuredCloneMessage[] | undefined;
	private pendingCharacters = 0;
	private scheduled = false;
	private sentSinceReceive = false;

	constructor(private readonly protocol: IStructuredCloneMessagePassingProtocol) { }

	private listen(): void {
		const listener = this.protocol.onMessage(message => {
			this.sentSinceReceive = false;
			const batch = message.batch;
			if (batch) {
				// Fan out each frame to both roles before advancing to the next.
				for (const frame of batch) {
					this.messages.fire(frame);
				}
			} else {
				this.messages.fire(message);
			}
		});
		// A buffered protocol can synchronously deliver while attaching.
		if (this.subscribers > 0) {
			this.listener = listener;
		} else {
			listener.dispose();
		}
	}

	send(message: IStructuredCloneMessage): void {
		// Channel roles allocate fresh ID/name headers. Arbitrary connection
		// contexts use the raw protocol during their handshake.
		const type = typeof message.body;
		const immutable = message.body === null || type === 'undefined' || type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
		if (!Array.isArray(message.header) || message.vsBuffers || !immutable) {
			this.flush();
			this.protocol.send(message);
			return;
		}
		if (!this.sentSinceReceive) {
			this.sentSinceReceive = true;
			this.flush();
			this.protocol.send(message);
			return;
		}
		const characters = type === 'string' ? (message.body as string).length : 0;
		if (characters >= 16 * 1024) {
			this.flush();
			this.protocol.send(message);
			return;
		}
		if (this.pending && (this.pending.length >= 64 || this.pendingCharacters + characters > 16 * 1024)) {
			this.flush();
		}
		(this.pending ??= []).push(message);
		this.pendingCharacters += characters;
		if (!this.scheduled) {
			this.scheduled = true;
			queueMicrotask(() => {
				this.scheduled = false;
				try {
					this.flush();
				} catch {
					// The native peer may have closed after queuing these immutable frames.
				}
			});
		}
	}

	flush(): void {
		const pending = this.pending;
		this.pending = undefined;
		this.pendingCharacters = 0;
		if (pending) {
			this.protocol.send(pending.length === 1 ? pending[0] : { header: null, body: undefined, batch: pending });
		}
	}
}
