/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { performance } from 'perf_hooks';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { MessageChannel } from 'worker_threads';
import { VSBuffer } from '../../../../common/buffer.js';
import { Emitter, Event } from '../../../../common/event.js';
import { DisposableStore, toDisposable } from '../../../../common/lifecycle.js';
import { URI } from '../../../../common/uri.js';
import type { IChannelMessagePassingProtocol, IStructuredCloneMessage } from '../../common/ipc.js';
import { createMessagePortProtocols } from './ipcTestUtils.js';

// Run explicitly after building: node out/vs/base/parts/ipc/test/node/ipc.perf.js
// --module can select an unmodified ipc.js built from the parent commit.
const { values: options } = parseArgs({
	options: {
		module: { type: 'string' },
		bidirectional: { type: 'boolean', default: false },
		'pool-size': { type: 'string', default: String(process.platform === 'linux' ? 8192 : Buffer.poolSize) },
		filter: { type: 'string', default: '.*' },
		transport: { type: 'string', default: 'message-port' },
		samples: { type: 'string', default: '15' },
		iterations: { type: 'string', default: '1000' }
	}
});
const poolSize = Number(options['pool-size']);
assert.ok(Number.isSafeInteger(poolSize) && poolSize >= 2048);
Buffer.poolSize = poolSize;
for (let index = 0; index < 256; index++) {
	if (Buffer.allocUnsafe(512).buffer.byteLength === poolSize) {
		break;
	}
}
assert.strictEqual(Buffer.allocUnsafe(8).buffer.byteLength, poolSize);
const fixtureFilter = new RegExp(options.filter);
const samples = Number(options.samples);
const iterations = Number(options.iterations);
assert.ok(Number.isSafeInteger(samples) && samples > 0);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
assert.ok(['clone', 'message-port', 'buffer-clone', 'buffer-message-port'].includes(options.transport));
const { ChannelClient, ChannelServer, IPCClient } = options.module
	? await import(pathToFileURL(options.module).href) as typeof import('../../common/ipc.js')
	: await import('../../common/ipc.js');

function createProtocols(store: DisposableStore): [IChannelMessagePassingProtocol, IChannelMessagePassingProtocol] {
	if (options.transport === 'message-port') {
		return createMessagePortProtocols(store);
	}
	if (options.transport === 'buffer-message-port') {
		const { port1, port2 } = new MessageChannel();
		store.add(toDisposable(() => {
			port1.close();
			port2.close();
		}));
		return [port1, port2].map(port => ({
			send: (value: VSBuffer) => port.postMessage(value.buffer),
			onMessage: Event.fromNodeEventEmitter(port, 'message', (value: Uint8Array) => VSBuffer.wrap(value))
		})) as [IChannelMessagePassingProtocol, IChannelMessagePassingProtocol];
	}
	if (options.transport === 'buffer-clone') {
		const one = store.add(new Emitter<VSBuffer>());
		const two = store.add(new Emitter<VSBuffer>());
		return [
			{ onMessage: one.event, send: value => two.fire(VSBuffer.wrap(structuredClone(value.buffer))) },
			{ onMessage: two.event, send: value => one.fire(VSBuffer.wrap(structuredClone(value.buffer))) }
		];
	}
	const one = store.add(new Emitter<IStructuredCloneMessage>());
	const two = store.add(new Emitter<IStructuredCloneMessage>());
	return [
		{ type: 'structuredClone', onMessage: one.event, send: value => two.fire(structuredClone(value)) },
		{ type: 'structuredClone', onMessage: two.event, send: value => one.fire(structuredClone(value)) }
	];
}

interface BenchmarkCase {
	name: string;
	value: unknown;
	check(value: unknown): void;
}

