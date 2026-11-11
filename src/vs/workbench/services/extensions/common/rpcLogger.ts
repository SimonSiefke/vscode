/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ExtensionHostKind, extensionHostKindToString } from './extensionHostKind.js';
import { IRPCProtocolLogger, RequestInitiator } from './rpcProtocol.js';

const LOG_USE_COLORS = true;

const colorTables = [
	['#2977B1', '#FC802D', '#34A13A', '#D3282F', '#9366BA'],
	['#8B564C', '#E177C0', '#7F7F7F', '#BBBE3D', '#2EBECD']
];

function prettyWithoutArrays(data: unknown): unknown {
	if (Array.isArray(data)) {
		return data;
	}
	if (data && typeof data === 'object' && typeof data.toString === 'function') {
		const result = data.toString();
		if (result !== '[object Object]') {
			return result;
		}
	}
	return data;
}

function pretty(data: unknown): unknown {
	if (Array.isArray(data)) {
		return data.map(prettyWithoutArrays);
	}
	return prettyWithoutArrays(data);
}

export class RPCLogger implements IRPCProtocolLogger {

	private _totalIncoming: number | undefined = 0;
	private _totalOutgoing: number | undefined = 0;

	constructor(
		private readonly _kind: ExtensionHostKind,
		private readonly _consoleLog: (...args: unknown[]) => void = (...args) => console.log(...args)
	) { }

	private _log(direction: string, totalLength: number | undefined, msgLength: number | undefined, req: number, initiator: RequestInitiator, str: string, data: unknown): void {
		data = pretty(data);

		const colorTable = colorTables[initiator];
		const color = LOG_USE_COLORS ? colorTable[req % colorTable.length] : '#000000';
		let args: unknown[] = [`%c[${extensionHostKindToString(this._kind)}][${direction}]%c[${String(totalLength ?? 'unknown').padStart(7)}]%c[len: ${String(msgLength ?? 'unknown').padStart(5)}]%c${String(req).padStart(5)} - ${str}`, 'color: darkgreen', 'color: grey', 'color: grey', `color: ${color}`];
		if (/\($/.test(str)) {
			args = args.concat(data);
			args.push(')');
		} else {
			args.push(data);
		}
		this._consoleLog(...args);
	}

	logIncoming(msgLength: number | undefined, req: number, initiator: RequestInitiator, str: string, data?: unknown): void {
		this._totalIncoming = this._totalIncoming === undefined || msgLength === undefined ? undefined : this._totalIncoming + msgLength;
		this._log('Ext \u2192 Win', this._totalIncoming, msgLength, req, initiator, str, data);
	}

	logOutgoing(msgLength: number | undefined, req: number, initiator: RequestInitiator, str: string, data?: unknown): void {
		this._totalOutgoing = this._totalOutgoing === undefined || msgLength === undefined ? undefined : this._totalOutgoing + msgLength;
		this._log('Win \u2192 Ext', this._totalOutgoing, msgLength, req, initiator, str, data);
	}
}

interface RPCTelemetryData {
	type: string;
	length: number;
}

type RPCTelemetryDataClassification = {
	owner: 'jrieken';
	comment: 'Insights about RPC message sizes';
	type: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The type of the RPC message' };
	length: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The byte-length of the RPC message' };
};

export class TelemetryRPCLogger implements IRPCProtocolLogger {

	static isEnabled(): boolean {
		return Math.random() < 0.0001; // 0.01% of users
	}

	private readonly _pendingRequests = new Map<number, string>();

	constructor(@ITelemetryService private readonly _telemetryService: ITelemetryService) { }

	logIncoming(msgLength: number | undefined, req: number, initiator: RequestInitiator, str: string): void {

		if (initiator === RequestInitiator.LocalSide && /^receiveReply(Err)?:/.test(str)) {
			// log the size of reply messages
			const requestStr = this._pendingRequests.get(req) ?? 'unknown_reply';
			this._pendingRequests.delete(req);
			if (msgLength === undefined) {
				return;
			}
			this._telemetryService.publicLog2<RPCTelemetryData, RPCTelemetryDataClassification>('extensionhost.incoming', {
				type: `${str} ${requestStr}`,
				length: msgLength
			});
		}

		if (msgLength !== undefined && initiator === RequestInitiator.OtherSide && /^receiveRequest /.test(str)) {
			// incoming request
			this._telemetryService.publicLog2<RPCTelemetryData, RPCTelemetryDataClassification>('extensionhost.incoming', {
				type: `${str}`,
				length: msgLength
			});
		}
	}

	logOutgoing(msgLength: number | undefined, req: number, initiator: RequestInitiator, str: string): void {

		if (initiator === RequestInitiator.LocalSide && str.startsWith('request: ')) {
			this._pendingRequests.set(req, str);
			if (msgLength === undefined) {
				return;
			}
			this._telemetryService.publicLog2<RPCTelemetryData, RPCTelemetryDataClassification>('extensionhost.outgoing', {
				type: str,
				length: msgLength
			});
		}
	}
}

