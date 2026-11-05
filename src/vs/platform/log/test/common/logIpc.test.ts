/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { BufferReader, BufferWriter, deserialize, IChannel, serialize } from '../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DidChangeLoggersEvent, ILoggerResource, ILoggerService, LogLevel, NullLoggerService } from '../../common/log.js';
import { LoggerChannelClient, RemoteLoggerChannelClient } from '../../common/logIpc.js';

function roundTrip<T>(value: T): T {
	const writer = new BufferWriter();
	try {
		serialize(writer, value);
		return deserialize(new BufferReader(writer.buffer));
	} finally {
		writer.dispose();
	}
}

class TestLoggerChannel extends Disposable implements IChannel {
	private readonly changes = this._register(new Emitter<DidChangeLoggersEvent>());
	readonly calls: string[] = [];

	constructor(private readonly initialLoggers: ILoggerResource[], private readonly serializedEvents: boolean) {
		super();
	}

	listen<T>(event: string): Event<T> {
		switch (event) {
			case 'onDidChangeLoggers': return this.changes.event as Event<T>;
			case 'onDidChangeLogLevel':
			case 'onDidChangeVisibility': return Event.None;
		}
		throw new Error(`Unexpected event: ${event}`);
	}

	call<T>(command: string): Promise<T> {
		this.calls.push(command);
		switch (command) {
			case 'getRegisteredLoggers': return Promise.resolve(roundTrip(this.initialLoggers)) as Promise<T>;
			case 'setLogLevel': return Promise.resolve(undefined) as Promise<T>;
		}
		throw new Error(`Unexpected command: ${command}`);
	}

	fire(change: DidChangeLoggersEvent): void {
		this.changes.fire(this.serializedEvents ? roundTrip(change) : change);
	}
}

suite('Logger IPC removal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const remote of [false, true]) {
		for (const serializedEvents of [false, true]) {
			test(`${remote ? 'RemoteLoggerChannelClient' : 'LoggerChannelClient'} removes ${serializedEvents ? 'serialized' : 'live'} URI registrations`, async () => {
				const keptLogger: ILoggerResource = { id: 'kept', resource: URI.file('/logs/window1/kept.log') };
				const removedLogger: ILoggerResource = { id: 'removed', resource: URI.file('/logs/window2/removed logger.log').with({ query: 'scope=window', fragment: 'output' }) };
				const addedLogger: ILoggerResource = { id: 'added', resource: URI.file('/logs/window3/added.log') };
				const channel = store.add(new TestLoggerChannel([keptLogger], serializedEvents));
				let service: ILoggerService;
				if (remote) {
					service = store.add(new NullLoggerService());
					const initialRegistration = Event.toPromise(service.onDidChangeLoggers);
					store.add(new RemoteLoggerChannelClient(service, channel));
					await initialRegistration;
				} else {
					service = store.add(new LoggerChannelClient(undefined, LogLevel.Info, URI.file('/logs'), [keptLogger], channel));
				}
				const initialCalls = [...channel.calls];
				const removed: string[] = [];
				store.add(service.onDidChangeLoggers(change => {
					for (const logger of change.removed) {
						assert.ok(URI.isUri(logger.resource));
						removed.push(logger.resource.toString());
					}
				}));

				channel.fire({ added: [removedLogger], removed: [] });
				channel.fire({ added: [addedLogger], removed: [removedLogger] });

				assert.deepStrictEqual({
					registered: [...service.getRegisteredLoggers()].map(logger => logger.resource.toString()),
					removed,
					additionalCalls: channel.calls.slice(initialCalls.length),
				}, {
					registered: [keptLogger.resource.toString(), addedLogger.resource.toString()],
					removed: [removedLogger.resource.toString()],
					additionalCalls: [],
				});
			});
		}
	}
});
