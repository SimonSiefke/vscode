/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CharCode } from '../../../../base/common/charCode.js';
import * as errors from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { UriComponents } from '../../../../base/common/uri.js';
import { MarshalledId } from '../../../../base/common/marshallingIds.js';
import { IURITransformer, transformIncomingURIs } from '../../../../base/common/uriIpc.js';
import { CanceledLazyPromise, LazyPromise } from './lazyPromise.js';
import { getStringIdentifierForProxy, IRPCProtocol, Proxied, ProxyIdentifier, SerializableObjectWithBuffers } from './proxyIdentifier.js';
import { IRPCProtocolLogger, JSONStringifyReplacer, RequestInitiator, ResponsiveState, parseJsonAndRestoreBufferRefs, stringifyJsonWithBufferRefs } from './rpcProtocol.js';
import { IRPCMessage, IStructuredCloneRPCTransport, NativeRPCValue, RPCMessageType } from './rpcMessagePort.js';

function createURIReplacer(transformer: IURITransformer | null): JSONStringifyReplacer | null {
	return transformer ? (_key: string, value: unknown) => value && typeof value === 'object' && (value as { $mid?: number }).$mid === MarshalledId.Uri ? transformer.transformOutgoing(value as UriComponents) : value : null;
}

const _RPCProtocolSymbol = Symbol.for('rpcProtocol');
const _RPCProxySymbol = Symbol.for('rpcProxy');

export class StructuredCloneRPCProtocol extends Disposable implements IRPCProtocol {

	[_RPCProtocolSymbol] = true;

	private static readonly UNRESPONSIVE_TIME = 3 * 1000; // 3s

	private readonly _onDidChangeResponsiveState: Emitter<ResponsiveState> = this._register(new Emitter<ResponsiveState>());
	public readonly onDidChangeResponsiveState: Event<ResponsiveState> = this._onDidChangeResponsiveState.event;

	private readonly _protocol: IStructuredCloneRPCTransport;
	private readonly _logger: IRPCProtocolLogger | null;
	private readonly _uriTransformer: IURITransformer | null;
	private readonly _uriReplacer: JSONStringifyReplacer | null;
	private _isDisposed: boolean;
	private readonly _locals: unknown[];
	private readonly _proxies: unknown[];
	private _lastMessageId: number;
	private readonly _cancelInvokedHandlers: { [req: string]: () => void };
	private readonly _pendingRPCReplies: { [msgId: string]: PendingRPCReply };
	private _responsiveState: ResponsiveState;
	private _unacknowledgedCount: number;
	private _unresponsiveTime: number;
	private _asyncCheckUresponsive: RunOnceScheduler;

	constructor(protocol: IStructuredCloneRPCTransport, logger: IRPCProtocolLogger | null = null, transformer: IURITransformer | null = null) {
		super();
		this._protocol = protocol;
		this._logger = logger;
		this._uriTransformer = transformer;
		this._uriReplacer = createURIReplacer(this._uriTransformer);
		this._isDisposed = false;
		this._locals = [];
		this._proxies = [];
		for (let i = 0, len = ProxyIdentifier.count; i < len; i++) {
			this._locals[i] = null;
			this._proxies[i] = null;
		}
		this._lastMessageId = 0;
		this._cancelInvokedHandlers = Object.create(null);
		this._pendingRPCReplies = {};
		this._responsiveState = ResponsiveState.Responsive;
		this._unacknowledgedCount = 0;
		this._unresponsiveTime = 0;
		this._asyncCheckUresponsive = this._register(new RunOnceScheduler(() => this._checkUnresponsive(), 1000));
		this._register(this._protocol.onRPCMessage((msg) => this._receiveOneMessage(msg)));
	}

	public override dispose(): void {
		this._isDisposed = true;

		// Release all outstanding promises with a canceled error
		Object.keys(this._pendingRPCReplies).forEach((msgId) => {
			const pending = this._pendingRPCReplies[msgId];
			delete this._pendingRPCReplies[msgId];
			pending.resolveErr(errors.canceled());
		});

		for (const cancel of Object.values(this._cancelInvokedHandlers)) {
			cancel();
		}
		for (const req of Object.keys(this._cancelInvokedHandlers)) {
			delete this._cancelInvokedHandlers[req];
		}
		super.dispose();
	}

	public drain(): Promise<void> {
		if (typeof this._protocol.drain === 'function') {
			return this._protocol.drain();
		}
		return Promise.resolve();
	}