const settings = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`editor.setting${index}`, { enabled: true, value: index, scopes: ['user', 'workspace'] }]));
const uris = Array.from({ length: 100 }, (_, index) => URI.file(`/workspace/folder${index}/file.txt`));
const buffer = VSBuffer.wrap(new Uint8Array(4096).fill(97));
const cases: BenchmarkCase[] = [
	...[
		{ name: 'primitive', value: 42 },
		{ name: 'small-object', value: { command: 'open', options: { pinned: true }, ids: [1, 2, 3] } },
		{ name: 'settings-100', value: settings },
		{ name: 'stat-object', value: { type: 1, ctime: 1700000000000, mtime: 1700000000001, size: 4096, permissions: 0 } },
		{ name: 'directory-100', value: Array.from({ length: 100 }, (_, index) => [`file${index}.txt`, 1]) },
		{ name: 'keys-1000', value: Array.from({ length: 1000 }, (_, index) => `editor.setting${index}`) },
		{ name: 'text-4KiB', value: 'a'.repeat(4096) }
	].map(({ name, value }) => ({ name, value, check: (result: unknown) => assert.deepStrictEqual(result, value) })),
	{ name: 'uris-100', value: uris, check: result => assert.deepStrictEqual(result, uris.map(uri => uri.toJSON())) },
	{
		name: 'VSBuffer-4KiB', value: buffer, check: result => {
			assert.ok(result instanceof VSBuffer);
			assert.strictEqual(result.toString(), buffer.toString());
		}
	}
];
for (const size of [64, 1024]) {
	const pooled = VSBuffer.fromString('a'.repeat(size));
	cases.push({
		name: `VSBuffer-${size}B`, value: pooled, check: result => {
			assert.ok(result instanceof VSBuffer);
			assert.strictEqual(result.toString(), pooled.toString());
		}
	}, {
		name: `Uint8Array-${size}B`, value: pooled.buffer, check: result => {
			assert.ok(result instanceof Uint8Array);
			assert.deepStrictEqual([...result], [...pooled.buffer]);
		}
	});
}
if (!options.transport.startsWith('buffer-')) {
	const graph = { map: new Map<object, object>(), set: new Set<object>(), buffer };
	graph.map.set(graph, graph.set);
	graph.set.add(graph);
	graph.set.add(buffer);
	cases.push({
		name: 'cyclic-map-set', value: graph, check: result => {
			const value = result as typeof graph;
			assert.strictEqual(value.map.get(value), value.set);
			assert.ok(value.set.has(value) && value.set.has(value.buffer));
			assert.strictEqual(value.buffer.toString(), buffer.toString());
		}
	});
}

const results: { name: string; microsecondsPerRoundTrip: number[] }[] = [];
for (const benchmark of cases.filter(benchmark => fixtureFilter.test(benchmark.name))) {
	const store = new DisposableStore();
	try {
		const [clientProtocol, serverProtocol] = createProtocols(store);
		const client = store.add(options.bidirectional ? new IPCClient(clientProtocol, 'benchmark-client') : new ChannelClient(clientProtocol));
		const server = store.add(options.bidirectional ? new IPCClient(serverProtocol, 'benchmark-server') : new ChannelServer(serverProtocol, 'benchmark'));
		server.registerChannel('echo', { call: async (_ctx, _command, arg) => arg, listen: () => Event.None });
		const channel = client.getChannel('echo');
		benchmark.check(await channel.call('echo', benchmark.value));
		for (let index = 0; index < 200; index++) {
			await channel.call('echo', benchmark.value);
		}
		const times: number[] = [];
		for (let sample = 0; sample < samples; sample++) {
			const start = performance.now();
			let last: unknown;
			for (let index = 0; index < iterations; index++) {
				last = await channel.call('echo', benchmark.value);
			}
			times.push((performance.now() - start) * 1000 / iterations);
			benchmark.check(last);
		}
		results.push({ name: benchmark.name, microsecondsPerRoundTrip: times });
	} finally {
		store.dispose();
	}
}
console.log(JSON.stringify({ node: process.version, bufferPoolSize: Buffer.poolSize, bidirectional: options.bidirectional, versions: process.versions, transport: options.transport, module: options.module, samples, iterations, results }, null, 2));
