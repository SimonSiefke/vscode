/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { MainThreadQuickOpenShape } from '../../common/extHost.protocol.js';
import { ExtHostCommands } from '../../common/extHostCommands.js';
import { createExtHostQuickOpen } from '../../common/extHostQuickOpen.js';
import { IExtHostWorkspaceProvider } from '../../common/extHostWorkspace.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('Extension host quick input callback lifetime', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function createService() {
		const picks: DeferredPromise<number | number[] | undefined>[] = [];
		const inputs: DeferredPromise<string | undefined>[] = [];
		const errors: Error[] = [];
		const proxy = new class extends mock<MainThreadQuickOpenShape>() {
			override $show(...args: Parameters<MainThreadQuickOpenShape['$show']>): Promise<number | number[] | undefined> {
				if (args[2].isCancellationRequested) {
					return Promise.reject(new CancellationError());
				}
				const result = new DeferredPromise<number | number[] | undefined>();
				picks.push(result);
				return result.p;
			}
			override $input(...args: Parameters<MainThreadQuickOpenShape['$input']>): Promise<string | undefined> {
				if (args[2].isCancellationRequested) {
					return Promise.reject(new CancellationError());
				}
				const result = new DeferredPromise<string | undefined>();
				inputs.push(result);
				return result.p;
			}
			override $setItems(): Promise<void> { return Promise.resolve(); }
			override $setError(_instance: number, error: Error): Promise<void> {
				errors.push(error);
				return Promise.resolve();
			}
		};
		const service = createExtHostQuickOpen(SingleProxyRPCProtocol(proxy), new class extends mock<IExtHostWorkspaceProvider>() { }, new class extends mock<ExtHostCommands>() { });
		const observe = () => ({
			selection: typeof Reflect.get(service, '_onDidSelectItem') === 'function',
			validation: typeof Reflect.get(service, '_validateInput') === 'function'
		});
		return { service, picks, inputs, errors, observe };
	}

	for (const completion of ['accept', 'dismiss', 'cancel', 'error'] as const) {
		test(`Quick Pick releases its callback after ${completion}`, async () => {
			const { service, picks, errors, observe } = createService();
			const items = [{ label: 'first' }, { label: 'second' }];
			const selected: (string | vscode.QuickPickItem)[] = [];
			const result = service.showQuickPick(nullExtensionDescription, items, { onDidSelectItem: item => selected.push(item) });
			await timeout(0);
			service.$onItemSelected(1);
			assert.deepStrictEqual(selected, [items[1]]);
			assert.deepStrictEqual(observe(), { selection: true, validation: false });
			const error = completion === 'cancel' ? new CancellationError() : new Error('Owned picker error');
			const expected = completion === 'error' ? assert.rejects(result, error) : result;
			if (completion === 'cancel' || completion === 'error') {
				await picks[0].error(error);
			} else {
				await picks[0].complete(completion === 'accept' ? 0 : undefined);
			}
			assert.strictEqual(await expected, completion === 'accept' ? items[0] : undefined);
			assert.deepStrictEqual(errors, completion === 'error' ? [error] : []);
			service.$onItemSelected(0);
			assert.deepStrictEqual({ ...observe(), selected }, { selection: false, validation: false, selected: [items[1]] });
		});

		test(`Input Box releases its validator after ${completion}`, async () => {
			const { service, inputs, observe } = createService();
			const validated: string[] = [];
			const result = service.showInput({ validateInput: value => { validated.push(value); return 'validation'; } });
			assert.strictEqual(await service.$validateInput('active'), 'validation');
			const error = completion === 'cancel' ? new CancellationError() : new Error('Owned input error');
			const expected = completion === 'error' ? assert.rejects(result, error) : result;
			if (completion === 'cancel' || completion === 'error') {
				await inputs[0].error(error);
			} else {
				await inputs[0].complete(completion === 'accept' ? 'accepted' : undefined);
			}
			assert.strictEqual(await expected, completion === 'accept' ? 'accepted' : undefined);
			assert.strictEqual(await service.$validateInput('closed'), undefined);
			assert.deepStrictEqual({ ...observe(), validated }, { selection: false, validation: false, validated: ['active'] });
		});
	}

	test('Settling an earlier Quick Pick preserves the replacement callback', async () => {
		const { service, picks, observe } = createService();
		const selected: (string | vscode.QuickPickItem)[] = [];
		const first = service.showQuickPick(nullExtensionDescription, [{ label: 'old' }], { onDidSelectItem: item => selected.push(item) });
		await timeout(0);
		const second = service.showQuickPick(nullExtensionDescription, [{ label: 'new' }], { onDidSelectItem: item => selected.push(item) });
		await timeout(0);
		await picks[0].complete(undefined);
		await first;
		service.$onItemSelected(0);
		assert.deepStrictEqual({ ...observe(), selected }, { selection: true, validation: false, selected: [{ label: 'new' }] });
		await picks[1].complete(0);
		assert.deepStrictEqual(await second, { label: 'new' });
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('Settling an earlier Input Box preserves a reused validation function', async () => {
		const { service, inputs, observe } = createService();
		const validateInput = (value: string) => value;
		const first = service.showInput({ validateInput });
		const second = service.showInput({ validateInput });
		await inputs[0].complete(undefined);
		await first;
		assert.strictEqual(await service.$validateInput('current'), 'current');
		assert.deepStrictEqual(observe(), { selection: false, validation: true });
		await inputs[1].complete('second');
		assert.strictEqual(await second, 'second');
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('Different quick input kinds do not invalidate each other during completion', async () => {
		const { service, picks, inputs, observe } = createService();
		const pick = service.showQuickPick(nullExtensionDescription, ['item'], { onDidSelectItem() { } });
		await timeout(0);
		const input = service.showInput({ validateInput: () => 'active' });
		await picks[0].complete(0);
		assert.strictEqual(await pick, 'item');
		assert.deepStrictEqual(observe(), { selection: false, validation: true });
		await inputs[0].complete('input');
		await input;
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('An already-cancelled Input Box preserves the visible input validator', async () => {
		const { service, inputs, observe } = createService();
		const validateInput = () => 'invalid';
		const first = service.showInput({ validateInput });
		await service.showInput({ validateInput }, CancellationToken.Cancelled);
		assert.strictEqual(await service.$validateInput('invalid value'), 'invalid');
		assert.strictEqual(inputs.length, 1);
		await inputs[0].complete(undefined);
		await first;
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	for (const delayed of [false, true]) {
		test(`An already-cancelled Quick Pick preserves and releases the visible callback (delayed items: ${delayed})`, async () => {
			const { service, picks, observe } = createService();
			const items = new DeferredPromise<string[]>();
			const selected: (string | vscode.QuickPickItem)[] = [];
			const first = service.showQuickPick(nullExtensionDescription, delayed ? items.p : ['active'], { onDidSelectItem: item => selected.push(item) });
			await timeout(0);
			await service.showQuickPick(nullExtensionDescription, ['cancelled'], { onDidSelectItem() { assert.fail('cancelled picker callback'); } }, CancellationToken.Cancelled);
			await items.complete(['active']);
			await timeout(0);
			service.$onItemSelected(0);
			assert.deepStrictEqual({ selected, count: picks.length }, { selected: ['active'], count: 1 });
			await picks[0].complete(0);
			assert.strictEqual(await first, 'active');
			assert.deepStrictEqual(observe(), { selection: false, validation: false });
		});
	}

	test('An older delayed Quick Pick cannot replace or clear the newer callback', async () => {
		const { service, picks, observe } = createService();
		const items = new DeferredPromise<string[]>();
		const selected: (string | vscode.QuickPickItem)[] = [];
		const first = service.showQuickPick(nullExtensionDescription, items.p, { onDidSelectItem() { assert.fail('stale picker callback'); } });
		const second = service.showQuickPick(nullExtensionDescription, ['new'], { onDidSelectItem: item => selected.push(item) });
		await timeout(0);
		await items.complete(['old']);
		await timeout(0);
		service.$onItemSelected(0);
		await picks[0].complete(undefined);
		await first;
		service.$onItemSelected(0);
		assert.deepStrictEqual(selected, ['new', 'new']);
		await picks[1].complete(0);
		assert.strictEqual(await second, 'new');
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('An already-cancelled Quick Pick handles later item rejection without opening a widget', async () => {
		const { service, picks, observe } = createService();
		const items = new DeferredPromise<string[]>();
		assert.strictEqual(await service.showQuickPick(nullExtensionDescription, items.p, undefined, CancellationToken.Cancelled), undefined);
		await items.error(new Error('late items error'));
		await timeout(0);
		assert.deepStrictEqual({ ...observe(), count: picks.length }, { selection: false, validation: false, count: 0 });
	});

	test('Closing before items resolve does not install a callback later', async () => {
		const { service, picks, observe } = createService();
		const items = new DeferredPromise<string[]>();
		const result = service.showQuickPick(nullExtensionDescription, items.p, { onDidSelectItem() { } });
		await picks[0].complete(undefined);
		assert.strictEqual(await result, undefined);
		await items.complete(['late']);
		await timeout(0);
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('Quick Pick preserves multiple selection results while releasing its callback', async () => {
		const { service, picks, observe } = createService();
		const items = [{ label: 'first' }, { label: 'second' }];
		const result = service.showQuickPick(nullExtensionDescription, items, { canPickMany: true, onDidSelectItem() { } });
		await timeout(0);
		await picks[0].complete([1, 0]);
		assert.deepStrictEqual(await result, [items[1], items[0]]);
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});

	test('In-flight validation may finish after closure without retaining the validator', async () => {
		const { service, inputs, observe } = createService();
		const validation = new DeferredPromise<string>();
		const result = service.showInput({ validateInput: () => validation.p });
		const pendingValidation = service.$validateInput('value');
		await inputs[0].complete(undefined);
		await result;
		await validation.complete('late validation');
		assert.strictEqual(await pendingValidation, 'late validation');
		assert.deepStrictEqual(observe(), { selection: false, validation: false });
	});
});