	private _onWillSendRequest(req: number): void {
		if (this._unacknowledgedCount === 0) {
			// Since this is the first request we are sending in a while,
			// mark this moment as the start for the countdown to unresponsive time
			this._unresponsiveTime = Date.now() + StructuredCloneRPCProtocol.UNRESPONSIVE_TIME;
		}
		this._unacknowledgedCount++;
		if (!this._asyncCheckUresponsive.isScheduled()) {
			this._asyncCheckUresponsive.schedule();
		}
	}

	private _onDidReceiveAcknowledge(req: number): void {
		// The next possible unresponsive time is now + delta.
		this._unresponsiveTime = Date.now() + StructuredCloneRPCProtocol.UNRESPONSIVE_TIME;
		this._unacknowledgedCount--;
		if (this._unacknowledgedCount === 0) {
			// No more need to check for unresponsive
			this._asyncCheckUresponsive.cancel();
		}
		// The ext host is responsive!
		this._setResponsiveState(ResponsiveState.Responsive);
	}

	private _checkUnresponsive(): void {
		if (this._unacknowledgedCount === 0) {
			// Not waiting for anything => cannot say if it is responsive or not
			return;
		}

		if (Date.now() > this._unresponsiveTime) {
			// Unresponsive!!
			this._setResponsiveState(ResponsiveState.Unresponsive);
		} else {
			// Not (yet) unresponsive, be sure to check again soon
			this._asyncCheckUresponsive.schedule();
		}
	}

	private _setResponsiveState(newResponsiveState: ResponsiveState): void {
		if (this._responsiveState === newResponsiveState) {
			// no change
			return;
		}
		this._responsiveState = newResponsiveState;
		this._onDidChangeResponsiveState.fire(this._responsiveState);
	}

	public get responsiveState(): ResponsiveState {
		return this._responsiveState;
	}

	public transformIncomingURIs<T>(obj: T): T {
		if (!this._uriTransformer) {
			return obj;
		}
		return transformIncomingURIs(obj, this._uriTransformer);
	}

	public getProxy<T>(identifier: ProxyIdentifier<T>): Proxied<T> {
		const { nid: rpcId, sid } = identifier;
		if (!this._proxies[rpcId]) {
			this._proxies[rpcId] = this._createProxy(rpcId, sid);
		}
		return this._proxies[rpcId] as Proxied<T>;
	}

	private _createProxy<T>(rpcId: number, debugName: string): T {
		const handler = {
			get: (target: Record<PropertyKey, unknown>, name: PropertyKey) => {
				if (typeof name === 'string' && !target[name] && name.charCodeAt(0) === CharCode.DollarSign) {
					target[name] = (...myArgs: unknown[]) => {
						return this._remoteCall(rpcId, name, myArgs);
					};
				}
				if (name === _RPCProxySymbol) {
					return debugName;
				}
				return target[name];
			}
		};
		return new Proxy(Object.create(null), handler);
	}

	public set<T, R extends T>(identifier: ProxyIdentifier<T>, value: R): R {
		this._locals[identifier.nid] = value;
		return value;
	}

	public assertRegistered(identifiers: ProxyIdentifier<unknown>[]): void {
		for (let i = 0, len = identifiers.length; i < len; i++) {
			const identifier = identifiers[i];
			if (!this._locals[identifier.nid]) {
				throw new Error(`Missing proxy instance ${identifier.sid}`);
			}
		}
	}

	private _receiveOneMessage(message: IRPCMessage): void {
		if (this._isDisposed) {
			return;
		}
		const req = message.req;
		switch (message.type) {
			case RPCMessageType.Request: {
				let args = typeof message.args === 'string' ? JSON.parse(message.args) : message.args.map(arg => deserializeValue(arg, null));
				if (this._uriTransformer) {
					args = transformIncomingURIs(args, this._uriTransformer);
				}
				this._receiveRequest(0, req, message.rpcId, message.method, args, message.cancellable);
				break;
			}
			case RPCMessageType.Acknowledged:
				this._logger?.logIncoming(0, req, RequestInitiator.LocalSide, 'ack');
				this._onDidReceiveAcknowledge(req);
				break;
			case RPCMessageType.Cancel:
				this._receiveCancel(0, req);
				break;
			case RPCMessageType.Reply: {
				let value = deserializeValue(message.value, this._uriTransformer);
				if (this._uriTransformer && message.value.type !== 'buffers') {
					value = transformIncomingURIs(value, this._uriTransformer);
				}
				this._receiveReply(0, req, value);
				break;
			}
			case RPCMessageType.Error: {
				let error = message.error === undefined ? undefined : JSON.parse(message.error);
				if (this._uriTransformer) {
					error = transformIncomingURIs(error, this._uriTransformer);
				}
				this._receiveReplyErr(0, req, error);
				break;
			}
		}
	}

