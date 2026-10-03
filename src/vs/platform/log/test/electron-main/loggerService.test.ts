/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { BufferReader, BufferWriter, deserialize, IChannel, serialize } from '../../../../base/parts/ipc/common/ipc.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AbstractMessageLogger, ILogger, ILoggerOptions, LogLevel } from '../../common/log.js';
import { LoggerChannelClient } from '../../common/logIpc.js';
import { LoggerChannel } from '../../electron-main/logIpc.js';
import { LoggerMainService } from '../../electron-main/loggerService.js';

class TestLogger extends AbstractMessageLogger {
	readonly messages: string[] = [];
	disposeCount = 0;

	constructor(level: LogLevel) {
		super();
		this.setLevel(level);
	}

	protected log(_level: LogLevel, message: string): void {
		this.messages.push(message);
	}

	override dispose(): void {
		this.disposeCount++;
		super.dispose();
	}
}

class TestLoggerMainService extends LoggerMainService {
	readonly created: TestLogger[] = [];
	failCreation = false;

	protected override doCreateLogger(_resource: URI, level: LogLevel, _options?: ILoggerOptions): ILogger {
		if (this.failCreation) {
			throw new Error('creation failed');
		}
		const logger = new TestLogger(level);
		this.created.push(logger);
		return logger;
	}
}

function transfer<T>(value: T): T {
	const writer = new BufferWriter();
	try {
		serialize(writer, value);
		return deserialize(new BufferReader(writer.buffer));
	} finally {
		writer.dispose();
	}
}

class TestChannel implements IChannel {
	creation: DeferredPromise<void> | undefined;
	delayEvents = false;
	private readonly events: (() => void)[] = [];
	private readonly pending: Promise<unknown>[] = [];
	readonly calls: { command: string; args: unknown[] }[] = [];

	constructor(private readonly channel: LoggerChannel) { }

	listen<T>(event: string, arg?: unknown): Event<T> {
		const source = this.channel.listen(undefined, event, arg as number | undefined);
		return listener => source(value => {
			const emit = () => listener(transfer(value));
			if (this.delayEvents) {
				this.events.push(emit);
			} else {
				emit();
			}
		});
	}

	call<T>(command: string, args: unknown[] = []): Promise<T> {
		this.calls.push({ command, args });
		const result = this.channel.call(undefined, command, transfer(args)).then(async result => {
			if (command === 'createLogger') {
				await this.creation?.p;
			}
			return result;
		});
		this.pending.push(result);
		return result;
	}

	flushEvents(): void {
		for (const emit of this.events.splice(0)) {
			emit();
		}
	}

	async settle(): Promise<void> {
		await Promise.all(this.pending);
	}

}

