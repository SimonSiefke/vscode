/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { AuthenticationAccessService } from '../../../services/authentication/browser/authenticationAccessService.js';
import { AuthenticationService } from '../../../services/authentication/browser/authenticationService.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { RPCProtocol } from '../../../services/extensions/common/rpcProtocol.js';
import { ExtensionHostKind } from '../../../services/extensions/common/extensionHostKind.js';
import { TestEnvironmentService } from '../../../test/browser/workbenchTestServices.js';
import { TestExtensionService, TestProductService, TestStorageService } from '../../../test/common/workbenchTestServices.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ExtHostAuthenticationShape, ExtHostContext, MainContext, MainThreadAuthenticationShape } from '../../common/extHost.protocol.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AuthenticationSession, IAuthenticationExtensionsService, IAuthenticationProvider, IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { Dto, Proxied } from '../../../services/extensions/common/proxyIdentifier.js';
import { MainThreadAuthentication, reviveAuthenticationSession } from '../../browser/mainThreadAuthentication.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Disposable, isDisposable } from '../../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IDynamicAuthenticationProviderStorageService } from '../../../services/authentication/common/dynamicAuthenticationProviderStorage.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadAuthentication', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const session: Dto<AuthenticationSession> = { id: 'session', accessToken: 'test-token', scopes: ['scope'], account: { id: 'account', label: 'Account' } };

	async function createProvider(getSessions: Proxied<ExtHostAuthenticationShape>['$getSessions'], overrides: Partial<Proxied<ExtHostAuthenticationShape>> = {}) {
		const instantiation = disposables.add(new TestInstantiationService());
		let provider: IAuthenticationProvider | undefined;
		instantiation.stub(IAuthenticationService, {
			onDidChangeSessions: Event.None,
			onDidUnregisterAuthenticationProvider: Event.None,
			registerAuthenticationProviderHostDelegate: () => Disposable.None,
			declaredProviders: [{ id: 'test', label: 'Test' }],
			registerAuthenticationProvider: (_id, value) => {
				provider = value;
				if (isDisposable(value)) { disposables.add(value); }
			},
			unregisterAuthenticationProvider: () => { }
		});
		instantiation.stub(IAuthenticationExtensionsService, { onDidChangeAccountPreference: Event.None });
		instantiation.stub(IDynamicAuthenticationProviderStorageService, { onDidChangeTokens: Event.None });
		const main = disposables.add(instantiation.createInstance(MainThreadAuthentication, SingleProxyRPCProtocol({
			$getSessions: getSessions,
			$createSession: async () => session,
			$removeSession: async () => { },
			$createSessionFromChallenges: async () => session,
			...overrides
		})));
		await main.$registerAuthenticationProvider({ id: 'test', label: 'Test', supportsMultipleAccounts: true, supportsChallenges: true });
		assert.ok(provider);
		return { main, provider };
	}

	test('concurrent identical session reads share one RPC without caching completed results', async () => {
		const gate = new DeferredPromise<readonly Dto<AuthenticationSession>[]>();
		let calls = 0;
		const { provider } = await createProvider(() => { calls++; return gate.p; });
		const pending = Array.from({ length: 64 }, () => provider.getSessions(['scope'], { silent: true }));
		const beforeRelease = calls;
		gate.complete([session]);
		const results = await Promise.all(pending);
		await provider.getSessions(['scope'], { silent: true });
		assert.deepStrictEqual({ beforeRelease, afterCompletion: calls, results }, {
			beforeRelease: 1,
			afterCompletion: 2,
			results: Array.from({ length: 64 }, () => [reviveAuthenticationSession(session)])
		});
		assert.notStrictEqual(results[0], results[1]);
		assert.notStrictEqual(results[0][0].account, results[1][0].account);
	});

	test('session reads with different scopes or provider options remain independent', async () => {
		const gate = new DeferredPromise<readonly Dto<AuthenticationSession>[]>();
		let calls = 0;
		const { provider } = await createProvider(() => { calls++; return gate.p; });
		const pending = [
			provider.getSessions(['one'], { silent: true }),
			provider.getSessions(['two'], { silent: true }),
			provider.getSessions(['one'], { silent: false }),
			provider.getSessions(['one'], { silent: true, clientId: 'another-client' }),
			provider.getSessions(undefined, { silent: true }),
			provider.getSessions(['one'], { account: { id: 'one', label: 'One' } }),
			provider.getSessions(['one'], { account: { id: 'two', label: 'Two' } }),
			provider.getSessions(['one'], { authorizationServer: URI.parse('https://one.example.com') }),
			provider.getSessions(['one'], { authorizationServer: URI.parse('https://two.example.com') })
		];
		gate.complete([]);
		await Promise.all(pending);
		assert.strictEqual(calls, 9);
	});

	test('failed shared session reads are evicted before the next request', async () => {
		const gate = new DeferredPromise<readonly Dto<AuthenticationSession>[]>();
		let calls = 0;
		const { provider } = await createProvider(() => ++calls === 1 ? gate.p : Promise.resolve([session]));
		const first = provider.getSessions(['scope'], {});
		const second = provider.getSessions(['scope'], {});
		const rejected = Promise.all([assert.rejects(first, /session failure/), assert.rejects(second, /session failure/)]);
		gate.error(new Error('session failure'));
		await rejected;
		assert.deepStrictEqual([calls, await provider.getSessions(['scope'], {}), calls], [1, [reviveAuthenticationSession(session)], 2]);
	});

	test('session changes invalidate pending reads and old completion cannot evict a newer read', async () => {
		const gates = [new DeferredPromise<readonly Dto<AuthenticationSession>[]>(), new DeferredPromise<readonly Dto<AuthenticationSession>[]>()];
		let calls = 0;
		const { main, provider } = await createProvider(() => gates[Math.min(calls++, gates.length - 1)].p);
		const first = provider.getSessions(['scope'], {});
		await main.$sendDidChangeSessions('test', { added: [], removed: [], changed: [] });
		const second = provider.getSessions(['scope'], {});
		gates[0].complete([]);
		await first;
		const third = provider.getSessions(['scope'], {});
		gates[1].complete([session]);
		const results = await Promise.all([second, third]);
		assert.deepStrictEqual([calls, results], [2, [[reviveAuthenticationSession(session)], [reviveAuthenticationSession(session)]]]);
	});

	test('creating or removing sessions invalidates reads before the mutation finishes', async () => {
		const reads: DeferredPromise<readonly Dto<AuthenticationSession>[]>[] = [];
		const creation = new DeferredPromise<Dto<AuthenticationSession>>();
		const { provider } = await createProvider(() => {
			const read = new DeferredPromise<readonly Dto<AuthenticationSession>[]>();
			reads.push(read);
			return read.p;
		}, { $createSession: () => creation.p });
		const first = provider.getSessions(['scope'], {});
		const create = provider.createSession(['scope'], {});
		const second = provider.getSessions(['scope'], {});
		const remove = provider.removeSession('session');
		const third = provider.getSessions(['scope'], {});
		assert.ok(provider.createSessionFromChallenges);
		const challenge = provider.createSessionFromChallenges({ challenges: [] }, {});
		const fourth = provider.getSessions(['scope'], {});
		for (const read of reads) { read.complete([session]); }
		creation.complete(session);
		await Promise.all([first, create, second, remove, third, challenge, fourth]);
		assert.strictEqual(reads.length, 4);
	});

	test('an invalidation during the RPC call cannot install an obsolete shared read', async () => {
		const gates = [new DeferredPromise<readonly Dto<AuthenticationSession>[]>(), new DeferredPromise<readonly Dto<AuthenticationSession>[]>()];
		let calls = 0;
		const setup = await createProvider(() => {
			const index = calls++;
			if (index === 0) { void setup.main.$sendDidChangeSessions('test', { added: [], removed: [], changed: [] }); }
			return gates[Math.min(index, gates.length - 1)].p;
		});
		const first = setup.provider.getSessions(['scope'], {});
		const second = setup.provider.getSessions(['scope'], {});
		const beforeRelease = calls;
		gates[0].complete([]);
		await first;
		const third = setup.provider.getSessions(['scope'], {});
		gates[1].complete([session]);
		const results = await Promise.all([second, third]);
		assert.deepStrictEqual([beforeRelease, calls, results], [2, 2, [[reviveAuthenticationSession(session)], [reviveAuthenticationSession(session)]]]);
	});

	const iconComponents: UriComponents = { scheme: 'https', authority: 'example.com', path: '/avatar.png', query: '', fragment: '' };

	test('revives session URIs and preserves optional session fields', () => {
		const authorizationServer = URI.parse('https://enterprise.example.com/login/oauth');
		const withIcon: Dto<AuthenticationSession> = {
			id: 'session-with-icon',
			accessToken: 'token',
			scopes: ['scope'],
			account: { id: 'account-with-icon', label: 'Has Icon', icon: iconComponents },
			authorizationServer: authorizationServer.toJSON(),
			idToken: 'id-token',
			expiresAfter: 3600
		};
		const withoutIcon: Dto<AuthenticationSession> = {
			id: 'session-without-icon',
			accessToken: 'token',
			scopes: ['scope'],
			account: { id: 'account-without-icon', label: 'No Icon' }
		};

		assert.deepStrictEqual(
			[reviveAuthenticationSession(withIcon), reviveAuthenticationSession(withoutIcon)],
			[
				{ ...withIcon, account: { ...withIcon.account, icon: URI.from(iconComponents) }, authorizationServer },
				{ ...withoutIcon, account: { ...withoutIcon.account, icon: undefined }, authorizationServer: undefined }
			]
		);
	});

	suite('provider lifecycle', () => {
		const authorizationServer = URI.parse('https://auth.example.com');
		const resourceServer = URI.parse('https://mcp.example.com');
		let authenticationService: AuthenticationService;

		setup(() => {
			const storageService = disposables.add(new TestStorageService());
			const accessService = disposables.add(new AuthenticationAccessService(storageService, TestProductService));
			authenticationService = disposables.add(new AuthenticationService(new TestExtensionService(), accessService, TestEnvironmentService, new NullLogService()));
		});

		function createHost(sessionId: string, rpc?: RPCProtocol) {
			const unregistered: string[] = [];
			let clientRegistrationWrites = 0;
			let stopped = false;
			const proxy = upcastPartial<Proxied<ExtHostAuthenticationShape>>({
				$onDidChangeAuthenticationSessions: async () => { },
				$onDidUnregisterAuthenticationProvider: async id => { unregistered.push(id); },
				$getSessions: async () => {
					assert.strictEqual(stopped, false, 'must not use the stopped extension host');
					return [{ id: sessionId, accessToken: 'test-token', scopes: [], account: { id: 'account', label: 'Account' } }];
				}
			});
			const context = upcastPartial<IExtHostContext>({
				getProxy: rpc ? identifier => rpc.getProxy(identifier) : <T>() => proxy as unknown as Proxied<T>,
				extensionHostKind: ExtensionHostKind.LocalProcess
			});
			const dynamicStorage = upcastPartial<IDynamicAuthenticationProviderStorageService>({
				onDidChangeTokens: Event.None,
				storeClientRegistration: async () => { clientRegistrationWrites++; }
			});
			const mainThread = disposables.add(new MainThreadAuthentication(
				context, TestProductService, authenticationService,
				upcastPartial<IAuthenticationExtensionsService>({ onDidChangeAccountPreference: Event.None }),
				undefined!, undefined!, undefined!, undefined!, undefined!,
				upcastPartial<ITelemetryService>({ publicLog2: () => { } }), undefined!, new NullLogService(), undefined!,
				dynamicStorage, undefined!, undefined!, undefined!, undefined!
			));
			return {
				mainThread, unregistered,
				get clientRegistrationWrites() { return clientRegistrationWrites; },
				stop: () => { stopped = true; mainThread.dispose(); }
			};
		}

		function registerDynamicProvider(host: { mainThread: Pick<MainThreadAuthenticationShape, '$registerDynamicAuthenticationProvider'> }) {
			return host.mainThread.$registerDynamicAuthenticationProvider({
				id: 'dynamic-provider', label: 'dynamic-provider', supportsMultipleAccounts: true, clientId: 'test-client',
				authorizationServer: authorizationServer.toJSON(), resourceServer: resourceServer.toJSON()
			});
		}

		test('removes host-owned dynamic providers without changing persisted registration', async () => {
			const host = createHost('first-host');
			await registerDynamicProvider(host);
			assert.strictEqual(await authenticationService.getOrActivateProviderIdForServer(authorizationServer, resourceServer), 'dynamic-provider');
			host.stop();
			assert.strictEqual(authenticationService.isAuthenticationProviderRegistered('dynamic-provider'), false);
			assert.strictEqual(await authenticationService.getOrActivateProviderIdForServer(authorizationServer, resourceServer), undefined);
			assert.strictEqual(host.clientRegistrationWrites, 1);
			assert.deepStrictEqual(host.unregistered, []);
		});

		test('does not echo explicit provider unregistration to its owning host', async () => {
			const host = createHost('first-host');
			await registerDynamicProvider(host);
			await host.mainThread.$unregisterAuthenticationProvider('dynamic-provider');
			assert.strictEqual(authenticationService.isAuthenticationProviderRegistered('dynamic-provider'), false);
			assert.strictEqual(host.clientRegistrationWrites, 1);
			assert.deepStrictEqual(host.unregistered, []);
			host.stop();
			assert.deepStrictEqual(host.unregistered, []);
		});

		test('releases a registration when the provider is unregistered externally', async () => {
			const firstHost = createHost('first-host');
			await registerDynamicProvider(firstHost);
			authenticationService.unregisterAuthenticationProvider('dynamic-provider');
			assert.deepStrictEqual(firstHost.unregistered, ['dynamic-provider']);

			const secondHost = createHost('second-host');
			await registerDynamicProvider(secondHost);
			firstHost.stop();
			assert.deepStrictEqual(firstHost.unregistered, ['dynamic-provider']);
			assert.deepStrictEqual(secondHost.unregistered, []);
			const sessions = await authenticationService.getSessions('dynamic-provider');
			assert.strictEqual(sessions[0].id, 'second-host');
		});

		test('notifies other hosts when the owning host stops', async () => {
			const firstHost = createHost('first-host');
			const secondHost = createHost('second-host');
			await registerDynamicProvider(firstHost);
			firstHost.stop();
			assert.deepStrictEqual(firstHost.unregistered, []);
			assert.deepStrictEqual(secondHost.unregistered, ['dynamic-provider']);
		});

		test('rediscovers dynamic providers after RPC and customer disposal', async () => {
			function createRpcHost(sessionId: string) {
				const mainMessages = disposables.add(new Emitter<VSBuffer>());
				const extHostMessages = disposables.add(new Emitter<VSBuffer>());
				const mainRpc = disposables.add(new RPCProtocol({
					onMessage: mainMessages.event,
					send: message => { queueMicrotask(() => extHostMessages.fire(message)); }
				}));
				const extHostRpc = disposables.add(new RPCProtocol({
					onMessage: extHostMessages.event,
					send: message => { queueMicrotask(() => mainMessages.fire(message)); }
				}));
				const host = createHost(sessionId, mainRpc);
				mainRpc.set(MainContext.MainThreadAuthentication, host.mainThread);
				extHostRpc.set(ExtHostContext.ExtHostAuthentication, upcastPartial<ExtHostAuthenticationShape>({
					$getSessions: async () => [{ id: sessionId, accessToken: 'test-token', scopes: [], account: { id: 'account', label: 'Account' } }]
				}));
				return {
					mainThread: extHostRpc.getProxy(MainContext.MainThreadAuthentication),
					stop: () => {
						// Model ExtensionHostManager.dispose(): close RPC before disposing customers.
						mainRpc.dispose();
						host.stop();
						extHostRpc.dispose();
					}
				};
			}

			const first = createRpcHost('first-host');
			await registerDynamicProvider(first);
			const oldProvider = authenticationService.getProvider('dynamic-provider');
			assert.strictEqual((await authenticationService.getSessions('dynamic-provider'))[0].id, 'first-host');

			first.stop();
			// This is RPCProtocol's real cancellation, not a stopped-host test stub.
			await assert.rejects(oldProvider.getSessions(undefined, {}), isCancellationError);
			assert.strictEqual(await authenticationService.getOrActivateProviderIdForServer(authorizationServer, resourceServer), undefined);

			const second = createRpcHost('second-host');
			await registerDynamicProvider(second);
			assert.strictEqual((await authenticationService.getSessions('dynamic-provider'))[0].id, 'second-host');
			second.stop();
		});
	});

});
