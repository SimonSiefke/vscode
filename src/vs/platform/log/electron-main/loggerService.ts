/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISharedResourceReference, SharedResourceMap } from '../../../base/common/sharedResourceMap.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { Event } from '../../../base/common/event.js';
import { refineServiceDecorator } from '../../instantiation/common/instantiation.js';
import { DidChangeLoggersEvent, ILogger, ILoggerOptions, ILoggerResource, ILoggerService, LogLevel, isLogLevel } from '../common/log.js';
import { LoggerService } from '../node/loggerService.js';

export const ILoggerMainService = refineServiceDecorator<ILoggerService, ILoggerMainService>(ILoggerService);

export interface ILoggerMainService extends ILoggerService {

	getOnDidChangeLogLevelEvent(windowId: number): Event<LogLevel | [URI, LogLevel]>;

	getOnDidChangeVisibilityEvent(windowId: number): Event<[URI, boolean]>;

	getOnDidChangeLoggersEvent(windowId: number): Event<DidChangeLoggersEvent>;

	/** Acquire an independent handle; the shared backend closes after the final release. */
	acquireLogger(resource: URI, options?: ILoggerOptions, windowId?: number): ISharedResourceReference<ILogger>;

	/** Retain registration metadata without opening a local file writer. */
	acquireLoggerResource(resource: ILoggerResource, windowId?: number): ISharedResourceReference<URI>;

	getGlobalLoggers(): ILoggerResource[];

	deregisterLoggers(windowId: number): void;

}

export class LoggerMainService extends LoggerService implements ILoggerMainService {

	private readonly references = this._register(new SharedResourceMap<URI, URI, number | undefined>(
		resource => resource,
		resource => {
			this.globalRegistrations.delete(resource);
			super.deregisterLogger(resource);
		},
		resource => resource.toString(),
	));
	private readonly globalRegistrations = new ResourceMap<ISharedResourceReference<URI>>();
	private acquiringResource: URI | undefined;

	acquireLogger(resource: URI, options?: ILoggerOptions, windowId?: number): ISharedResourceReference<ILogger> {
		const reference = this.references.acquire(resource, windowId);
		const acquiringResource = this.acquiringResource;
		this.acquiringResource = resource;
		try {
			return { object: super.createLogger(resource, options), get isDisposed() { return reference.isDisposed; }, onDidDispose: reference.onDidDispose, dispose: reference.dispose };
		} catch (error) {
			reference.dispose();
			throw error;
		} finally {
			this.acquiringResource = acquiringResource;
		}
	}

	acquireLoggerResource(resource: ILoggerResource, windowId?: number): ISharedResourceReference<URI> {
		const reference = this.references.acquire(resource.resource, windowId);
		super.registerLogger(resource);
		return reference;
	}

	override registerLogger(resource: ILoggerResource): void {
		if (this.acquiringResource?.toString() === resource.resource.toString()) {
			this.acquiringResource = undefined;
		} else if (!this.globalRegistrations.has(resource.resource)) {
			this.globalRegistrations.set(resource.resource, this.references.acquire(resource.resource, undefined));
		}
		super.registerLogger(resource);
	}

	override deregisterLogger(idOrResource: URI | string): void {
		const resource = this.toResource(idOrResource);
		const reference = this.globalRegistrations.get(resource);
		this.globalRegistrations.delete(resource);
		reference?.dispose();
	}

	getGlobalLoggers(): ILoggerResource[] {
		const resources: ILoggerResource[] = [];
		for (const resource of super.getRegisteredLoggers()) {
			if (this.isGlobalLoggerResource(resource.resource)) {
				resources.push(resource);
			}
		}
		return resources;
	}

	getOnDidChangeLogLevelEvent(windowId: number): Event<LogLevel | [URI, LogLevel]> {
		return Event.filter(this.onDidChangeLogLevel, arg => isLogLevel(arg) || this.isInterestedLoggerResource(arg[0], windowId));
	}

	getOnDidChangeVisibilityEvent(windowId: number): Event<[URI, boolean]> {
		return Event.filter(this.onDidChangeVisibility, ([resource]) => this.isInterestedLoggerResource(resource, windowId));
	}

	getOnDidChangeLoggersEvent(windowId: number): Event<DidChangeLoggersEvent> {
		return Event.filter(
			Event.map(this.onDidChangeLoggers, e => {
				const r = {
					added: [...e.added].filter(loggerResource => this.isInterestedLoggerResource(loggerResource.resource, windowId)),
					removed: [...e.removed].filter(loggerResource => this.isInterestedLoggerResource(loggerResource.resource, windowId)),
				};
				return r;
			}), e => e.added.length > 0 || e.removed.length > 0);
	}

	deregisterLoggers(windowId: number): void {
		this.references.releaseOwner(windowId);
	}

	private isGlobalLoggerResource(resource: URI): boolean {
		return !this.references.has(resource) || this.references.hasOwner(resource, undefined);
	}

	private isInterestedLoggerResource(resource: URI, windowId: number | undefined): boolean {
		return this.isGlobalLoggerResource(resource) || this.references.hasOwner(resource, windowId);
	}

	override dispose(): void {
		this.references.dispose();
		this.globalRegistrations.clear();
		super.dispose();
	}
}
