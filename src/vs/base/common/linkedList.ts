/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from './lifecycle.js';

const removeNode = Symbol('removeNode');
const detachNode = Symbol('detachNode');

class Node<E> {

	static readonly Undefined = new Node<unknown>(undefined);

	element: E;
	next: Node<E> | typeof Node.Undefined;
	prev: Node<E> | typeof Node.Undefined;

	constructor(element: E) {
		this.element = element;
		this.next = Node.Undefined;
		this.prev = Node.Undefined;
	}

	[detachNode](): void { }
}

class DisposableNode<E> extends Node<E> implements IDisposable {

	constructor(
		element: E,
		private _list: LinkedList<E> | undefined,
	) {
		super(element);
	}

	dispose(): void {
		const list = this._list;
		if (!list) {
			return;
		}
		this._list = undefined;
		list[removeNode](this);
	}

	override[detachNode](): void {
		this._list = undefined;
	}
}

export class LinkedList<E> {

	private _first: Node<E> | typeof Node.Undefined = Node.Undefined;
	private _last: Node<E> | typeof Node.Undefined = Node.Undefined;
	private _size: number = 0;

	get size(): number {
		return this._size;
	}

	isEmpty(): boolean {
		return this._first === Node.Undefined;
	}

	clear(): void {
		let node = this._first;
		while (node !== Node.Undefined) {
			const next = node.next;
			node[detachNode]();
			node.prev = Node.Undefined;
			node.next = Node.Undefined;
			node = next;
		}

		this._first = Node.Undefined;
		this._last = Node.Undefined;
		this._size = 0;
	}

	unshift(element: E): () => void {
		return this._insert(element, false);
	}

	unshiftDisposable(element: E): IDisposable {
		return this._insertDisposable(element, false);
	}

	push(element: E): () => void {
		return this._insert(element, true);
	}

	pushDisposable(element: E): IDisposable {
		return this._insertDisposable(element, true);
	}

	private _insert(element: E, atTheEnd: boolean): () => void {
		const newNode = new Node(element);
		this._insertNode(newNode, atTheEnd);

		let didRemove = false;
		return () => {
			if (!didRemove) {
				didRemove = true;
				this._remove(newNode);
			}
		};
	}

	private _insertDisposable(element: E, atTheEnd: boolean): IDisposable {
		const newNode = new DisposableNode(element, this);
		this._insertNode(newNode, atTheEnd);
		return newNode;
	}

	private _insertNode(newNode: Node<E>, atTheEnd: boolean): void {
		if (this._first === Node.Undefined) {
			this._first = newNode;
			this._last = newNode;

		} else if (atTheEnd) {
			// push
			const oldLast = this._last;
			this._last = newNode;
			newNode.prev = oldLast;
			oldLast.next = newNode;

		} else {
			// unshift
			const oldFirst = this._first;
			this._first = newNode;
			newNode.next = oldFirst;
			oldFirst.prev = newNode;
		}
		this._size += 1;
	}

	[removeNode](node: Node<E>): void {
		this._remove(node);
	}

	shift(): E | undefined {
		if (this._first === Node.Undefined) {
			return undefined;
		} else {
			const res = this._first.element;
			this._remove(this._first);
			return res as E;
		}
	}

	pop(): E | undefined {
		if (this._last === Node.Undefined) {
			return undefined;
		} else {
			const res = this._last.element;
			this._remove(this._last);
			return res as E;
		}
	}

	peek(): E | undefined {
		if (this._last === Node.Undefined) {
			return undefined;
		} else {
			const res = this._last.element;
			return res as E;
		}
	}

	private _remove(node: Node<E> | typeof Node.Undefined): void {
		node[detachNode]();
		if (node.prev !== Node.Undefined && node.next !== Node.Undefined) {
			// middle
			const anchor = node.prev;
			anchor.next = node.next;
			node.next.prev = anchor;

		} else if (node.prev === Node.Undefined && node.next === Node.Undefined) {
			// only node
			this._first = Node.Undefined;
			this._last = Node.Undefined;

		} else if (node.next === Node.Undefined) {
			// last
			this._last = this._last.prev!;
			this._last.next = Node.Undefined;

		} else if (node.prev === Node.Undefined) {
			// first
			this._first = this._first.next!;
			this._first.prev = Node.Undefined;
		}

		// done
		this._size -= 1;
	}

	*[Symbol.iterator](): Iterator<E> {
		let node = this._first;
		while (node !== Node.Undefined) {
			yield node.element as E;
			node = node.next;
		}
	}
}
