/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { isString } from '../../../base/common/types.js';
import { IProcessDataEvent } from './terminal.js';

interface TerminalDataBuffer extends IDisposable {
	data: string[];
	timeoutId: Timeout | undefined;
}

export class TerminalDataBufferer implements IDisposable {
	private readonly _terminalBufferMap = new Map<number, TerminalDataBuffer>();

	constructor(private readonly _callback: (id: number, data: string) => void) {
	}

	dispose() {
		for (const buffer of this._terminalBufferMap.values()) {
			buffer.dispose();
		}
	}

	startBuffering(id: number, event: Event<string | IProcessDataEvent>, throttleBy: number = 5): IDisposable {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			return buffer;
		}

		const disposable = event((e: string | IProcessDataEvent) => {
			const data = isString(e) ? e : e.data;
			const buffer = this._terminalBufferMap.get(id);
			if (!buffer) {
				return;
			}

			buffer.data.push(data);
			if (!buffer.timeoutId) {
				buffer.timeoutId = setTimeout(() => this.flushBuffer(id), throttleBy);
			}
		});

		const newBuffer: TerminalDataBuffer = {
			data: [],
			timeoutId: undefined,
			dispose: () => {
				if (this._terminalBufferMap.get(id) !== newBuffer) {
					return;
				}
				this._terminalBufferMap.delete(id);
				disposable.dispose();
				this.flushBufferData(id, newBuffer);
			}
		};
		this._terminalBufferMap.set(id, newBuffer);
		return newBuffer;
	}

	stopBuffering(id: number) {
		const buffer = this._terminalBufferMap.get(id);
		buffer?.dispose();
	}

	flushBuffer(id: number): void {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			this.flushBufferData(id, buffer);
		}
	}

	private flushBufferData(id: number, buffer: TerminalDataBuffer): void {
		if (buffer.timeoutId !== undefined) {
			clearTimeout(buffer.timeoutId);
			buffer.timeoutId = undefined;
		}
		const data = buffer.data;
		buffer.data = [];
		if (data.length > 0) {
			this._callback(id, data.join(''));
		}
	}
}
