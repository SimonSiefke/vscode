/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from '../../../base/common/uri.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, IDisposable, dispose } from '../../../base/common/lifecycle.js';
import { ExtHostContext, MainContext, MainThreadDecorationsShape, ExtHostDecorationsShape, DecorationData, DecorationRequest } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IDecorationsService, IDecorationData } from '../../services/decorations/common/decorations.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { CancellationError } from '../../../base/common/errors.js';

class DecorationRequestsQueue extends Disposable {

	private readonly _cancellation = this._register(new CancellationTokenSource());

	private _idPool = 0;
	private _requests = new Map<number, DecorationRequest>();
	private readonly _resolver = new Map<number, DeferredPromise<DecorationData>>();

	private _timer: Timeout | undefined;

	constructor(
		private readonly _proxy: ExtHostDecorationsShape,
		private readonly _handle: number
	) {
		super();
	}

	override dispose(): void {
		this._cancellation.cancel();
		clearTimeout(this._timer);
		this._timer = undefined;
		for (const defer of this._resolver.values()) {
			defer.error(new CancellationError());
		}
		this._resolver.clear();
		this._requests.clear();
		super.dispose();
	}

	enqueue(uri: URI, token: CancellationToken): Promise<DecorationData> {
		if (this._store.isDisposed) {
			return Promise.reject(new CancellationError());
		}
		const id = ++this._idPool;

		const defer = new DeferredPromise<DecorationData>();
		this._requests.set(id, { id, uri });
		this._resolver.set(id, defer);
		this._processQueue();

		const sub = token.onCancellationRequested(() => {
			this._requests.delete(id);
			this._resolver.delete(id);
			defer.error(new CancellationError());
		});
		return defer.p.finally(() => sub.dispose());
	}

	private _processQueue(): void {
		if (this._timer !== undefined) {
			// already queued
			return;
		}
		this._timer = setTimeout(() => {
			// make request
			const requests = this._requests;
			this._proxy.$provideDecorations(this._handle, [...requests.values()], this._cancellation.token).then(data => {
				for (const id of requests.keys()) {
					this._resolver.get(id)?.complete(data[id]);
					this._resolver.delete(id);
				}
			}, err => {
				for (const id of requests.keys()) {
					this._resolver.get(id)?.error(err);
					this._resolver.delete(id);
				}
			});

			// reset
			this._requests = new Map();
			this._timer = undefined;
		}, 0);
	}
}

@extHostNamedCustomer(MainContext.MainThreadDecorations)
export class MainThreadDecorations implements MainThreadDecorationsShape {

	private readonly _provider = new Map<number, [Emitter<URI[]>, IDisposable, DecorationRequestsQueue]>();
	private readonly _proxy: ExtHostDecorationsShape;

	constructor(
		context: IExtHostContext,
		@IDecorationsService private readonly _decorationsService: IDecorationsService
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostDecorations);
	}

	dispose() {
		this._provider.forEach(value => dispose(value));
		this._provider.clear();
	}

	$registerDecorationProvider(handle: number, label: string): void {
		const emitter = new Emitter<URI[]>();
		const queue = new DecorationRequestsQueue(this._proxy, handle);
		const registration = this._decorationsService.registerDecorationsProvider({
			label,
			onDidChange: emitter.event,
			provideDecorations: async (uri, token): Promise<IDecorationData | undefined> => {
				const data = await queue.enqueue(uri, token);
				if (!data) {
					return undefined;
				}
				const [bubble, tooltip, letter, themeColor] = data;
				return {
					weight: 10,
					bubble: bubble ?? false,
					color: themeColor?.id,
					tooltip,
					letter
				};
			}
		});
		this._provider.set(handle, [emitter, registration, queue]);
	}

	$onDidChange(handle: number, resources: UriComponents[]): void {
		const provider = this._provider.get(handle);
		if (provider) {
			const [emitter] = provider;
			emitter.fire(resources && resources.map(r => URI.revive(r)));
		}
	}

	$unregisterDecorationProvider(handle: number): void {
		const provider = this._provider.get(handle);
		if (provider) {
			dispose(provider);
			this._provider.delete(handle);
		}
	}
}
