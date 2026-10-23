/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AuthenticationSession, IAuthenticationExtensionsService, IAuthenticationProvider, IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { Dto, Proxied } from '../../../services/extensions/common/proxyIdentifier.js';
import { MainThreadAuthentication, reviveAuthenticationSession } from '../../browser/mainThreadAuthentication.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, isDisposable } from '../../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IDynamicAuthenticationProviderStorageService } from '../../../services/authentication/common/dynamicAuthenticationProviderStorage.js';
import { ExtHostAuthenticationShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadAuthentication', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const session: Dto<AuthenticationSession> = { id: 'session', accessToken: 'test-token', scopes: ['scope'], account: { id: 'account', label: 'Account' } };

	async function createProvider(getSessions: Proxied<ExtHostAuthenticationShape>['$getSessions'], overrides: Partial<Proxied<ExtHostAuthenticationShape>> = {}) {
		const instantiation = store.add(new TestInstantiationService());
		let provider: IAuthenticationProvider | undefined;
		instantiation.stub(IAuthenticationService, {
			onDidChangeSessions: Event.None,
			onDidUnregisterAuthenticationProvider: Event.None,
			registerAuthenticationProviderHostDelegate: () => Disposable.None,
			declaredProviders: [{ id: 'test', label: 'Test' }],
			registerAuthenticationProvider: (_id, value) => {
				provider = value;
				if (isDisposable(value)) { store.add(value); }
			}
		});
		instantiation.stub(IAuthenticationExtensionsService, { onDidChangeAccountPreference: Event.None });
		instantiation.stub(IDynamicAuthenticationProviderStorageService, { onDidChangeTokens: Event.None });
		const main = store.add(instantiation.createInstance(MainThreadAuthentication, SingleProxyRPCProtocol({
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
});