	private _receiveRequest(msgLength: number, req: number, rpcId: number, method: string, args: unknown[], usesCancellationToken: boolean): void {
		this._logger?.logIncoming(msgLength, req, RequestInitiator.OtherSide, `receiveRequest ${getStringIdentifierForProxy(rpcId)}.${method}(`, args);
		const callId = String(req);

		let promise: Promise<unknown>;
		let cancellationTokenSource: CancellationTokenSource | undefined;
		if (usesCancellationToken) {
			cancellationTokenSource = new CancellationTokenSource();
			args.push(cancellationTokenSource.token);
			this._cancelInvokedHandlers[callId] = () => cancellationTokenSource!.dispose(true);
			promise = this._invokeHandler(rpcId, method, args);
		} else {
			promise = this._invokeHandler(rpcId, method, args);
		}


		// Acknowledge the request
		const msg = MessageIO.serializeAcknowledged(req);
		this._logger?.logOutgoing(0, req, RequestInitiator.OtherSide, `ack`);
		this._protocol.sendRPCMessage(msg);

		promise.then((r) => {
			delete this._cancelInvokedHandlers[callId];
			cancellationTokenSource?.dispose();
			if (this._isDisposed) {
				return;
			}
			const msg = MessageIO.serializeReplyOK(req, r, this._uriReplacer);
			this._logger?.logOutgoing(0, req, RequestInitiator.OtherSide, `reply:`, r);
			this._protocol.sendRPCMessage(msg);
		}, (err) => {
			delete this._cancelInvokedHandlers[callId];
			cancellationTokenSource?.dispose();
			if (this._isDisposed) {
				return;
			}
			const msg = MessageIO.serializeReplyErr(req, err);
			this._logger?.logOutgoing(0, req, RequestInitiator.OtherSide, `replyErr:`, err);
			this._protocol.sendRPCMessage(msg);
		});
	}

	private _receiveCancel(msgLength: number, req: number): void {
		this._logger?.logIncoming(msgLength, req, RequestInitiator.OtherSide, `receiveCancel`);
		const callId = String(req);
		const cancel = this._cancelInvokedHandlers[callId];
		delete this._cancelInvokedHandlers[callId];
		cancel?.();
	}

	private _receiveReply(msgLength: number, req: number, value: unknown): void {
		this._logger?.logIncoming(msgLength, req, RequestInitiator.LocalSide, `receiveReply:`, value);
		const callId = String(req);
		if (!this._pendingRPCReplies.hasOwnProperty(callId)) {
			return;
		}

		const pendingReply = this._pendingRPCReplies[callId];
		delete this._pendingRPCReplies[callId];

		pendingReply.resolveOk(value);
	}

	private _receiveReplyErr(msgLength: number, req: number, value: unknown): void {
		this._logger?.logIncoming(msgLength, req, RequestInitiator.LocalSide, `receiveReplyErr:`, value);

		const callId = String(req);
		if (!this._pendingRPCReplies.hasOwnProperty(callId)) {
			return;
		}

		const pendingReply = this._pendingRPCReplies[callId];
		delete this._pendingRPCReplies[callId];

		let err: unknown = value || undefined;
		if (value && typeof value === 'object' && (value as Partial<errors.SerializedError>).$isError) {
			const serialized = value as errors.SerializedError;
			const error = new Error(serialized.message);
			error.name = serialized.name;
			error.stack = serialized.stack;
			err = error;
		}
		pendingReply.resolveErr(err);
	}

	private _invokeHandler(rpcId: number, methodName: string, args: unknown[]): Promise<unknown> {
		try {
			return Promise.resolve(this._doInvokeHandler(rpcId, methodName, args));
		} catch (err) {
			return Promise.reject(err);
		}
	}

	private _doInvokeHandler(rpcId: number, methodName: string, args: unknown[]): unknown {
		const actor = this._locals[rpcId] as Record<string, unknown> | null;
		if (!actor) {
			throw new Error('Unknown actor ' + getStringIdentifierForProxy(rpcId));
		}
		const method = actor[methodName];
		if (typeof method !== 'function') {
			throw new Error('Unknown method ' + methodName + ' on actor ' + getStringIdentifierForProxy(rpcId));
		}
		return method.apply(actor, args);
	}

