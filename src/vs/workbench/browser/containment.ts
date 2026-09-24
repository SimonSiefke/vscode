/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../common/contributions.js';
import { IWorkbenchLayoutService } from '../services/layout/browser/layoutService.js';
import { Disposable, DisposableStore, toDisposable } from '../../base/common/lifecycle.js';

const containClass = 'contain';
const containContentClass = 'contain-content';

const contentTags = new Set([
	'span',
	'a',
	'p',
	'label',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'dl',
	'dt',
	'dd',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'pre',
	'code',
	'img',
	'svg',
	'canvas',
	'input',
	'textarea',
	'select',
	'button'
]);

const contentSubtreeClasses = new Set([
	'monaco-editor',
	'monaco-list-row',
	'monaco-tree-row',
	'monaco-icon-label',
	'monaco-highlighted-label',
	'monaco-action-bar',
	'action-item',
	'action-label',
	'monaco-button',
	'monaco-inputbox',
	'context-view',
	'monaco-menu',
	'monaco-hover',
	'quick-input-widget',
	'monaco-dialog-box',
	'notifications-center',
	'notifications-toasts',
	'suggest-widget',
	'parameter-hints-widget',
	'rename-box',
	'find-widget',
	'action-widget',
	'menubar',
	'titlebar-container',
	'tabs-container',
	'tab',
	'notebookOverlay',
	'notebook-editor',
	'cell',
	'cell-output',
	'terminal',
	'xterm',
	'interactive-session',
	'interactive-input-editor',
	'chat-widget',
	'chat-editor-container',
	'inline-chat',
	'debug-view-content',
	'peekview-widget',
	'zone-widget'
]);

const contentElementClasses = new Set([
	'monaco-count-badge',
	'monaco-keybinding',
	'monaco-sash'
]);

interface IContainmentNode {
	readonly element: Element;
	readonly forceContent: boolean;
}

function isContainmentElement(element: Element): boolean {
	const targetWindow = element.ownerDocument.defaultView;
	if (!targetWindow) {
		return false;
	}

	if (element instanceof targetWindow.HTMLElement) {
		return true;
	}

	return element instanceof targetWindow.SVGSVGElement;
}

function hasAnyClass(element: Element, classNames: Set<string>): boolean {
	for (const className of classNames) {
		if (element.classList.contains(className)) {
			return true;
		}
	}

	return false;
}

function isContentElement(element: Element, forceContent: boolean): boolean {
	return forceContent || contentTags.has(element.localName) || hasAnyClass(element, contentSubtreeClasses) || hasAnyClass(element, contentElementClasses);
}

function isContentSubtreeRoot(element: Element): boolean {
	return hasAnyClass(element, contentSubtreeClasses);
}

function hasContentSubtreeAncestor(element: Element, container: HTMLElement): boolean {
	for (let ancestor = element.parentElement; ancestor && ancestor !== container; ancestor = ancestor.parentElement) {
		if (isContentSubtreeRoot(ancestor)) {
			return true;
		}
	}

	return false;
}

function applyContainmentClass(element: Element, forceContent: boolean): void {
	if (!isContainmentElement(element)) {
		return;
	}

	if (isContentElement(element, forceContent)) {
		element.classList.remove(containClass);
		element.classList.add(containContentClass);
	} else {
		element.classList.remove(containContentClass);
		element.classList.add(containClass);
	}
}

export function applyWorkbenchContainment(container: Element, forceContent = false): void {
	const stack: IContainmentNode[] = [{ element: container, forceContent }];

	while (stack.length > 0) {
		const { element, forceContent } = stack.pop()!;
		const childForceContent = forceContent || isContentSubtreeRoot(element);

		applyContainmentClass(element, forceContent);

		const targetWindow = element.ownerDocument.defaultView;
		if (!targetWindow || !(element instanceof targetWindow.HTMLElement)) {
			continue;
		}

		for (let i = element.children.length - 1; i >= 0; i--) {
			stack.push({ element: element.children[i], forceContent: childForceContent });
		}
	}
}

export function registerWorkbenchContainment(container: HTMLElement, disposables: DisposableStore): void {
	applyWorkbenchContainment(container);

	const targetWindow = container.ownerDocument.defaultView;
	if (!targetWindow) {
		return;
	}

	const observer = new targetWindow.MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType !== targetWindow.Node.ELEMENT_NODE) {
					continue;
				}

				const element = node as Element;
				if (!container.contains(element)) {
					continue;
				}

				applyWorkbenchContainment(element, hasContentSubtreeAncestor(element, container));
			}
		}
	});

	observer.observe(container, { childList: true, subtree: true });
	disposables.add(toDisposable(() => observer.disconnect()));
}

class WorkbenchContainmentContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.containment';

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super();

		for (const container of layoutService.containers) {
			registerWorkbenchContainment(container, this._store);
		}

		this._register(layoutService.onDidAddContainer(({ container, disposables }) => registerWorkbenchContainment(container, disposables)));
	}
}

registerWorkbenchContribution2(WorkbenchContainmentContribution.ID, WorkbenchContainmentContribution, WorkbenchPhase.BlockStartup);
