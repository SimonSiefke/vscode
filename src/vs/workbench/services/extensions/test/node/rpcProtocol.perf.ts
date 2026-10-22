/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { performance } from 'perf_hooks';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { MessageChannel } from 'worker_threads';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IMessagePassingProtocol, wrapStructuredCloneMessage } from '../../../../../base/parts/ipc/common/ipc.js';
import { ProxyIdentifier } from '../../common/proxyIdentifier.js';

const { values: options } = parseArgs({
	options: {
		module: { type: 'string' },
		native: { type: 'boolean', default: false },
		samples: { type: 'string', default: '3' },
		iterations: { type: 'string', default: '1000' }
	}
});
const samples = Number(options.samples);
const iterations = Number(options.iterations);
assert.ok(Number.isSafeInteger(samples) && samples > 0);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
const { RPCProtocol } = options.module
	? await import(pathToFileURL(options.module).href) as typeof import('../../common/rpcProtocol.js')
	: await import('../../common/rpcProtocol.js');

const settings = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`editor.setting${index}`, { enabled: true, value: index, scopes: ['user', 'workspace'] }]));
const fixtures: { name: string; value: unknown }[] = [
	{ name: 'primitive', value: 42 },
	{ name: 'small-object', value: { command: 'open', options: { pinned: true }, ids: [1, 2, 3] } },
	{ name: 'settings-100', value: settings },
	{ name: 'text-4KiB', value: 'a'.repeat(4096) }
];
const results: { name: string; microsecondsPerRoundTrip: number[]; messages: number; bytes: number; backingBytes: number; nativeMessages: number; nativeStringCharacters: number }[] = [];
for (const fixture of fixtures) {
	const store = new DisposableStore();
	try {
		const { port1, port2 } = new MessageChannel();
		store.add(toDisposable(() => {
			port1.close();
			port2.close();
		}));
		const traffic = { messages: 0, bytes: 0, backingBytes: 0, nativeMessages: 0, nativeStringCharacters: 0 };
		const protocol = (port: typeof port1): IMessagePassingProtocol => ({
			send: message => {
				traffic.messages++;
				traffic.bytes += message.byteLength;
				traffic.backingBytes += message.buffer.buffer.byteLength;
				port.postMessage(message.buffer);
			},
			onMessage: Event.fromNodeEventEmitter(port, 'message', data => ArrayBuffer.isView(data) ? VSBuffer.wrap(data as Uint8Array) : wrapStructuredCloneMessage(data)),
			sendStructuredClone: options.native ? message => {
				traffic.messages++;
				traffic.nativeMessages++;
				traffic.nativeStringCharacters += typeof message.body === 'string' ? message.body.length : 0;
				port.postMessage(message);
			} : undefined
		});
		const client = store.add(new RPCProtocol(protocol(port1)));
		const server = store.add(new RPCProtocol(protocol(port2)));
		const actor = { $echo: (value: unknown) => value };
		const identifier = new ProxyIdentifier<typeof actor>(`benchmark-${fixture.name}`);
		server.set(identifier, actor);
		const proxy = client.getProxy(identifier);
		assert.deepStrictEqual(await proxy.$echo(fixture.value), fixture.value);
		for (let index = 0; index < 200; index++) {
			await proxy.$echo(fixture.value);
		}
		traffic.messages = traffic.bytes = traffic.backingBytes = traffic.nativeMessages = traffic.nativeStringCharacters = 0;
		const times: number[] = [];
		for (let sample = 0; sample < samples; sample++) {
			const start = performance.now();
			let last: unknown;
			for (let index = 0; index < iterations; index++) {
				last = await proxy.$echo(fixture.value);
			}
			times.push((performance.now() - start) * 1000 / iterations);
			assert.deepStrictEqual(last, fixture.value);
		}
		results.push({ name: fixture.name, microsecondsPerRoundTrip: times, ...traffic });
	} finally {
		store.dispose();
	}
}
console.log(JSON.stringify({ node: process.version, transport: 'node-message-port', module: options.module, samples, iterations, warmups: 200, results }, null, 2));
