/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ChatRichLink } from '../../../../browser/widget/chatContentParts/chatRichLink.js';

suite('ChatRichLink', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('presentation changes preserve status visibility and colors on a reused link', () => {
		const anchor = mainWindow.document.createElement('a');
		mainWindow.document.body.appendChild(anchor);
		store.add(toDisposable(() => anchor.remove()));
		for (const [name, value] of Object.entries({
			'--vscode-descriptionForeground': 'rgb(90, 90, 90)',
			'--vscode-editorWarning-foreground': 'rgb(160, 120, 0)',
			'--vscode-charts-green': 'rgb(0, 128, 0)',
			'--vscode-charts-purple': 'rgb(128, 0, 128)',
			'--vscode-charts-red': 'rgb(192, 0, 0)',
			'--vscode-errorForeground': 'rgb(192, 0, 0)',
		})) {
			anchor.style.setProperty(name, value);
		}
		const link = store.add(ChatRichLink.mount(anchor, mainWindow.document.createElement('span')));
		const presentations = [
			{ kind: 'session', status: { kind: 'pending', label: 'Working' } },
			{ kind: 'chat', status: { kind: 'success', label: 'Completed' } },
			{ kind: 'issue', status: { kind: 'closed', label: 'Closed' } },
			{ kind: 'pullRequest', status: { kind: 'closed', label: 'Closed' }, secondaryStatus: { kind: 'error', label: 'Failed checks' } },
			{ kind: 'resource', status: { kind: 'neutral', label: 'Available' }, secondaryStatus: { kind: 'neutral', label: 'Ready' } },
		] as const;
		const states = presentations.map(presentation => {
			link.update(presentation);
			const status = anchor.querySelector<HTMLElement>('.chat-rich-link-primary-status')!;
			return {
				visible: mainWindow.getComputedStyle(status).display !== 'none',
				label: mainWindow.getComputedStyle(status.querySelector('.chat-rich-link-status-label')!).display !== 'none',
				color: mainWindow.getComputedStyle(status).color,
				secondaryColor: mainWindow.getComputedStyle(anchor.querySelector('.chat-rich-link-secondary-status')!).color,
			};
		});
		assert.deepStrictEqual(states, [
			{ visible: true, label: false, color: 'rgb(160, 120, 0)', secondaryColor: 'rgb(90, 90, 90)' },
			{ visible: false, label: false, color: 'rgb(0, 128, 0)', secondaryColor: 'rgb(90, 90, 90)' },
			{ visible: true, label: false, color: 'rgb(128, 0, 128)', secondaryColor: 'rgb(90, 90, 90)' },
			{ visible: true, label: false, color: 'rgb(192, 0, 0)', secondaryColor: 'rgb(192, 0, 0)' },
			{ visible: true, label: true, color: 'rgb(90, 90, 90)', secondaryColor: 'rgb(90, 90, 90)' },
		]);
		const secondaryStatus = anchor.querySelector<HTMLElement>('.chat-rich-link-secondary-status')!;
		assert.deepStrictEqual({
			visible: mainWindow.getComputedStyle(secondaryStatus).display !== 'none',
			label: mainWindow.getComputedStyle(secondaryStatus.querySelector('.chat-rich-link-status-label')!).display !== 'none',
		}, { visible: true, label: true });

		link.update({ kind: 'pullRequest', status: { kind: 'closed', label: 'Closed' }, secondaryStatus: { kind: 'error', label: 'Failed checks' } });
		link.update({ kind: 'resource' });
		assert.deepStrictEqual([...anchor.querySelectorAll<HTMLElement>('.chat-rich-link-status')].map(status => ({
			hidden: status.hidden,
			display: mainWindow.getComputedStyle(status).display,
			color: mainWindow.getComputedStyle(status).color,
			label: status.querySelector('.chat-rich-link-status-label')!.textContent,
		})), [
			{ hidden: true, display: 'none', color: 'rgb(90, 90, 90)', label: '' },
			{ hidden: true, display: 'none', color: 'rgb(90, 90, 90)', label: '' },
		]);
	});

	test('renders semantic icons for session and chat pills', () => {
		const sessionAnchor = mainWindow.document.createElement('a');
		const chatAnchor = mainWindow.document.createElement('a');
		const sessionLink = store.add(ChatRichLink.mount(sessionAnchor, mainWindow.document.createElement('span')));
		const chatLink = store.add(ChatRichLink.mount(chatAnchor, mainWindow.document.createElement('span')));

		sessionLink.update({
			kind: 'session',
			title: 'Session',
			status: { kind: 'success', label: 'Completed' },
		});
		chatLink.update({
			kind: 'chat',
			title: 'New Chat',
			status: { kind: 'success', label: 'Completed' },
		});

		assert.deepStrictEqual({
			sessionIcon: sessionAnchor.firstElementChild?.className,
			chatIcon: chatAnchor.firstElementChild?.className,
		}, {
			sessionIcon: 'chat-rich-link-icon codicon codicon-agent',
			chatIcon: 'chat-rich-link-icon codicon codicon-comment-discussion',
		});
	});

	test('renders compact non-success status indicators', () => {
		const pendingAnchor = mainWindow.document.createElement('a');
		const warningAnchor = mainWindow.document.createElement('a');
		const errorAnchor = mainWindow.document.createElement('a');
		const completedAnchor = mainWindow.document.createElement('a');
		const pendingLink = store.add(ChatRichLink.mount(pendingAnchor, mainWindow.document.createElement('span')));
		const warningLink = store.add(ChatRichLink.mount(warningAnchor, mainWindow.document.createElement('span')));
		const errorLink = store.add(ChatRichLink.mount(errorAnchor, mainWindow.document.createElement('span')));
		const completedLink = store.add(ChatRichLink.mount(completedAnchor, mainWindow.document.createElement('span')));

		pendingLink.update({ kind: 'session', title: 'Working', status: { kind: 'pending', label: 'Working' } });
		warningLink.update({ kind: 'session', title: 'Needs input', status: { kind: 'warning', label: 'Needs input' } });
		errorLink.update({ kind: 'chat', title: 'Failed chat', status: { kind: 'error', label: 'Error' } });
		completedLink.update({ kind: 'chat', title: 'Completed chat', status: { kind: 'success', label: 'Completed' } });

		assert.deepStrictEqual({
			pending: {
				status: pendingAnchor.dataset.chatRichLinkStatus,
				spinner: pendingAnchor.querySelector('.chat-rich-link-primary-status .monaco-pixel-spinner') !== null,
			},
			warning: {
				status: warningAnchor.dataset.chatRichLinkStatus,
				spinner: warningAnchor.querySelector('.chat-rich-link-primary-status .monaco-pixel-spinner') !== null,
			},
			error: {
				status: errorAnchor.dataset.chatRichLinkStatus,
				icon: errorAnchor.querySelector('.chat-rich-link-primary-status .chat-rich-link-status-icon')?.className,
			},
			completed: {
				status: completedAnchor.dataset.chatRichLinkStatus,
				icon: completedAnchor.querySelector('.chat-rich-link-primary-status .chat-rich-link-status-icon')?.className,
			},
		}, {
			pending: { status: 'pending', spinner: true },
			warning: { status: 'warning', spinner: true },
			error: { status: 'error', icon: 'chat-rich-link-status-icon codicon codicon-error-compact' },
			completed: { status: 'success', icon: 'chat-rich-link-status-icon codicon codicon-pass-filled-compact' },
		});
	});

	test('does not own link activation behavior', () => {
		const anchor = mainWindow.document.createElement('a');
		store.add(ChatRichLink.mount(anchor, mainWindow.document.createElement('span')));

		assert.deepStrictEqual({
			altClickNotCanceled: anchor.dispatchEvent(new mainWindow.MouseEvent('click', { altKey: true, bubbles: true, cancelable: true })),
			altEnterNotCanceled: anchor.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, altKey: true, bubbles: true, cancelable: true })),
		}, {
			altClickNotCanceled: true,
			altEnterNotCanceled: true,
		});
	});
});
