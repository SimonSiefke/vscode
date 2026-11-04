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
		private readonly createObject: ((key: K) => T) | undefined,
		private readonly destroyObject: (key: K, object: T) => void,
		private readonly keyOf: (key: K) => unknown = key => key,
	) {
		super();
	}

	acquire(key: K, owner: Owner, createObject = this.createObject): ISharedResourceReference<T> {
		if (this._store.isDisposed) {
			throw new Error('Cannot acquire a resource after disposal');
		}
		const mapKey = this.keyOf(key);
		let entry = this.entries.get(mapKey);
		if (!entry) {
			if (!createObject) {
				throw new Error('A factory is required for a new resource');
			}
			entry = { key, object: createObject(key), references: new Set() };
			this.entries.set(mapKey, entry);
		}
		const current = entry;
		let onDidDispose: Emitter<void> | undefined;
		let isDisposed = false;
		const disposable = toDisposable(() => {
			isDisposed = true;
			current.references.delete(reference);
			try {
				if (current.references.size === 0) {
					// Remove before destruction so a new acquisition gets a fresh object.
					if (this.entries.get(mapKey) === current) {
						this.entries.delete(mapKey);
					}
					this.destroyObject(current.key, current.object);
				}
			} finally {
				onDidDispose?.fire();
				onDidDispose?.dispose();
			}
		});
		const reference = { owner, dispose: () => disposable.dispose() };
		current.references.add(reference);
		return { object: current.object, get isDisposed() { return isDisposed; }, get onDidDispose() { return isDisposed ? Event.None : (onDidDispose ??= new Emitter<void>()).event; }, dispose: reference.dispose };
	}

	get size(): number {
		return this.entries.size;
	}

	get(key: K): T | undefined {
		return this.entries.get(this.keyOf(key))?.object;
	}

	*values(): IterableIterator<T> {
		for (const entry of this.entries.values()) {
			yield entry.object;
		}
	}

	delete(key: K): void {
		const mapKey = this.keyOf(key);
		const entry = this.entries.get(mapKey);
		if (entry) {
			this.entries.delete(mapKey);
			dispose([...entry.references]);
		}
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
