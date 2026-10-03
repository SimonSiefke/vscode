/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../log/common/log.js';
import type { IPtyServiceContribution, ITerminalChildProcess } from '../../../common/terminal.js';
import { TerminalAutoResponder } from './terminalAutoResponder.js';

export class AutoRepliesPtyServiceContribution implements IPtyServiceContribution {
	private readonly _autoReplies = new Map<number, Readonly<Record<string, string | null>>>();
	private readonly _terminalProcesses: Map<number, ITerminalChildProcess> = new Map();
	private readonly _autoResponders: Map<number, Map<string, TerminalAutoResponder>> = new Map();

	constructor(
		@ILogService private readonly _logService: ILogService
	) {
	}

	setAutoReplies(persistentProcessId: number, replies: Readonly<Record<string, string | null>>): void {
		const processAutoResponders = this._autoResponders.get(persistentProcessId);
		if (processAutoResponders) {
			for (const responder of processAutoResponders.values()) {
				responder.dispose();
			}
			processAutoResponders.clear();
		}
		this._autoReplies.set(persistentProcessId, { ...replies });
		const process = this._terminalProcesses.get(persistentProcessId);
		if (process) {
			this._installAutoReplies(persistentProcessId, process);
		}
	}

	private _installAutoReplies(persistentProcessId: number, process: ITerminalChildProcess): void {
		for (const [match, reply] of Object.entries(this._autoReplies.get(persistentProcessId) ?? {})) {
			if (match && typeof reply === 'string' && reply) {
				this._processInstallAutoReply(persistentProcessId, process, match, reply);
			}
		}
	}

	handleProcessReady(persistentProcessId: number, process: ITerminalChildProcess): void {
		// Ready fires again when a persistent process is reattached, dispose the old responders
		const existingAutoResponders = this._autoResponders.get(persistentProcessId);
		if (existingAutoResponders) {
			for (const e of existingAutoResponders.values()) {
				e.dispose();
			}
		}
		this._terminalProcesses.set(persistentProcessId, process);
		this._autoResponders.set(persistentProcessId, new Map());
		this._installAutoReplies(persistentProcessId, process);
	}

	handleProcessDispose(persistentProcessId: number): void {
		this._autoReplies.delete(persistentProcessId);
		const processAutoResponders = this._autoResponders.get(persistentProcessId);
		if (processAutoResponders) {
			for (const e of processAutoResponders.values()) {
				e.dispose();
			}
			processAutoResponders.clear();
		}
		this._autoResponders.delete(persistentProcessId);
		this._terminalProcesses.delete(persistentProcessId);
	}

	handleProcessInput(persistentProcessId: number, data: string) {
		const processAutoResponders = this._autoResponders.get(persistentProcessId);
		if (processAutoResponders) {
			for (const listener of processAutoResponders.values()) {
				listener.handleInput();
			}
		}
	}

	handleProcessResize(persistentProcessId: number, cols: number, rows: number) {
		const processAutoResponders = this._autoResponders.get(persistentProcessId);
		if (processAutoResponders) {
			for (const listener of processAutoResponders.values()) {
				listener.handleResize();
			}
		}
	}

	private _processInstallAutoReply(persistentProcessId: number, terminalProcess: ITerminalChildProcess, match: string, reply: string) {
		const processAutoResponders = this._autoResponders.get(persistentProcessId);
		if (processAutoResponders) {
			processAutoResponders.get(match)?.dispose();
			processAutoResponders.set(match, new TerminalAutoResponder(terminalProcess, match, reply, this._logService));
		}
	}
}
