/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IShellLaunchConfigDto } from '../../../../platform/terminal/common/terminal.js';
import { MainContext, MainThreadTerminalServiceShape } from '../../common/extHost.protocol.js';
import { ArgumentProcessor, ExtHostCommands } from '../../common/extHostCommands.js';
import { WorkerExtHostTerminalService } from '../../common/extHostTerminalService.js';
import { TerminalExitReason } from '../../common/extHostTypes.js';
import { IExtHostInitDataService } from '../../common/extHostInitDataService.js';
import { TestRPCProtocol } from './testRPCProtocol.js';

suite('ExtHostTerminalService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	suite('Link provider disposal', () => {
		function getLinkCache(service: WorkerExtHostTerminalService): ReadonlyMap<number, ReadonlyMap<number, { provider: vscode.TerminalLinkProvider; link: vscode.TerminalLink }>> {
			return Reflect.get(service, '_terminalLinkCache');
		}

		function createService(): WorkerExtHostTerminalService {
			const rpcProtocol = new TestRPCProtocol();
			rpcProtocol.set(MainContext.MainThreadTerminalService, new class extends mock<MainThreadTerminalServiceShape>() {
				override async $registerProcessSupport(): Promise<void> { }
				override $startLinkProvider(): void { }
				override $stopLinkProvider(): void { }
			});
			const commands = new class extends mock<ExtHostCommands>() {
				override registerArgumentProcessor(_processor: ArgumentProcessor): void { }
			};
			const initData = new class extends mock<IExtHostInitDataService>() {
				override readonly remote = { authority: 'test+remote', isRemote: true, connectionData: null };
			};
			const service = store.add(new WorkerExtHostTerminalService(commands, rpcProtocol, initData));
			service.$acceptTerminalOpened(42, undefined, 'test', {} as IShellLaunchConfigDto);
			store.add(service.getTerminalById(42)!);
			return service;
		}

		test('releases cached links and stops activation when their provider is disposed', async () => {
			const service = createService();
			let handled = 0;
			const registration = store.add(service.registerLinkProvider({
				provideTerminalLinks: () => [{ startIndex: 0, length: 5 }],
				handleTerminalLink: () => { handled++; }
			}));
			const [link] = await service.$provideLinks(42, 'hello');
			service.$activateLink(42, link.id);
			registration.dispose();
			service.$activateLink(42, link.id);
			assert.deepStrictEqual({ handled, cached: getLinkCache(service).get(42)?.size ?? 0 }, { handled: 1, cached: 0 });
		});

		test('keeps other live providers cached and activatable', async () => {
			const service = createService();
			const handled: string[] = [];
			const retired = store.add(service.registerLinkProvider({
				provideTerminalLinks: () => [{ startIndex: 0, length: 5 }],
				handleTerminalLink: () => { handled.push('retired'); }
			}));
			store.add(service.registerLinkProvider({
				provideTerminalLinks: () => [{ startIndex: 6, length: 5 }],
				handleTerminalLink: () => { handled.push('live'); }
			}));
			const links = await service.$provideLinks(42, 'hello world');
			retired.dispose();
			for (const link of links) {
				service.$activateLink(42, link.id);
			}
			assert.deepStrictEqual({ handled, cached: getLinkCache(service).get(42)?.size ?? 0 }, { handled: ['live'], cached: 1 });
		});

		test('ignores late asynchronous links from a disposed provider', async () => {
			const service = createService();
			const pending = new DeferredPromise<vscode.TerminalLink[]>();
			const registration = store.add(service.registerLinkProvider({
				provideTerminalLinks: () => pending.p,
				handleTerminalLink: () => assert.fail('retired provider was activated')
			}));
			const request = service.$provideLinks(42, 'hello');
			registration.dispose();
			await pending.complete([{ startIndex: 0, length: 5 }]);
			const links = await request;
			assert.deepStrictEqual({ links, cached: getLinkCache(service).get(42)?.size ?? 0 }, { links: [], cached: 0 });
		});

		test('normal live asynchronous links still work', async () => {
			const service = createService();
			const pending = new DeferredPromise<vscode.TerminalLink[]>();
			let handled = 0;
			store.add(service.registerLinkProvider({
				provideTerminalLinks: () => pending.p,
				handleTerminalLink: () => { handled++; }
			}));
			const request = service.$provideLinks(42, 'hello');
			await pending.complete([{ startIndex: 0, length: 5 }]);
			const links = await request;
			service.$activateLink(42, links[0].id);
			assert.deepStrictEqual({ count: links.length, handled }, { count: 1, handled: 1 });
		});

		test('does not publish a retired request after the same provider object is registered again', async () => {
			const service = createService();
			const pending = new DeferredPromise<vscode.TerminalLink[]>();
			const provider: vscode.TerminalLinkProvider = {
				provideTerminalLinks: () => pending.p,
				handleTerminalLink: () => { }
			};
			const retired = store.add(service.registerLinkProvider(provider));
			const request = service.$provideLinks(42, 'hello');
			retired.dispose();
			store.add(service.registerLinkProvider(provider));
			await pending.complete([{ startIndex: 0, length: 5 }]);
			assert.deepStrictEqual(await request, []);
		});

		test('releases cached provider references from every still-open terminal', async () => {
			const service = createService();
			service.$acceptTerminalOpened(43, undefined, 'second', {} as IShellLaunchConfigDto);
			store.add(service.getTerminalById(43)!);
			const registration = store.add(service.registerLinkProvider({
				provideTerminalLinks: () => [{ startIndex: 0, length: 5 }],
				handleTerminalLink: () => { }
			}));
			await service.$provideLinks(42, 'hello');
			await service.$provideLinks(43, 'hello');
			registration.dispose();
			assert.deepStrictEqual([...getLinkCache(service).values()].map(links => links.size), []);
		});

		test('keeps live results when another provider is disposed during the same request', async () => {
			const service = createService();
			const pending = new DeferredPromise<vscode.TerminalLink[]>();
			const retired = store.add(service.registerLinkProvider({
				provideTerminalLinks: () => pending.p,
				handleTerminalLink: () => assert.fail('retired provider was activated')
			}));
			store.add(service.registerLinkProvider({
				provideTerminalLinks: () => [{ startIndex: 6, length: 5 }],
				handleTerminalLink: () => { }
			}));
			const request = service.$provideLinks(42, 'hello world');
			retired.dispose();
			await pending.complete([{ startIndex: 0, length: 5 }]);
			assert.deepStrictEqual((await request).map(link => link.startIndex), [6]);
		});

		test('preserves the provider receiver for discovery and activation', async () => {
			const service = createService();
			const handled: string[] = [];
			const provider = {
				label: 'live',
				provideTerminalLinks() {
					return [{ startIndex: 0, length: 5, tooltip: this.label }];
				},
				handleTerminalLink() {
					handled.push(this.label);
				}
			};
			store.add(service.registerLinkProvider(provider));
			const [link] = await service.$provideLinks(42, 'hello');
			service.$activateLink(42, link.id);
			assert.deepStrictEqual({ label: link.label, handled }, { label: 'live', handled: ['live'] });
		});

		test('preserves provider error propagation without caching failed links', async () => {
			const service = createService();
			const error = new Error('provider failed');
			store.add(service.registerLinkProvider({
				provideTerminalLinks: async () => { throw error; },
				handleTerminalLink: () => { }
			}));
			await assert.rejects(service.$provideLinks(42, 'hello'), error);
			assert.strictEqual(getLinkCache(service).size, 0);
		});
	});

	test('$acceptTerminalClosed cancels in-flight link providers and clears the link cache', async () => {
		const rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadTerminalService, new class extends mock<MainThreadTerminalServiceShape>() {
			override async $registerProcessSupport(): Promise<void> { }
			override async $sendProcessExit(): Promise<void> { }
			override $startLinkProvider(): void { }
			override $stopLinkProvider(): void { }
		});

		const commands = new class extends mock<ExtHostCommands>() {
			override registerArgumentProcessor(_processor: ArgumentProcessor): void { }
		};
		const initData = new class extends mock<IExtHostInitDataService>() {
			override readonly remote = { authority: 'test+remote', isRemote: true, connectionData: null };
		};

		const service = store.add(new WorkerExtHostTerminalService(commands, rpcProtocol, initData));

		const terminalId = 42;
		service.$acceptTerminalOpened(terminalId, undefined, 'test', {} as IShellLaunchConfigDto);
		// $acceptTerminalClosed splices the terminal out of `_terminals` but doesn't dispose it,
		// so register it with the test store to keep the leak detector quiet.
		const terminal = service.getTerminalById(terminalId)!;
		store.add(terminal);

		// Link provider that only resolves when the cancellation token fires, so we can observe
		// cancellation as the externally-visible effect of $acceptTerminalClosed.
		let providerTokenCancelled = false;
		let handledAfterClose = false;
		const provider: vscode.TerminalLinkProvider = {
			provideTerminalLinks(_ctx, token) {
				return new Promise(resolve => {
					store.add(token.onCancellationRequested(() => {
						providerTokenCancelled = true;
						resolve([{ startIndex: 0, length: 5, tooltip: 'x' }]);
					}));
				});
			},
			handleTerminalLink() {
				handledAfterClose = true;
			}
		};
		store.add(service.registerLinkProvider(provider));

		const inFlight = service.$provideLinks(terminalId, 'hello');
		await service.$acceptTerminalClosed(terminalId, undefined, TerminalExitReason.Unknown);
		const firstLinks = await inFlight;

		// Any cached links that might have been written before close should have been cleared, so
		// $activateLink for a closed terminal is a no-op.
		service.$activateLink(terminalId, 0);

		// A subsequent $provideLinks for the same id sees a clean slate (terminal is gone -> []).
		const linksAfterClose = await service.$provideLinks(terminalId, 'hello');

		assert.deepStrictEqual(
			{ providerTokenCancelled, firstLinks, linksAfterClose, handledAfterClose },
			{ providerTokenCancelled: true, firstLinks: [], linksAfterClose: [], handledAfterClose: false }
		);
	});

	test('extension terminal processes are released when terminals close', async () => {
		const rpcProtocol = new TestRPCProtocol();
		let processExitCalls = 0;
		rpcProtocol.set(MainContext.MainThreadTerminalService, new class extends mock<MainThreadTerminalServiceShape>() {
			override async $registerProcessSupport(): Promise<void> { }
			override async $sendProcessExit(): Promise<void> { processExitCalls++; }
			override async $sendProcessReady(): Promise<void> { }
		});

		const commands = new class extends mock<ExtHostCommands>() {
			override registerArgumentProcessor(_processor: ArgumentProcessor): void { }
		};
		const initData = new class extends mock<IExtHostInitDataService>() {
			override readonly remote = { authority: 'test+remote', isRemote: true, connectionData: null };
		};
		const service = store.add(new WorkerExtHostTerminalService(commands, rpcProtocol, initData));

		const terminalId = 42;
		service.$acceptTerminalOpened(terminalId, undefined, 'test', {} as IShellLaunchConfigDto);
		const terminal = service.getTerminalById(terminalId)!;
		store.add(terminal);

		const writeEmitter = store.add(new Emitter<string>());
		const closeEmitter = store.add(new Emitter<number | void>());
		const inputs: string[] = [];
		let closeOnOpen = false;
		const pty: vscode.Pseudoterminal = {
			onDidWrite: writeEmitter.event,
			onDidClose: closeEmitter.event,
			open(): void { if (closeOnOpen) { closeEmitter.fire(); } },
			close(): void { },
			handleInput(data: string): void { inputs.push(data); }
		};
		service.attachPtyToTerminal(terminalId, pty);
		await service.$startExtensionTerminal(terminalId, undefined);
		await rpcProtocol.sync();

		service.$acceptProcessInput(terminalId, 'before');
		await service.$acceptTerminalClosed(terminalId, undefined, TerminalExitReason.Unknown);
		service.$acceptProcessInput(terminalId, 'after');
		closeEmitter.fire();
		await rpcProtocol.sync();

		assert.deepStrictEqual(inputs, ['before']);
		assert.strictEqual(processExitCalls, 0);

		const synchronousTerminalId = 43;
		service.$acceptTerminalOpened(synchronousTerminalId, undefined, 'test', {} as IShellLaunchConfigDto);
		store.add(service.getTerminalById(synchronousTerminalId)!);
		closeOnOpen = true;
		service.attachPtyToTerminal(synchronousTerminalId, pty);
		await service.$startExtensionTerminal(synchronousTerminalId, undefined);
		await rpcProtocol.sync();

		assert.strictEqual(closeEmitter.hasListeners(), false);
		assert.strictEqual(processExitCalls, 1);
	});
});