suite('Logger reference handles', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/logs/shared.log');

	function setup() {
		const service = store.add(new TestLoggerMainService(LogLevel.Info, URI.file('/logs')));
		const channel = new TestChannel(store.add(new LoggerChannel(service)));
		const client = (windowId: number | undefined) => store.add(new LoggerChannelClient(windowId, LogLevel.Info, URI.file(`/logs/window${windowId}`), [], channel));
		return { service, channel, client };
	}

	test('independent acquisitions share one backend until the last release', () => {
		const { service } = setup();
		const first = store.add(service.acquireLogger(resource, undefined, 1));
		const second = store.add(service.acquireLogger(resource, undefined, 1));
		assert.strictEqual(first.object, second.object);
		first.dispose();
		first.dispose();
		assert.strictEqual(service.created[0].disposeCount, 0);
		second.object.info('still open');
		assert.deepStrictEqual(service.created[0].messages, ['still open']);
		second.dispose();
		assert.strictEqual(service.created[0].disposeCount, 1);
		assert.strictEqual(service.getRegisteredLogger(resource), undefined);
	});

	test('window shutdown releases all its handles and preserves global owners', () => {
		const { service } = setup();
		store.add(service.acquireLogger(resource, undefined, 1));
		store.add(service.acquireLogger(resource, undefined, 1));
		const global = store.add(service.acquireLogger(resource));
		service.deregisterLoggers(1);
		assert.strictEqual(service.created[0].disposeCount, 0);
		assert.strictEqual(service.getGlobalLoggers().length, 1);
		global.dispose();
		assert.strictEqual(service.created[0].disposeCount, 1);
	});

	test('metadata references do not create file writers', () => {
		const { service } = setup();
		store.add(service.acquireLoggerResource({ resource, id: 'remote' }, 1));
		store.add(service.acquireLoggerResource({ resource, id: 'remote' }, 2));
		service.deregisterLoggers(1);
		assert.ok(service.getRegisteredLogger(resource));
		assert.strictEqual(service.created.length, 0);
		service.deregisterLoggers(2);
		assert.strictEqual(service.getRegisteredLogger(resource), undefined);
	});

	test('cached creation remains idempotent and creation failure preserves other owners', () => {
		const { service } = setup();
		service.registerLogger({ resource, id: 'remote' });
		service.failCreation = true;
		assert.throws(() => service.acquireLogger(resource, undefined, 2), /creation failed/);
		assert.ok(service.getRegisteredLogger(resource));
		service.failCreation = false;
		assert.strictEqual(service.createLogger(resource), service.createLogger(resource));
		store.add(service.acquireLogger(resource, undefined, 2));
		service.deregisterLoggers(2);
		assert.strictEqual(service.created[0].disposeCount, 0);
		service.deregisterLogger(resource);
		assert.strictEqual(service.created[0].disposeCount, 1);
	});

	test('both windows receive updates and only the final release removes the logger', async () => {
		const { service, channel, client } = setup();
		const first = client(1);
		const second = client(2);
		first.createLogger(resource).info('first');
		const logger = second.createLogger(resource);
		await channel.settle();
		service.setLogLevel(resource, LogLevel.Debug);
		assert.strictEqual(first.getLogger(resource)?.getLevel(), LogLevel.Debug);
		assert.strictEqual(logger.getLevel(), LogLevel.Debug);
		first.deregisterLogger(resource);
		logger.info('second');
		assert.deepStrictEqual(service.created[0].messages, ['first', 'second']);
		assert.ok(service.getRegisteredLogger(resource));
		second.deregisterLogger(resource);
		assert.strictEqual(service.created[0].disposeCount, 1);
	});

	test('closing one window leaves the other window able to write', async () => {
		const { service, channel, client } = setup();
		const closed = client(1).createLogger(resource);
		const surviving = client(2).createLogger(resource);
		await channel.settle();
		service.deregisterLoggers(1);
		closed.info('closed window');
		surviving.info('surviving window');
		assert.deepStrictEqual(service.created[0].messages, ['surviving window']);
		service.deregisterLoggers(2);
		assert.strictEqual(service.created[0].disposeCount, 1);
	});

	test('disposing before creation completes drops buffered messages', async () => {
		const { service, channel, client } = setup();
		channel.creation = new DeferredPromise<void>();
		const logger = client(1).createLogger(resource);
		logger.info('buffered');
		logger.dispose();
		await channel.creation.complete();
		await channel.settle();
		assert.deepStrictEqual(service.created[0].messages, []);
		assert.strictEqual(service.created[0].disposeCount, 1);
	});

	test('a disposed handle cannot write to or release a replacement', async () => {
		const { service, channel, client } = setup();
		const owner = client(1);
		const previous = owner.createLogger(resource);
		const oldId = channel.calls.find(call => call.command === 'createLogger')!.args[3];
		previous.dispose();
		const replacement = owner.createLogger(resource);
		await channel.settle();
		await channel.call('log', [oldId, [[LogLevel.Info, 'stale']]]);
		await channel.call('deregisterLogger', [oldId]);
		previous.dispose();
		replacement.info('replacement');
		assert.deepStrictEqual(service.created[1].messages, ['replacement']);
		assert.strictEqual(service.created[1].disposeCount, 0);
	});

	test('repeated metadata registration acquires only one handle per client', () => {
		const { service, client } = setup();
		const first = client(1);
		const second = client(2);
		first.registerLogger({ resource, id: 'remote' });
		first.registerLogger({ resource, id: 'remote' });
		second.registerLogger({ resource, id: 'remote' });
		first.deregisterLogger(resource);
		assert.ok(service.getRegisteredLogger(resource));
		second.deregisterLogger(resource);
		assert.strictEqual(service.getRegisteredLogger(resource), undefined);
		assert.strictEqual(service.created.length, 0);
	});

	test('removal broadcasts clean up observers without a local handle', () => {
		const { client } = setup();
		const producer = client(undefined);
		const observer = client(2);
		producer.createLogger(resource);
		assert.ok(observer.getRegisteredLogger(resource));
		producer.deregisterLogger(resource);
		assert.strictEqual(observer.getRegisteredLogger(resource), undefined);
	});

	test('a delayed removal broadcast cannot dispose a newly acquired logger', async () => {
		const { service, channel, client } = setup();
		const owner = client(1);
		owner.createLogger(resource);
		await channel.settle();
		channel.delayEvents = true;
		owner.deregisterLogger(resource);
		const replacement = owner.createLogger(resource);
		channel.flushEvents();
		await channel.settle();
		replacement.info('replacement');
		assert.deepStrictEqual(service.created[1].messages, ['replacement']);
		assert.strictEqual(service.created[1].disposeCount, 0);
	});

	test('a removal listener can acquire a replacement without losing its ownership', () => {
		const { service } = setup();
		const first = store.add(service.acquireLogger(resource, undefined, 1));
		store.add(Event.once(service.onDidChangeLoggers)(() => store.add(service.acquireLogger(resource, undefined, 2))));
		first.dispose();
		assert.ok(service.getRegisteredLogger(resource));
		service.deregisterLoggers(2);
		assert.strictEqual(service.created[1].disposeCount, 1);
	});


	test('a registration listener can create a global logger with independent ownership', () => {
		const { service } = setup();
		const other = URI.file('/logs/other.log');
		store.add(Event.once(service.onDidChangeLoggers)(() => service.createLogger(other)));
		store.add(service.acquireLogger(resource, undefined, 1));
		service.deregisterLoggers(1);
		assert.ok(service.getRegisteredLogger(other));
		service.deregisterLogger(other);
		assert.strictEqual(service.created[1].disposeCount, 1);
	});

});
