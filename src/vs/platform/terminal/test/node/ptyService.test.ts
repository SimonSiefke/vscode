/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { SerializeAddon } from '@xterm/addon-serialize';
import pkg from '@xterm/headless';
import { createSandbox } from 'sinon';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { PtyService, XtermSerializer } from '../../node/ptyService.js';
import { ITerminalChildProcess, IShellLaunchConfig, ISerializedTerminalState } from '../../common/terminal.js';
import type { IProcessDetails } from '../../common/terminalProcess.js';
import { AutoRepliesPtyServiceContribution } from '../../node/terminalContrib/autoReplies/autoRepliesContribController.js';

suite('XtermSerializer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const sandbox = createSandbox();

	teardown(() => sandbox.restore());

	function createSerializer(rawReviveBuffer?: string) {
		const loadAddon = sandbox.spy(pkg.Terminal.prototype, 'loadAddon');
		const serializer = new XtermSerializer(80, 30, 100, '6', undefined, 'test-nonce', rawReviveBuffer, new NullLogService());
		const terminal: pkg.Terminal = loadAddon.firstCall.thisValue;
		store.add(toDisposable(() => terminal.dispose()));
		return { serializer, terminal };
	}

	test('releases each replay addon without changing the serialized screen', async () => {
		const { serializer, terminal } = createSerializer();
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		await new Promise<void>(resolve => terminal.write('replay-ready', resolve));
		const results = [];
		for (let index = 0; index < 3; index++) {
			const replay = await serializer.generateReplayEvent();
			results.push({ disposed: dispose.callCount, screen: replay.events[0].data });
		}
		deepStrictEqual(results, [
			{ disposed: 1, screen: 'replay-ready' },
			{ disposed: 2, screen: 'replay-ready' },
			{ disposed: 3, screen: 'replay-ready' }
		]);
	});

	test('releases each addon when serialization throws on repeated attempts', async () => {
		const { serializer } = createSerializer();
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		const failure = new Error('Serialization failed');
		sandbox.stub(SerializeAddon.prototype, 'serialize').throws(failure);
		const disposalCounts = [];
		for (let index = 0; index < 3; index++) {
			await rejects(serializer.generateReplayEvent(), error => error === failure);
			disposalCounts.push(dispose.callCount);
		}
		deepStrictEqual(disposalCounts, [1, 2, 3]);
	});

	test('releases the addon when reusing a saved screen', async () => {
		const { serializer } = createSerializer('saved screen');
		const dispose = sandbox.spy(SerializeAddon.prototype, 'dispose');
		const serialize = sandbox.spy(SerializeAddon.prototype, 'serialize');
		const replay = await serializer.generateReplayEvent(true, true);
		deepStrictEqual({ disposed: dispose.callCount, serialized: serialize.callCount, screen: replay.events[0].data }, { disposed: 1, serialized: 0, screen: 'saved screen' });
	});
});

