/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ITreeNode } from '../../../../../base/browser/ui/tree/tree.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatDebugEventTreeRenderer } from '../../browser/chatDebug/chatDebugEventList.js';
import { ChatDebugLogLevel, IChatDebugEvent } from '../../common/chatDebugService.js';

suite('ChatDebugEventTreeRenderer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function node(element: IChatDebugEvent): ITreeNode<IChatDebugEvent> {
		return { element, children: [], depth: 1, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };
	}

	test('error styling follows recycled rows and is cleared on disposal', () => {
		const renderer = new ChatDebugEventTreeRenderer();
		const row = dom.$('.monaco-tl-row');
		const template = renderer.renderTemplate(dom.append(row, dom.$('.monaco-tl-contents')));
		const event = { kind: 'generic', sessionResource: URI.parse('test://session'), created: new Date(), name: 'event', level: ChatDebugLogLevel.Error } as const;
		renderer.renderElement(node(event), 0, template);
		const error = row.classList.contains('chat-debug-log-error-row');
		renderer.renderElement(node({ ...event, level: ChatDebugLogLevel.Info }), 1, template);
		const info = row.classList.contains('chat-debug-log-error-row');
		renderer.renderElement(node({ kind: 'toolCall', sessionResource: event.sessionResource, created: event.created, toolName: 'tool', result: 'error' }), 2, template);
		const toolError = row.classList.contains('chat-debug-log-error-row');
		renderer.disposeTemplate(template);
		assert.deepStrictEqual({ error, info, toolError, disposed: row.classList.contains('chat-debug-log-error-row') }, { error: true, info: false, toolError: true, disposed: false });
	});

	test('warning styling is removed when a row is reused for an error', () => {
		const renderer = new ChatDebugEventTreeRenderer();
		const row = dom.$('.monaco-tl-row');
		const template = renderer.renderTemplate(dom.append(row, dom.$('.monaco-tl-contents')));
		const event = { kind: 'generic', sessionResource: URI.parse('test://session'), created: new Date(), name: 'event', level: ChatDebugLogLevel.Warning } as const;
		renderer.renderElement(node(event), 0, template);
		const warning = row.classList.contains('chat-debug-log-warning-row');
		renderer.renderElement(node({ ...event, level: ChatDebugLogLevel.Error }), 1, template);
		const error = { warning: row.classList.contains('chat-debug-log-warning-row'), error: row.classList.contains('chat-debug-log-error-row') };
		renderer.renderElement(node(event), 2, template);
		renderer.disposeTemplate(template);
		assert.deepStrictEqual({ warning, error, disposed: row.classList.contains('chat-debug-log-warning-row') }, { warning: true, error: { warning: false, error: true }, disposed: false });
	});
});
