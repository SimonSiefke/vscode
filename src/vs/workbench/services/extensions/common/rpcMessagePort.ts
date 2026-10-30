/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IMessagePassingProtocol } from '../../../../base/parts/ipc/common/ipc.js';
import { BufferedEmitter } from '../../../../base/parts/ipc/common/ipc.net.js';

export const enum RPCMessageType {
	Request = 1,
	Acknowledged,
	Cancel,
	Reply,
	Error,
}

export type NativeRPCValue =
	| { readonly type: 'undefined' }
	| { readonly type: 'buffer'; readonly buffer: Uint8Array }
	| { readonly type: 'buffers'; readonly json: string; readonly buffers: readonly Uint8Array[] }
	| { readonly type: 'json'; readonly json: string };

export type IRPCMessage =
	| { readonly type: RPCMessageType.Request; readonly req: number; readonly rpcId: number; readonly method: string; readonly args: string | readonly NativeRPCValue[]; readonly cancellable: boolean }
	| { readonly type: RPCMessageType.Acknowledged | RPCMessageType.Cancel; readonly req: number }
	| { readonly type: RPCMessageType.Reply; readonly req: number; readonly value: NativeRPCValue }
	| { readonly type: RPCMessageType.Error; readonly req: number; readonly error: string | undefined };

/** Byte messages are reserved for the existing initialization and termination handshakes. */
export interface IStructuredCloneRPCTransport extends IMessagePassingProtocol {
	readonly onRPCMessage: Event<IRPCMessage>;
	sendRPCMessage(message: IRPCMessage): void;
}

export function isStructuredCloneRPCTransport(protocol: IMessagePassingProtocol): protocol is IStructuredCloneRPCTransport {
	return 'onRPCMessage' in protocol && 'sendRPCMessage' in protocol;
}

/** Deliver each frame immediately, preserving the MessagePort's ordering. */
export class RPCMessagePort implements IStructuredCloneRPCTransport, IDisposable {
	private readonly messages = new BufferedEmitter<IRPCMessage>();
	private readonly controls = new BufferedEmitter<VSBuffer>();
	private readonly subscriptions = new DisposableStore();
	readonly onRPCMessage = Event.map(this.messages.event, message => message, this.subscriptions);
	readonly onMessage = Event.map(this.controls.event, message => message, this.subscriptions);
	private disposed = false;
	private deliveryDepth = 0;

	constructor(private readonly postMessage: (message: unknown) => void) { }

	acceptMessage(data: unknown): void {
		if (this.disposed || !data) {
			return;
		}
		this.deliveryDepth++;
		try {
			if (data instanceof Uint8Array) {
				this.controls.fire(VSBuffer.wrap(data));
			} else {
				this.messages.fire(data as IRPCMessage);
			}
		} finally {
			if (--this.deliveryDepth === 0 && this.disposed) {
				this.subscriptions.dispose();
			}
		}
	}

	send(buffer: VSBuffer): void {
		if (!this.disposed) {
			this.postMessage(buffer.buffer);
		}
	}

	sendRPCMessage(message: IRPCMessage): void {
		if (!this.disposed) {
			this.postMessage(message);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.messages.flushBuffer();
		this.controls.flushBuffer();
		if (this.deliveryDepth === 0) {
			this.subscriptions.dispose();
		}
	}
}
