/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';

export class ExtensionAutoReloadContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.extensionsAutoReload';
	static readonly ConfigurationKey = 'extensions.experimental.autoReload';

	private readonly watchers = this._register(new DisposableStore());
	private readonly reloadScheduler = this._register(new RunOnceScheduler(() => void this.reload(), 500));
	private enabled = false;
	private reloading = false;

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IHostService private readonly hostService: IHostService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		if (!environmentService.isExtensionDevelopment || !environmentService.extensionDevelopmentLocationURI?.length || environmentService.extensionTestsLocationURI) {
			return;
		}

		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(ExtensionAutoReloadContribution.ConfigurationKey)) {
				this.updateWatchers();
			}
		}));
		this.updateWatchers();
	}

	private updateWatchers(): void {
		this.watchers.clear();
		this.reloadScheduler.cancel();
		this.enabled = this.configurationService.getValue<boolean>(ExtensionAutoReloadContribution.ConfigurationKey) === true;
		if (!this.enabled) {
			return;
		}

		const roots = new Map<string, URI>();
		for (const root of this.environmentService.extensionDevelopmentLocationURI ?? []) {
			roots.set(this.uriIdentityService.extUri.getComparisonKey(root), root);
		}
		const watchedRoots = [...roots.values()];
		this.watchers.add(this.fileService.onDidFilesChange(event => {
			const resources = [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted];
			if (resources.some(resource => watchedRoots.some(root => this.isRelevantChange(root, resource)))) {
				this.reloadScheduler.schedule();
			}
		}));
		for (const root of watchedRoots) {
			// Correlated createWatcher requests currently support only non-recursive watching.
			this.watchers.add(this.fileService.watch(root, { recursive: true, excludes: ['**/.git/**', '**/node_modules/**'] }));
		}
	}

	private isRelevantChange(root: URI, resource: URI): boolean {
		if (!this.uriIdentityService.extUri.isEqualOrParent(resource, root)) {
			return false;
		}
		const relativePath = this.uriIdentityService.extUri.relativePath(root, resource);
		return relativePath !== undefined && !relativePath.split('/').some(segment => segment === '.git' || segment === 'node_modules');
	}

	private async reload(): Promise<void> {
		if (!this.enabled || this.watchers.isDisposed || this.reloading) {
			return;
		}

		this.reloading = true;
		try {
			await this.hostService.reload();
		} catch (error) {
			this.logService.error('Failed to reload extension development window', error);
		} finally {
			this.reloading = false;
		}
	}
}
