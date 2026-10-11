/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ISharedResourceReference } from '../../../base/common/sharedResourceMap.js';
import { URI } from '../../../base/common/uri.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { ILogger, ILoggerOptions, isLogLevel, log, LogLevel } from '../common/log.js';
import { ILoggerMainService } from './loggerService.js';

export class LoggerChannel extends Disposable implements IServerChannel {

	private readonly loggers = new Map<string, ISharedResourceReference<ILogger | URI>>();

	constructor(private readonly loggerService: ILoggerMainService) {
		super();
	}

	listen(_: unknown, event: string, windowId?: number): Event<any> {
		switch (event) {
			case 'onDidChangeLoggers': return windowId ? this.loggerService.getOnDidChangeLoggersEvent(windowId) : this.loggerService.onDidChangeLoggers;
			case 'onDidChangeLogLevel': return windowId ? this.loggerService.getOnDidChangeLogLevelEvent(windowId) : this.loggerService.onDidChangeLogLevel;
			case 'onDidChangeVisibility': return windowId ? this.loggerService.getOnDidChangeVisibilityEvent(windowId) : this.loggerService.onDidChangeVisibility;
		}
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'createLogger': this.createLogger(arg[3], URI.revive(arg[0]), arg[1], arg[2]); return;
			case 'log': return this.log(arg[0], arg[1]);
			case 'consoleLog': return this.consoleLog(arg[0], arg[1]);
			case 'setLogLevel': return isLogLevel(arg[0]) ? this.loggerService.setLogLevel(arg[0]) : this.loggerService.setLogLevel(URI.revive(arg[0]), arg[1]);
			case 'setVisibility': return this.loggerService.setVisibility(URI.revive(arg[0]), arg[1]);
			case 'registerLogger': {
				const reference = this.loggers.get(arg[2]);
				if (!reference || reference.isDisposed) {
					this.addReference(arg[2], this.loggerService.acquireLoggerResource({ ...arg[0], resource: URI.revive(arg[0].resource) }, arg[1]));
				}
				return;
			}
			case 'deregisterLogger': {
				const reference = this.loggers.get(arg[0]);
				this.loggers.delete(arg[0]);
				reference?.dispose();
				return;
			}
		}

		throw new Error(`Call not found: ${command}`);
	}

	private createLogger(id: string, file: URI, options: ILoggerOptions, windowId: number | undefined): void {
		const previous = this.loggers.get(id);
		const reference = this.loggerService.acquireLogger(file, options, windowId);
		this.addReference(id, reference);
		previous?.dispose();
	}

	private addReference(id: string, reference: ISharedResourceReference<ILogger | URI>): void {
		this.loggers.set(id, reference);
		Event.once(reference.onDidDispose)(() => {
			if (this.loggers.get(id) === reference) {
				this.loggers.delete(id);
			}
		});
	}

	override dispose(): void {
		for (const reference of this.loggers.values()) {
			reference.dispose();
		}
		this.loggers.clear();
		super.dispose();
	}

	private consoleLog(level: LogLevel, args: any[]): void {
		let consoleFn = console.log;

		switch (level) {
			case LogLevel.Error:
				consoleFn = console.error;
				break;
			case LogLevel.Warning:
				consoleFn = console.warn;
				break;
			case LogLevel.Info:
				consoleFn = console.info;
				break;
		}

		consoleFn.call(console, ...args);
	}

	private log(id: string, messages: [LogLevel, string][]): void {
		const reference = this.loggers.get(id);
		if (!reference || reference.isDisposed || URI.isUri(reference.object)) {
			// Logger may have been removed while IPC messages were still in flight
			return;
		}
		for (const [level, message] of messages) {
			log(reference.object, level, message);
		}
	}
}

