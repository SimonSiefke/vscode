/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { SharedResourceMap } from '../../../../base/common/sharedResourceMap.js';
import { URI } from '../../../../base/common/uri.js';
import { makeMcpServerCustomization, normalizeMcpServerConfiguration, readJsonFile, resolveMcpServersMap, type IMcpServerDefinition } from '../../../agentPlugins/common/pluginParsers.js';
import type { IFileService } from '../../../files/common/files.js';

class RootMcpDiscovery extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _sequencer = new Sequencer();
	private readonly _definitionUri: URI;
	private _definitions: readonly IMcpServerDefinition[] = [];
	private _signature = '';
	private _initialized = false;
	private _pendingRefreshes = 0;

	get definitions(): readonly IMcpServerDefinition[] {
		return this._definitions;
	}

	/** Whether no refresh is queued or running. */
	get isSettled(): boolean {
		return this._pendingRefreshes === 0;
	}

	constructor(
		private readonly _root: URI,
		private readonly _fileService: IFileService,
	) {
		super();
		this._definitionUri = URI.joinPath(_root, '.mcp.json');
		const watcher = this._register(_fileService.createWatcher(_root, { recursive: false, excludes: [] }));
		this._register(watcher.onDidChange(event => {
			if (event.affects(this._definitionUri)) {
				void this.refresh(true);
			}
		}));
	}

	refresh(force = false): Promise<readonly IMcpServerDefinition[]> {
		this._pendingRefreshes++;
		return this._sequencer.queue(async () => {
			try {
				if (this._initialized && !force) {
					return this._definitions;
				}
				const definitions = await this._scan();
				const signature = serializeDefinitions(definitions);
				if (!this._initialized) {
					this._initialized = true;
					this._signature = signature;
					this._definitions = definitions;
					return definitions;
				}
				if (signature !== this._signature) {
					this._signature = signature;
					this._definitions = definitions;
					this._onDidChange.fire();
				}
				return this._definitions;
			} finally {
				this._pendingRefreshes--;
			}
		});
	}

	private async _scan(): Promise<readonly IMcpServerDefinition[]> {
		const definitions: IMcpServerDefinition[] = [];
		const raw = resolveMcpServersMap(await readJsonFile(this._definitionUri, this._fileService));
		if (!raw) {
			return definitions;
		}
		for (const [name, value] of Object.entries(raw)) {
			const configuration = normalizeMcpServerConfiguration(value);
			if (configuration) {
				definitions.push({
					name,
					configuration,
					defaultCwd: this._root,
					uri: this._definitionUri,
					customization: makeMcpServerCustomization(this._definitionUri, name),
				});
			}
		}
		return definitions;
	}
}

const sharedRootDiscoveries = new WeakMap<IFileService, SharedResourceMap<URI, RootMcpDiscovery, undefined>>();

function acquireRootMcpDiscovery(root: URI, fileService: IFileService): IReference<RootMcpDiscovery> {
	let byRoot = sharedRootDiscoveries.get(fileService);
	if (!byRoot) {
		const discoveries: SharedResourceMap<URI, RootMcpDiscovery, undefined> = new SharedResourceMap(root => new RootMcpDiscovery(root, fileService), (_root, discovery) => {
			discovery.dispose();
			if (discoveries.size === 0) {
				sharedRootDiscoveries.delete(fileService);
				discoveries.dispose();
			}
		}, root => root.toString());
		byRoot = discoveries;
		sharedRootDiscoveries.set(fileService, byRoot);
	}
	return byRoot.acquire(root, undefined);
}

export class SessionMcpDiscovery extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<readonly IMcpServerDefinition[]>());
	readonly onDidChange: Event<readonly IMcpServerDefinition[]> = this._onDidChange.event;

	private readonly _sequencer = new Sequencer();
	private readonly _roots: readonly { readonly root: URI; readonly discovery: RootMcpDiscovery }[];
	private _definitions: readonly IMcpServerDefinition[] = [];
	private _signature = '';
	private _initialized = false;
	private _pendingMerges = 0;

	get definitions(): readonly IMcpServerDefinition[] {
		return this._definitions;
	}

	/** Whether no root rescan or definition merge is queued or running. */
	get isSettled(): boolean {
		return this._pendingMerges === 0 && this._roots.every(root => root.discovery.isSettled);
	}

	constructor(
		workingDirectories: readonly URI[],
		fileService: IFileService,
	) {
		super();
		this._roots = workingDirectories.map(root => {
			const acquired = this._register(acquireRootMcpDiscovery(root, fileService));
			this._register(acquired.object.onDidChange(() => {
				void this._refreshFromSnapshots();
			}));
			return { root, discovery: acquired.object };
		});
	}

	async refresh(): Promise<readonly IMcpServerDefinition[]> {
		await Promise.all(this._roots.map(root => root.discovery.refresh()));
		return this._refreshFromSnapshots();
	}

	private _refreshFromSnapshots(): Promise<readonly IMcpServerDefinition[]> {
		this._pendingMerges++;
		return this._sequencer.queue(async () => {
			try {
				const definitions = this._mergeRootDefinitions();
				const signature = serializeDefinitions(definitions);
				if (!this._initialized) {
					this._initialized = true;
					this._signature = signature;
					this._definitions = definitions;
					return this._definitions;
				}
				if (signature !== this._signature) {
					this._signature = signature;
					this._definitions = definitions;
					this._onDidChange.fire(definitions);
				}
				return this._definitions;
			} finally {
				this._pendingMerges--;
			}
		});
	}

	private _mergeRootDefinitions(): readonly IMcpServerDefinition[] {
		const definitions = new Map<string, IMcpServerDefinition>();
		for (const root of this._roots) {
			for (const definition of root.discovery.definitions) {
				const name = definition.name;
				if (definitions.has(name)) {
					continue;
				}
				definitions.set(name, definition);
			}
		}
		return [...definitions.values()];
	}
}

function serializeDefinitions(definitions: readonly IMcpServerDefinition[]): string {
	return JSON.stringify(definitions.map(definition => ({
		name: definition.name,
		configuration: definition.configuration,
		defaultCwd: definition.defaultCwd?.toString(),
		uri: definition.uri.toString(),
	})));
}
