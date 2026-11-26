/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../common/event.js';
import { SharedResourceMap } from '../../common/sharedResourceMap.js';
import { URI } from '../../common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';

suite('SharedResourceMap', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		const created: { key: string }[] = [];
		const destroyed: { key: string }[] = [];
		const map = store.add(new SharedResourceMap<string, { key: string }, number | undefined>(key => {
			const object = { key };
			created.push(object);
			return object;
		}, (_key, object) => destroyed.push(object)));
		return { map, created, destroyed };
	}

	test('independent handles share one object until the final release', () => {
		const { map, created, destroyed } = setup();
		const first = map.acquire('resource', 1);
		const second = map.acquire('resource', 2);
		assert.strictEqual(first.object, second.object);
		assert.strictEqual(created.length, 1);
		first.dispose();
		first.dispose();
		assert.ok(first.isDisposed);
		assert.ok(map.has('resource'));
		assert.ok(!map.hasOwner('resource', 1));
		assert.ok(map.hasOwner('resource', 2));
		assert.strictEqual(destroyed.length, 0);
		second.dispose();
		assert.ok(!map.has('resource'));
		assert.deepStrictEqual(destroyed, created);
	});

	test('releasing an owner releases all its handles across keys', () => {
		const { map, destroyed } = setup();
		const first = map.acquire('shared', 1);
		const repeated = map.acquire('shared', 1);
		map.acquire('private', 1);
		const global = map.acquire('shared', undefined);
		map.releaseOwner(1);
		assert.ok(first.isDisposed && repeated.isDisposed);
		assert.ok(!global.isDisposed);
		assert.deepStrictEqual(destroyed, [{ key: 'private' }]);
		assert.ok(map.hasOwner('shared', undefined));
		map.releaseOwner(undefined);
		assert.strictEqual(destroyed.length, 2);
	});

	test('keys can be compared by URI value', () => {
		const map = store.add(new SharedResourceMap<URI, object, number>(() => ({}), () => { }, key => key.toString()));
		const first = map.acquire(URI.file('/logs/shared.log'), 1);
		const second = map.acquire(URI.file('/logs/shared.log'), 2);
		assert.strictEqual(first.object, second.object);
		assert.ok(map.hasOwner(URI.file('/logs/shared.log'), 2));
	});

	test('destruction can acquire a replacement and stale releases leave it open', () => {
		let replacement: object | undefined;
		let destroyCount = 0;
		const map = store.add(new SharedResourceMap<string, object, number>(() => ({}), key => {
			if (++destroyCount === 1) {
				replacement = map.acquire(key, 2).object;
			}
		}));
		const original = map.acquire('resource', 1);
		original.dispose();
		assert.notStrictEqual(original.object, replacement);
		original.dispose();
		assert.ok(map.hasOwner('resource', 2));
		map.releaseOwner(2);
		assert.strictEqual(destroyCount, 2);
	});

	test('owner cleanup leaves references acquired during cleanup open', () => {
		const { map, destroyed } = setup();
		const first = map.acquire('resource', 1);
		store.add(Event.once(first.onDidDispose)(() => map.acquire('resource', 1)));
		map.releaseOwner(1);
		assert.ok(map.hasOwner('resource', 1));
		assert.strictEqual(destroyed.length, 1);
		map.releaseOwner(1);
		assert.strictEqual(destroyed.length, 2);
	});

	test('failed creation does not leave an entry', () => {
		let fail = true;
		const map = store.add(new SharedResourceMap<string, object, number>(() => {
			if (fail) {
				throw new Error('creation failed');
			}
			return {};
		}, () => { }));
		assert.throws(() => map.acquire('resource', 1), /creation failed/);
		assert.ok(!map.has('resource'));
		fail = false;
		assert.ok(map.acquire('resource', 1).object);
	});

	test('destruction errors still release other resources and notify handles', () => {
		const destroyed: string[] = [];
		const map = store.add(new SharedResourceMap<string, object, number>(() => ({}), key => {
			destroyed.push(key);
			if (key === 'failing') {
				throw new Error('destruction failed');
			}
		}));
		const first = map.acquire('failing', 1);
		const second = map.acquire('other', 1);
		let released = false;
		store.add(Event.once(first.onDidDispose)(() => released = true));
		assert.throws(() => map.releaseOwner(1), /destruction failed/);
		assert.ok(first.isDisposed && second.isDisposed && released);
		assert.deepStrictEqual(destroyed, ['failing', 'other']);
		assert.ok(!map.has('failing') && !map.has('other'));
	});

	test('map disposal closes all objects and rejects new acquisitions', () => {
		const { map, created, destroyed } = setup();
		const first = map.acquire('shared', 1);
		const second = map.acquire('shared', 2);
		map.acquire('other', 3);
		map.dispose();
		assert.ok(first.isDisposed && second.isDisposed);
		assert.deepStrictEqual(destroyed, created);
		assert.throws(() => map.acquire('new', 1), /after disposal/);
		map.dispose();
		assert.strictEqual(destroyed.length, 2);
	});

	test('force deletion releases all old handles without removing a replacement', () => {
		const { map, destroyed } = setup();
		const first = map.acquire('resource', 1);
		const second = map.acquire('resource', 2);
		store.add(Event.once(first.onDidDispose)(() => map.acquire('resource', 3)));
		map.delete('resource');
		assert.ok(first.isDisposed && second.isDisposed);
		assert.ok(map.hasOwner('resource', 3));
		assert.strictEqual(destroyed.length, 1);
		first.dispose();
		second.dispose();
		assert.strictEqual(destroyed.length, 1);
	});

});