	private _remoteCall(rpcId: number, methodName: string, args: unknown[]): Promise<unknown> {
		if (this._isDisposed) {
			return new CanceledLazyPromise();
		}
		let cancellationToken: CancellationToken | null = null;
		if (args.length > 0 && CancellationToken.isCancellationToken(args[args.length - 1])) {
			cancellationToken = args.pop() as CancellationToken;
		}

		if (cancellationToken && cancellationToken.isCancellationRequested) {
			// No need to do anything...
			return Promise.reject<unknown>(errors.canceled());
		}

		const serializedRequestArguments = MessageIO.serializeRequestArguments(args, this._uriReplacer);

		const req = ++this._lastMessageId;
		const callId = String(req);
		const result = new LazyPromise();

		const disposable = new DisposableStore();
		if (cancellationToken) {
			disposable.add(cancellationToken.onCancellationRequested(() => {
				const msg = MessageIO.serializeCancel(req);
				this._logger?.logOutgoing(0, req, RequestInitiator.LocalSide, `cancel`);
				this._protocol.sendRPCMessage(msg);
			}));
		}

		this._pendingRPCReplies[callId] = new PendingRPCReply(result, disposable);
		this._onWillSendRequest(req);
		const msg = MessageIO.serializeRequest(req, rpcId, methodName, serializedRequestArguments, !!cancellationToken);
		this._logger?.logOutgoing(0, req, RequestInitiator.LocalSide, `request: ${getStringIdentifierForProxy(rpcId)}.${methodName}(`, args);
		this._protocol.sendRPCMessage(msg);
		return result;
	}
}

class PendingRPCReply {
	constructor(
		private readonly _promise: LazyPromise,
		private readonly _disposable: IDisposable
	) { }

	public resolveOk(value: unknown): void {
		this._promise.resolveOk(value);
		this._disposable.dispose();
	}

	public resolveErr(err: unknown): void {
		this._promise.resolveErr(err);
		this._disposable.dispose();
	}
}

/** Keep the byte engine's JSON conversion rules while cloning strings and buffers directly. */
function serializeValue(value: unknown, replacer: JSONStringifyReplacer | null, safe = false): NativeRPCValue {
	if (value === undefined) {
		return { type: 'undefined' };
	}
	if (value instanceof VSBuffer) {
		return { type: 'buffer', buffer: value.buffer };
	}
	if (value instanceof SerializableObjectWithBuffers) {
		const { jsonString, referencedBuffers } = stringifyJsonWithBufferRefs(value.value, replacer, safe);
		return { type: 'buffers', json: jsonString, buffers: referencedBuffers.map(buffer => buffer.buffer) };
	}
	try {
		return { type: 'json', json: JSON.stringify(value, replacer ?? undefined) };
	} catch (error) {
		if (!safe) {
			throw error;
		}
		return { type: 'json', json: 'null' };
	}
}

function deserializeValue(value: NativeRPCValue, transformer: IURITransformer | null): unknown {
	switch (value.type) {
		case 'undefined': return undefined;
		case 'buffer': return VSBuffer.wrap(value.buffer);
		case 'buffers': return new SerializableObjectWithBuffers(parseJsonAndRestoreBufferRefs(value.json, value.buffers.map(buffer => VSBuffer.wrap(buffer)), transformer));
		case 'json': return JSON.parse(value.json);
	}
}

class MessageIO {
	static serializeRequestArguments(args: unknown[], replacer: JSONStringifyReplacer | null): string | readonly NativeRPCValue[] {
		return args.some(arg => arg === undefined || arg instanceof VSBuffer || arg instanceof SerializableObjectWithBuffers)
			? args.map(arg => serializeValue(arg, replacer))
			: JSON.stringify(args, replacer ?? undefined);
	}

	static serializeRequest(req: number, rpcId: number, method: string, args: string | readonly NativeRPCValue[], cancellable: boolean): IRPCMessage {
		return { type: RPCMessageType.Request, req, rpcId, method, args, cancellable };
	}

	static serializeAcknowledged(req: number): IRPCMessage {
		return { type: RPCMessageType.Acknowledged, req };
	}

	static serializeCancel(req: number): IRPCMessage {
		return { type: RPCMessageType.Cancel, req };
	}

	static serializeReplyOK(req: number, value: unknown, replacer: JSONStringifyReplacer | null): IRPCMessage {
		return { type: RPCMessageType.Reply, req, value: serializeValue(value, replacer, true) };
	}

	static serializeReplyErr(req: number, error: unknown): IRPCMessage {
		let json: string | undefined;
		try {
			json = error ? JSON.stringify(errors.transformErrorForSerialization(error)) : undefined;
		} catch {
			json = 'null';
		}
		return { type: RPCMessageType.Error, req, error: json };
	}
}
