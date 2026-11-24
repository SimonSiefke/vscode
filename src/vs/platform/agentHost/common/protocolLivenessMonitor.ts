/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TimeoutTimer } from '../../../base/common/async.js';
import { Disposable, IReference, MutableDisposable } from '../../../base/common/lifecycle.js';
import { ILoadEstimator, LoadEstimator } from '../../../base/parts/ipc/common/ipc.net.js';

interface IProtocolLivenessOptions {
	readonly pingIntervalMs: number;
	readonly timeoutMs: number;
	readonly loadEstimator?: ILoadEstimator;
	readonly canCheck: () => boolean;
	readonly canTimeout?: () => boolean;
	readonly shouldDefer?: () => boolean;
	readonly onPing: () => void;
	readonly onTimeout: (silenceMs: number) => void;
	readonly onDeferred?: (durationMs: number) => void;
}

/** Probes idle peers and times out continued inbound silence, allowing a fresh window after local stalls. */
export class ProtocolLivenessMonitor extends Disposable {
	private readonly _pingTimer = this._register(new TimeoutTimer());
	private readonly _closeTimer = this._register(new TimeoutTimer());
	private readonly _defaultLoadEstimator = this._register(new MutableDisposable<IReference<LoadEstimator>>());
	private _deferredSince: number | undefined;
	private _lastReadTime = Date.now();

	get lastReadTime(): number { return this._lastReadTime; }

	constructor(private readonly _options: IProtocolLivenessOptions) {
		super();
	}

	recordInboundTraffic(): void {
		this._lastReadTime = Date.now();
		this.reset();
	}

	reset(): void {
		this._clearTimers();
		if (this._options.canCheck()) {
			this._armTimers();
		} else {
			this._defaultLoadEstimator.clear();
		}
	}

	stop(): void {
		this._clearTimers();
		this._defaultLoadEstimator.clear();
	}

	private _clearTimers(): void {
		this._pingTimer.cancel();
		this._closeTimer.cancel();
		this._deferredSince = undefined;
	}

	private _armTimers(): void {
		this._pingTimer.cancelAndSet(() => this._onPingTimer(), this._options.pingIntervalMs);
		this._closeTimer.cancelAndSet(() => this._onCloseTimer(), this._options.pingIntervalMs + this._options.timeoutMs);

		// Connections that only send pings never consult the load estimate.
		if (this._options.loadEstimator || this._options.canTimeout?.() === false) {
			this._defaultLoadEstimator.clear();
		} else {
			this._defaultLoadEstimator.value ??= LoadEstimator.acquire();
		}
	}

	private _onPingTimer(): void {
		if (this._options.canCheck()) {
			this._options.onPing();
		}
	}

	private _onCloseTimer(): void {
		if (!this._options.canCheck() || this._options.canTimeout?.() === false) {
			this._defaultLoadEstimator.clear();
			return;
		}
		const loadEstimator = this._options.loadEstimator ?? this._defaultLoadEstimator.value?.object;
		if (this._options.shouldDefer?.() || loadEstimator?.hasHighLoad()) {
			this._deferredSince ??= Date.now();
			this._options.onDeferred?.(Date.now() - this._deferredSince);
			this._pingTimer.cancelAndSet(() => this._onPingTimer(), this._options.pingIntervalMs);
			this._closeTimer.cancelAndSet(() => this._onCloseTimer(), this._options.pingIntervalMs);
			return;
		}
		if (this._deferredSince !== undefined) {
			this._deferredSince = undefined;
			this._armTimers();
			return;
		}
		this._defaultLoadEstimator.clear();
		this._options.onTimeout(Date.now() - this._lastReadTime);
	}
}
