/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IReference, toDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { refineServiceDecorator } from '../../instantiation/common/instantiation.js';
import { DidChangeLoggersEvent, ILogger, ILoggerOptions, ILoggerResource, ILoggerService, LogLevel, isLogLevel } from '../common/log.js';
import { LoggerService } from '../node/loggerService.js';

export interface ILoggerReference<T> extends IReference<T> {
	readonly isDisposed: boolean;
	readonly onDidDispose: Event<void>;
}

export const ILoggerMainService = refineServiceDecorator<ILoggerService, ILoggerMainService>(ILoggerService);

export interface ILoggerMainService extends ILoggerService {

	getOnDidChangeLogLevelEvent(windowId: number): Event<LogLevel | [URI, LogLevel]>;

	getOnDidChangeVisibilityEvent(windowId: number): Event<[URI, boolean]>;

	getOnDidChangeLoggersEvent(windowId: number): Event<DidChangeLoggersEvent>;

	/** Acquire an independent handle; the shared backend closes after the final release. */
	acquireLogger(resource: URI, options?: ILoggerOptions, windowId?: number): ILoggerReference<ILogger>;

	/** Retain registration metadata without opening a local file writer. */
	acquireLoggerResource(resource: ILoggerResource, windowId?: number): ILoggerReference<URI>;

	getGlobalLoggers(): ILoggerResource[];

	deregisterLoggers(windowId: number): void;

}

export class LoggerMainService extends LoggerService implements ILoggerMainService {

	private readonly references = new ResourceMap<Set<{ windowId: number | undefined; dispose(): void }>>();
	private readonly globalRegistrations = new ResourceMap<ILoggerReference<URI>>();
	private acquiringResource: URI | undefined;

	acquireLogger(resource: URI, options?: ILoggerOptions, windowId?: number): ILoggerReference<ILogger> {
		const reference = this.acquireResource(resource, windowId);
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

	acquireLoggerResource(resource: ILoggerResource, windowId?: number): ILoggerReference<URI> {
		const reference = this.acquireResource(resource.resource, windowId);
		super.registerLogger(resource);
		return reference;
	}

	private acquireResource(resource: URI, windowId: number | undefined): ILoggerReference<URI> {
		let references = this.references.get(resource);
		if (!references) {
			references = new Set();
			this.references.set(resource, references);
		}
		const owners = references;
		let isDisposed = false;
		const onDidDispose = new Emitter<void>();
		const disposable = toDisposable(() => {
			isDisposed = true;
			// Keep the final owner visible while broadcasting the removal.
			if (owners.size === 1) {
				this.globalRegistrations.delete(resource);
				super.deregisterLogger(resource);
			}
			owners.delete(reference);
			if (owners.size === 0) {
				this.references.delete(resource);
			}
			onDidDispose.fire();
			onDidDispose.dispose();
		});
		const reference = { windowId, dispose: () => disposable.dispose() };
		owners.add(reference);
		return { object: resource, get isDisposed() { return isDisposed; }, onDidDispose: onDidDispose.event, dispose: reference.dispose };
	}

	override registerLogger(resource: ILoggerResource): void {
		if (this.acquiringResource?.toString() === resource.resource.toString()) {
			this.acquiringResource = undefined;
		} else if (!this.globalRegistrations.has(resource.resource)) {
			this.globalRegistrations.set(resource.resource, this.acquireResource(resource.resource, undefined));
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
		for (const references of this.references.values()) {
			for (const reference of references) {
				if (reference.windowId === windowId) {
					reference.dispose();
				}
			}
		}
	}

	private isGlobalLoggerResource(resource: URI): boolean {
		const references = this.references.get(resource);
		return !references || [...references].some(reference => reference.windowId === undefined);
	}

	private isInterestedLoggerResource(resource: URI, windowId: number | undefined): boolean {
		return this.isGlobalLoggerResource(resource) || [...this.references.get(resource) ?? []].some(reference => reference.windowId === windowId);
	}

	override dispose(): void {
		for (const references of this.references.values()) {
			for (const reference of references) {
				reference.dispose();
			}
		}
		this.globalRegistrations.clear();
		super.dispose();
	}
}