suite('PtyService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface ITestAllocation {
		pid: number;
		shouldPersistTerminal: boolean;
		processLaunchOptions: { options: { creationId: string | undefined; shellIntegration: { nonce: string } } };
		shellLaunchConfig: IShellLaunchConfig;
		getCwd(): Promise<string>;
		isOrphaned(): Promise<boolean>;
		attach(): Promise<void>;
		shutdown(immediate: boolean): void;
	}

	function ownershipFixture() {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		const contribution: AutoRepliesPtyServiceContribution = Reflect.get(service, '_autoRepliesContribution');
		const settings: ReadonlyMap<number, Readonly<Record<string, string | null>>> = Reflect.get(contribution, '_autoReplies');
		const shutdowns: number[] = [];
		function allocation(id: number, creationId: string | undefined, pid = 1234): ITestAllocation {
			let orphan = true;
			const process = {
				pid,
				shouldPersistTerminal: true,
				processLaunchOptions: { options: { creationId, shellIntegration: { nonce: 'nonce' } } },
				shellLaunchConfig: {},
				getCwd: async () => '/tmp',
				isOrphaned: async () => orphan,
				attach: async () => { orphan = false; },
				shutdown: () => { shutdowns.push(id); contribution.handleProcessDispose(id); ptys.delete(id); }
			};
			ptys.set(id, process);
			return process;
		}
		const ptys: Map<number, ITestAllocation> = Reflect.get(service, '_ptys');
		const revived: Map<string, { newId: number; creationId: string; state: { processLaunchConfig: { options: { creationId: string | undefined } } } }> = Reflect.get(service, '_revivedPtyIdMap');
		function remember(oldId: number, newId: number, source: string | undefined, creationId: string) {
			revived.set(`workspace-${oldId}`, { newId, creationId, state: { processLaunchConfig: { options: { creationId: source } } } });
		}
		async function verifyOwner(id: number, creationId: string) {
			await service.setAutoReplies(id, { prompt: 'updated owner' }, creationId);
			const replies = settings.get(id);
			await service.shutdown(id, true, creationId);
			deepStrictEqual({ replies, shutdowns: shutdowns.at(-1), present: ptys.has(id) }, { replies: { prompt: 'updated owner' }, shutdowns: id, present: false });
		}
		function cleanup() {
			for (const id of ptys.keys()) {
				contribution.handleProcessDispose(id);
			}
			ptys.clear();
			revived.clear();
		}
		return { service, allocation, remember, settings, shutdowns, verifyOwner, cleanup };
	}

	async function handoffReply(service: PtyService, expectedCreationId?: string): Promise<IProcessDetails | undefined> {
		const requests: { acceptReply(requestId: number, details: IProcessDetails | undefined): void } = Reflect.get(service, '_detachInstanceRequestStore');
		const sandbox = createSandbox();
		let result: IProcessDetails | undefined;
		const reply = sandbox.stub(requests, 'acceptReply').callsFake((_requestId, details) => { result = details; });
		try {
			await service.acceptDetachInstanceReply(7, 1, expectedCreationId);
			strictEqual(reply.calledOnceWithExactly(7, result), true);
			return result;
		} finally {
			sandbox.restore();
		}
	}

	for (const generation of ['source', undefined]) {
		test(`accepts a current ${generation === undefined ? 'legacy' : 'identified'} handoff source`, async () => {
			const f = ownershipFixture();
			f.allocation(1, generation);
			try {
				const details = await handoffReply(f.service, generation);
				deepStrictEqual(details && { id: details.id, creationId: details.creationId }, { id: 1, creationId: generation });
				await f.service.attachToProcess(details!.id, details!.pid, { prompt: 'recipient' }, 'recipient', details!.creationId);
				await f.verifyOwner(1, 'recipient');
			} finally {
				f.cleanup();
			}
		});
	}

	test('a delayed handoff reply does not acquire a later owner generation', async () => {
		const f = ownershipFixture();
		f.allocation(1, 'source');
		try {
			await f.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'peer', 'source');
			const details = await handoffReply(f.service, 'source');
			deepStrictEqual({ details, replies: f.settings.get(1) }, { details: undefined, replies: { prompt: 'peer' } });
			await f.verifyOwner(1, 'peer');
		} finally {
			f.cleanup();
		}
	});

	test('a handoff snapshot keeps its source generation across an intervening attachment', async () => {
		const f = ownershipFixture();
		const reading = new DeferredPromise<void>();
		const cwd = new DeferredPromise<string>();
		const process = f.allocation(1, 'source');
		process.getCwd = async () => { await reading.complete(); return cwd.p; };
		const reply = handoffReply(f.service, 'source');
		try {
			await reading.p;
			await f.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'peer', 'source');
			await cwd.complete('/tmp');
			const details = await reply;
			deepStrictEqual(details && { id: details.id, creationId: details.creationId }, { id: 1, creationId: 'source' });
			await rejects(f.service.attachToProcess(details!.id, details!.pid, { prompt: 'stale' }, 'stale', details!.creationId));
			deepStrictEqual(f.settings.get(1), { prompt: 'peer' });
			await f.verifyOwner(1, 'peer');
		} finally {
			await cwd.complete('/tmp');
			await reply;
			f.cleanup();
		}
	});

	test('revival publication retains its original generation across an intervening attachment', async () => {
		const f = ownershipFixture();
		const sandbox = createSandbox();
		const created = new DeferredPromise<string>();
		const completion = new DeferredPromise<number>();
		const state = upcastPartial<ISerializedTerminalState>({
			id: 2,
			shellLaunchConfig: {},
			unicodeVersion: '6',
			processDetails: upcastPartial<ISerializedTerminalState['processDetails']>({ cwd: '/tmp', workspaceId: 'workspace', workspaceName: 'test' }),
			processLaunchConfig: upcastPartial<ISerializedTerminalState['processLaunchConfig']>({ env: {}, options: {
				creationId: 'saved', shellIntegration: { enabled: false, suggestEnabled: false, nonce: 'saved nonce' }, windowsUseConptyDll: false,
				environmentVariableCollections: undefined, workspaceFolder: undefined, isScreenReaderOptimized: false
			} }),
			replayEvent: upcastPartial<ISerializedTerminalState['replayEvent']>({ events: [{ data: 'saved output', cols: 80, rows: 24 }] })
		});
		sandbox.stub(f.service, 'createProcess').callsFake(async (...args: Parameters<PtyService['createProcess']>) => {
			const generation = args[7].creationId!;
			f.allocation(1, generation);
			await created.complete(generation);
			return completion.p;
		});
		const reviving = f.service.reviveTerminalProcesses('workspace', [state], 'en-US');
		try {
			const generation = await created.p;
			await f.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'peer', generation);
			await completion.complete(1);
			await reviving;
			const identity = await f.service.getRevivedPtyProcessIdentity('workspace', 2, 'saved');
			deepStrictEqual({ identity, saved: state.processLaunchConfig.options.creationId }, { identity: { id: 1, creationId: generation }, saved: 'saved' });
			await rejects(f.service.attachToProcess(identity!.id, undefined, { prompt: 'stale' }, 'stale', identity!.creationId));
			await f.verifyOwner(1, 'peer');
		} finally {
			await completion.complete(1);
			await reviving;
			sandbox.restore();
			f.cleanup();
		}
	});

	for (const source of ['picker', 'panel', 'legacy panel'] as const) {
		test(`${source} retains the observed generation when attachment changes during CWD lookup`, async () => {
			const f = ownershipFixture();
			const cwd = new DeferredPromise<string>();
			const reading = new DeferredPromise<void>();
			const process = f.allocation(1, 'original');
			process.getCwd = async () => { await reading.complete(); return cwd.p; };
			await f.service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: [{ isActive: true, activePersistentProcessId: 1, terminals: [{ terminal: source === 'legacy panel' ? 1 : { id: 1, creationId: 'original' }, relativeSize: 1 }] }], background: null });
			const snapshot = source === 'picker'
				? f.service.listProcesses()
				: f.service.getTerminalLayoutInfo({ workspaceId: 'workspace' }).then(layout => layout?.tabs[0]?.terminals.map(t => t.terminal) ?? []);
			try {
				await reading.p;
				await f.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'peer', 'original');
				await cwd.complete('/tmp');
				const details = (await snapshot)[0]!;
				deepStrictEqual(details && { id: details.id, creationId: details.creationId, orphan: details.isOrphan }, { id: 1, creationId: 'original', orphan: true });
				await rejects(f.service.attachToProcess(details.id, details.pid, { prompt: 'stale' }, 'stale', details.creationId));
				deepStrictEqual(f.settings.get(1), { prompt: 'peer' });
				await f.verifyOwner(1, 'peer');
			} finally {
				await cwd.complete('/tmp');
				await snapshot;
				f.cleanup();
			}
		});
	}

	for (const oldId of [1, 2]) {
		test(`revival ${oldId} to 1 preserves the original allocation generation after attachment`, async () => {
			const f = ownershipFixture();
			f.allocation(1, 'revived');
			f.remember(oldId, 1, 'saved', 'revived');
			try {
				const initial = await f.service.getRevivedPtyProcessIdentity('workspace', oldId, 'saved');
				deepStrictEqual(initial, { id: 1, creationId: 'revived' });
				await f.service.attachToProcess(1, undefined, { prompt: 'peer' }, 'peer', initial!.creationId);
				const stale = await f.service.getRevivedPtyProcessIdentity('workspace', oldId, 'saved');
				deepStrictEqual(stale, initial);
				await rejects(f.service.attachToProcess(stale!.id, undefined, { prompt: 'stale' }, 'stale', stale!.creationId));
				deepStrictEqual(f.settings.get(1), { prompt: 'peer' });
				await f.verifyOwner(1, 'peer');
			} finally {
				f.cleanup();
			}
		});

		test(`live editor reload after revival ${oldId} to 1 uses its current saved generation`, async () => {
			const f = ownershipFixture();
			f.allocation(1, 'revived');
			f.remember(oldId, 1, 'saved', 'revived');
			try {
				await f.service.attachToProcess(1, undefined, { prompt: 'live' }, 'live', 'revived');
				deepStrictEqual(await f.service.getRevivedPtyProcessIdentity('workspace', 1, 'live'), undefined);
				await f.service.attachToProcess(1, 1234, { prompt: 'reloaded' }, 'reloaded', 'live');
				await rejects(f.service.attachToProcess(1, 1234, { prompt: 'stale live' }, 'stale', 'live'));
				await f.verifyOwner(1, 'reloaded');
			} finally {
				f.cleanup();
			}
		});
	}

	test('legacy revival never substitutes a later attachment generation', async () => {
		const f = ownershipFixture();
		f.allocation(1, 'revived');
		f.remember(2, 1, undefined, 'revived');
		try {
			deepStrictEqual(await f.service.getRevivedPtyProcessIdentity('workspace', 2), { id: 1, creationId: 'revived' });
			await f.service.attachToProcess(1, undefined, { prompt: 'peer' }, 'peer', 'revived');
			const stale = await f.service.getRevivedPtyProcessIdentity('workspace', 2);
			deepStrictEqual(stale, { id: 1, creationId: 'revived' });
			await rejects(f.service.attachToProcess(stale!.id, undefined, {}, 'stale', stale!.creationId));
			await f.verifyOwner(1, 'peer');
		} finally {
			f.cleanup();
		}
	});

	for (const background of [false, true]) {
		for (const claimed of [false, true]) {
			test(`retained ${claimed ? 'attached' : 'pending'} editor mapping does not rebase a live ${background ? 'background' : 'panel'} reference`, async () => {
				const f = ownershipFixture();
				f.allocation(1, 'revived');
				f.remember(2, 1, 'saved editor', 'revived');
				f.allocation(2, 'panel', 2222);
				try {
					await f.service.setAutoReplies(1, { prompt: 'editor' }, 'revived');
					if (claimed) {
						await f.service.attachToProcess(1, undefined, { prompt: 'editor' }, 'editor', 'revived');
					}
					const reference = { id: 2, creationId: 'panel' };
					await f.service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: background ? [] : [{ isActive: true, activePersistentProcessId: 2, terminals: [{ terminal: reference, relativeSize: 1 }] }], background: background ? [reference] : null });
					const layout = await f.service.getTerminalLayoutInfo({ workspaceId: 'workspace' });
					const detail = background ? layout?.background?.[0] : layout?.tabs[0].terminals[0].terminal;
					deepStrictEqual({ id: detail?.id, creationId: detail?.creationId, pid: detail?.pid }, { id: 2, creationId: 'panel', pid: 2222 });
					await f.service.attachToProcess(detail!.id, detail!.pid, { prompt: 'new panel' }, 'new panel', detail!.creationId);
					deepStrictEqual(f.settings.get(1), { prompt: 'editor' });
					const editor = await f.service.getRevivedPtyProcessIdentity('workspace', 2, 'saved editor');
					deepStrictEqual(editor, { id: 1, creationId: 'revived' });
					const attachment = f.service.attachToProcess(editor!.id, undefined, { prompt: 'editor' }, 'editor', editor!.creationId);
					if (claimed) {
						await rejects(attachment);
					} else {
						await attachment;
					}
					await f.verifyOwner(1, 'editor');
					await f.verifyOwner(2, 'new panel');
				} finally {
					f.cleanup();
				}
			});
		}
	}

	for (const background of [false, true]) {
		test(`saved ${background ? 'background' : 'panel'} generation cannot acquire a later live attachment`, async () => {
			const f = ownershipFixture();
			f.allocation(1, 'original');
			try {
				const reference = { id: 1, creationId: 'original' };
				await f.service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: background ? [] : [{ isActive: true, activePersistentProcessId: 1, terminals: [{ terminal: reference, relativeSize: 1 }] }], background: background ? [reference] : null });
				await f.service.attachToProcess(1, 1234, { prompt: 'peer' }, 'peer', 'original');
				deepStrictEqual(await f.service.getTerminalLayoutInfo({ workspaceId: 'workspace' }), { tabs: [], background: [] });
				deepStrictEqual(f.settings.get(1), { prompt: 'peer' });
				await f.verifyOwner(1, 'peer');
			} finally {
				f.cleanup();
			}
		});
	}

	for (const legacy of [false, true]) {
		test(`original ${legacy ? 'numeric legacy' : 'identified'} panel state resolves its revived allocation`, async () => {
			const f = ownershipFixture();
			f.allocation(1, 'revived');
			f.remember(2, 1, 'saved panel', 'revived');
			try {
				await f.service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: [{ isActive: true, activePersistentProcessId: 2, terminals: [{ terminal: legacy ? 2 : { id: 2, creationId: 'saved panel' }, relativeSize: 1 }] }], background: null });
				const detail = (await f.service.getTerminalLayoutInfo({ workspaceId: 'workspace' }))?.tabs[0].terminals[0].terminal;
				deepStrictEqual({ id: detail?.id, creationId: detail?.creationId, orphan: detail?.isOrphan }, { id: 1, creationId: 'revived', orphan: true });
				await f.service.attachToProcess(detail!.id, undefined, { prompt: 'panel' }, 'panel', detail!.creationId);
				await f.verifyOwner(1, 'panel');
			} finally {
				f.cleanup();
			}
		});
	}

	test('stale saved layout cannot acquire an already attached revived editor', async () => {
		const f = ownershipFixture();
		f.allocation(1, 'revived');
		f.remember(2, 1, 'saved', 'revived');
		try {
			await f.service.attachToProcess(1, undefined, { prompt: 'peer' }, 'peer', 'revived');
			await f.service.setTerminalLayoutInfo({ workspaceId: 'workspace', tabs: [{ isActive: true, activePersistentProcessId: 2, terminals: [{ terminal: { id: 2, creationId: 'saved' }, relativeSize: 1 }] }], background: null });
			deepStrictEqual(await f.service.getTerminalLayoutInfo({ workspaceId: 'workspace' }), { tabs: [], background: [] });
			deepStrictEqual(f.settings.get(1), { prompt: 'peer' });
			await f.verifyOwner(1, 'peer');
		} finally {
			f.cleanup();
		}
	});

	test('shutdown rejects a stale allocation identity and preserves legacy callers', async () => {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		const shutdowns: boolean[] = [];
		const allocations: Map<number, { processLaunchOptions: { options: { creationId: string } }; shutdown(immediate: boolean): void }> = Reflect.get(service, '_ptys');
		allocations.set(1, { processLaunchOptions: { options: { creationId: 'new allocation' } }, shutdown: immediate => shutdowns.push(immediate) });
		try {
			await service.shutdown(1, true, 'old allocation');
			deepStrictEqual(shutdowns, []);
			await service.shutdown(1, true, 'new allocation');
			deepStrictEqual(shutdowns, [true]);
			await service.shutdown(1, false);
			await service.shutdown(2, true, 'new allocation');
			deepStrictEqual(shutdowns, [true, false]);
		} finally {
			allocations.clear();
		}
	});

	test('rejected attachment preserves peer replies and accepted attachment replaces them before replay', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		const data = store.add(new Emitter<string>());
		const replies: string[] = [];
		const process = new class extends mock<ITerminalChildProcess>() {
			override readonly onProcessData = data.event;
			override input(value: string): void { replies.push(value); }
		};
		const contribution: AutoRepliesPtyServiceContribution = Reflect.get(service, '_autoRepliesContribution');
		const ptys: Map<number, { pid: number; processLaunchOptions: { options: { creationId: string } }; attach(): Promise<void>; shutdown(): void }> = Reflect.get(service, '_ptys');
		let attaches = 0;
		const allocation = { pid: 1234, processLaunchOptions: { options: { creationId: 'owner' } }, attach: async () => { attaches++; data.fire('prompt'); }, shutdown: () => { } };
		ptys.set(1, allocation);
		contribution.handleProcessReady(1, process);
		try {
			await service.setAutoReplies(1, { prompt: 'live owner' }, 'owner');
			await rejects(service.attachToProcess(1, 4321, { prompt: 'restoring window' }, 'restoring', 'owner'));
			deepStrictEqual(allocation.processLaunchOptions.options.creationId, 'owner');
			data.fire('prompt');
			deepStrictEqual({ attaches, replies }, { attaches: 0, replies: ['live owner'] });
			await service.attachToProcess(1, 1234, { prompt: 'restoring window' }, 'restoring', 'owner');
			deepStrictEqual(allocation.processLaunchOptions.options.creationId, 'restoring', 'owner');
			await service.setAutoReplies(1, {}, 'owner');
			const settings: ReadonlyMap<number, Readonly<Record<string, string | null>>> = Reflect.get(contribution, '_autoReplies');
			deepStrictEqual(settings.get(1), { prompt: 'restoring window' });
			deepStrictEqual({ attaches, replies }, { attaches: 1, replies: ['live owner', 'restoring window'] });
		} finally {
			contribution.handleProcessDispose(1);
			await timeout(1100);
		}
	}));

	test('attachToProcess only attaches when the expected pid matches', async () => {
		const service = store.add(new PtyService(new NullLogService(), upcastPartial<IProductService>({}), { graceTime: 60000, shortGraceTime: 6000, scrollback: 100 }, 0));
		let attachCount = 0;
		// Stand in for a running persistent process to avoid spawning a pty
		const ptys: Map<number, { pid: number; processLaunchOptions: { options: { creationId?: string } }; attach(): Promise<void>; shutdown(): void }> = Reflect.get(service, '_ptys');
		ptys.set(1, { pid: 1234, processLaunchOptions: { options: {} }, attach: async () => { attachCount++; }, shutdown: () => { } });

		async function attach(pid?: number): Promise<string> {
			try {
				await service.attachToProcess(1, pid);
				return 'attached';
			} catch {
				return 'rejected';
			}
		}
		const results = { otherPid: await attach(4321), samePid: await attach(1234), noPid: await attach() };

		deepStrictEqual({ ...results, attachCount }, { otherPid: 'rejected', samePid: 'attached', noPid: 'attached', attachCount: 2 });
	});
});
