/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from './event.js';
import { Disposable, dispose, IDisposable, IReference, toDisposable } from './lifecycle.js';

export interface ISharedResourceReference<T> extends IReference<T> {
	readonly isDisposed: boolean;
	readonly onDidDispose: Event<void>;
}

type Entry<K, T, Owner> = {
	readonly key: K;
	readonly object: T;
	readonly references: Set<{ owner: Owner; dispose(): void }>;
};

/**
 * Shares one object per key between independent disposable references.
 * Releasing an owner releases all of its references. The final release destroys the object.
 */
export class SharedResourceMap<K, T, Owner> extends Disposable {

	private readonly entries = new Map<unknown, Entry<K, T, Owner>>();

	constructor(
		private readonly createObject: (key: K) => T,
		private readonly destroyObject: (key: K, object: T) => void,
		private readonly keyOf: (key: K) => unknown = key => key,
	) {
		super();
	}

	acquire(key: K, owner: Owner): ISharedResourceReference<T> {
		if (this._store.isDisposed) {
			throw new Error('Cannot acquire a resource after disposal');
		}
		const mapKey = this.keyOf(key);
		let entry = this.entries.get(mapKey);
		if (!entry) {
			entry = { key, object: this.createObject(key), references: new Set() };
			this.entries.set(mapKey, entry);
		}
		const current = entry;
		const onDidDispose = new Emitter<void>();
		let isDisposed = false;
		const disposable = toDisposable(() => {
			isDisposed = true;
			current.references.delete(reference);
			try {
				if (current.references.size === 0) {
					// Remove before destruction so a new acquisition gets a fresh object.
					this.entries.delete(mapKey);
					this.destroyObject(current.key, current.object);
				}
			} finally {
				onDidDispose.fire();
				onDidDispose.dispose();
			}
		});
		const reference = { owner, dispose: () => disposable.dispose() };
		current.references.add(reference);
		return { object: current.object, get isDisposed() { return isDisposed; }, onDidDispose: onDidDispose.event, dispose: reference.dispose };
	}

	has(key: K): boolean {
		return this.entries.has(this.keyOf(key));
	}

	hasOwner(key: K, owner: Owner): boolean {
		return [...this.entries.get(this.keyOf(key))?.references ?? []].some(reference => reference.owner === owner);
	}

	releaseOwner(owner: Owner): void {
		this.releaseReferences(reference => reference.owner === owner);
	}

	private releaseReferences(predicate: (reference: { owner: Owner } & IDisposable) => boolean): void {
		// Snapshot first: cleanup callbacks can acquire new references.
		const references = [...this.entries.values()].flatMap(entry => [...entry.references]).filter(predicate);
		dispose(references);
	}

	override dispose(): void {
		super.dispose();
		this.releaseReferences(() => true);
	}
}
