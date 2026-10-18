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
		transport: { type: 'string', default: 'message-port' },
		samples: { type: 'string', default: '15' },
		iterations: { type: 'string', default: '1000' }
	}
});
const samples = Number(options.samples);
const iterations = Number(options.iterations);
assert.ok(Number.isSafeInteger(samples) && samples > 0);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
assert.ok(['clone', 'message-port', 'buffer-clone', 'buffer-message-port'].includes(options.transport));
const { ChannelClient, ChannelServer } = options.module
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
for (const benchmark of cases) {
	const store = new DisposableStore();
	try {
		const [clientProtocol, serverProtocol] = createProtocols(store);
		const client = store.add(new ChannelClient(clientProtocol));
		const server = store.add(new ChannelServer(serverProtocol, 'benchmark'));
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
console.log(JSON.stringify({ node: process.version, versions: process.versions, transport: options.transport, module: options.module, samples, iterations, results }, null, 2));
