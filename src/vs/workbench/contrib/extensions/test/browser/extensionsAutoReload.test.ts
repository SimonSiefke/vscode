/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileChangesEvent, FileChangeType, IFileService, IFileSystemWatcher, IWatchOptionsWithCorrelation, IWatchOptionsWithoutCorrelation } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ExtensionAutoReloadContribution } from '../../browser/extensionsAutoReload.js';

class AutoReloadFileService extends mock<IFileService>() {
	readonly changes: Emitter<FileChangesEvent>;
	override readonly onDidFilesChange;
	readonly watched: URI[] = [];
	activeWatchers = 0;

	constructor(store: Pick<DisposableStore, 'add'>) {
		super();
		this.changes = store.add(new Emitter<FileChangesEvent>());
		this.onDidFilesChange = this.changes.event;
	}

	override watch(resource: URI, options: IWatchOptionsWithCorrelation): IFileSystemWatcher;
	override watch(resource: URI, options?: IWatchOptionsWithoutCorrelation): IDisposable;
	override watch(resource: URI, _options?: IWatchOptionsWithoutCorrelation): IDisposable {
		this.watched.push(resource);
		this.activeWatchers++;
		return toDisposable(() => this.activeWatchers--);
	}

	fire(resource: URI, type = FileChangeType.UPDATED): void {
		this.changes.fire(new FileChangesEvent([{ resource, type }], false));
	}
}

class AutoReloadHostService extends mock<IHostService>() {
	reloads = 0;
	pending: Promise<void> | undefined;
	error: Error | undefined;

	override async reload(): Promise<void> {
		this.reloads++;
		if (this.error) {
			throw this.error;
		}
		await this.pending;
	}
}

class AutoReloadLogService extends NullLogService {
	readonly errors: (string | Error)[] = [];

	override error(message: string | Error): void {
		this.errors.push(message);
	}
}

suite('Extension auto reload', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/extensions/development');
	let clock: ReturnType<typeof sinon.useFakeTimers>;

	setup(() => {
		clock = sinon.useFakeTimers();
	});

	teardown(() => clock.restore());

	function create(enabled = true, environment: Partial<IEnvironmentService> = {}) {
		const configuration = new TestConfigurationService({ [ExtensionAutoReloadContribution.ConfigurationKey]: enabled });
		store.add(configuration.onDidChangeConfigurationEmitter);
		const files = new AutoReloadFileService(store);
		const host = new AutoReloadHostService();
		const log = new AutoReloadLogService();
		const contribution = store.add(new ExtensionAutoReloadContribution(
			upcastPartial<IEnvironmentService>({ isExtensionDevelopment: true, extensionDevelopmentLocationURI: [root], ...environment }),
			configuration, files, host, upcastPartial<IUriIdentityService>({ extUri }), log,
		));
		const setEnabled = async (value: boolean) => {
			await configuration.setUserConfiguration(ExtensionAutoReloadContribution.ConfigurationKey, value);
			configuration.onDidChangeConfigurationEmitter.fire(upcastPartial<IConfigurationChangeEvent>({ affectsConfiguration: key => key === ExtensionAutoReloadContribution.ConfigurationKey }));
		};
		return { configuration, files, host, log, contribution, setEnabled };
	}

	test('disabled, ordinary and test windows never watch or reload', async () => {
		const fixtures = [create(false), create(true, { isExtensionDevelopment: false }), create(true, { extensionTestsLocationURI: URI.file('/tests/run.js') }), create(true, { extensionDevelopmentLocationURI: [] })];
		for (const fixture of fixtures) {
			fixture.files.fire(URI.joinPath(root, 'out/extension.js'));
		}
		await clock.tickAsync(1000);
		assert.deepStrictEqual(fixtures.map(({ files, host }) => [files.activeWatchers, host.reloads]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
	});

	test('coalesces nested added, updated and deleted files across development roots', async () => {
		const second = URI.file('/extensions/second');
		const { files, host } = create(true, { extensionDevelopmentLocationURI: [root, second, root] });
		files.fire(URI.joinPath(root, 'out/nested/extension.js'), FileChangeType.ADDED);
		await clock.tickAsync(400);
		files.fire(URI.joinPath(second, 'package.json'));
		await clock.tickAsync(400);
		files.fire(URI.joinPath(root, 'out/old.js'), FileChangeType.DELETED);
		await clock.tickAsync(499);
		const before = host.reloads;
		await clock.tickAsync(1);
		assert.deepStrictEqual({ watched: files.watched.map(uri => uri.path), before, after: host.reloads }, { watched: [root.path, second.path], before: 0, after: 1 });
	});

	test('ignores unrelated paths, sibling prefixes, git metadata and dependencies', async () => {
		const { files, host } = create();
		for (const path of ['/other/file.js', '/extensions/development-other/file.js', '/extensions/development/.git/index', '/extensions/development/node_modules/pkg/index.js', '/extensions/development/nested/node_modules/pkg/file.js']) {
			files.fire(URI.file(path));
		}
		await clock.tickAsync(1000);
		assert.strictEqual(host.reloads, 0);
	});

	test('disabling cancels pending reload and disposes watchers; enabling restores them', async () => {
		const { files, host, setEnabled } = create();
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await setEnabled(false);
		await clock.tickAsync(1000);
		const disabled = [files.activeWatchers, host.reloads];
		await setEnabled(true);
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(500);
		assert.deepStrictEqual({ disabled, enabled: [files.activeWatchers, host.reloads] }, { disabled: [0, 0], enabled: [1, 1] });
	});

	test('disposal cancels timers, listeners and watches', async () => {
		const { files, host, contribution } = create();
		files.fire(URI.joinPath(root, 'out/extension.js'));
		contribution.dispose();
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(1000);
		assert.deepStrictEqual([files.activeWatchers, host.reloads, files.changes.hasListeners()], [0, 0, false]);
	});

	test('does not overlap reload requests and recovers after rejection', async () => {
		const { files, host, log } = create();
		const pending = new DeferredPromise<void>();
		host.pending = pending.p;
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(500);
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(500);
		const concurrent = host.reloads;
		await pending.complete();
		host.pending = undefined;
		host.error = new Error('cancelled reload');
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(500);
		host.error = undefined;
		files.fire(URI.joinPath(root, 'out/extension.js'));
		await clock.tickAsync(500);
		assert.deepStrictEqual({ concurrent, final: host.reloads, errors: log.errors.length }, { concurrent: 1, final: 3, errors: 1 });
	});
});
