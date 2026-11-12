/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TreeVisibility } from '../../../../../base/browser/ui/tree/tree.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Comment, CommentThread } from '../../../../../editor/common/languages.js';
import { FilterOptions } from '../../browser/commentsFilterOptions.js';
import { Filter } from '../../browser/commentsTreeViewer.js';
import { ResourceWithCommentThreads } from '../../common/commentModel.js';

suite('CommentsFilter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/example.ts');

	for (const [body, userName, replyBody, replyUserName] of [
		['needle', 'author', 'reply', 'reviewer'],
		['body', 'needle', 'reply', 'reviewer'],
		['body', 'author', 'needle', 'reviewer'],
		['body', 'author', 'reply', 'needle'],
	]) {
		test(`matches body or author after earlier fields fail: ${body}, ${userName}, ${replyBody}, ${replyUserName}`, () => {
			const comments: Comment[] = [
				{ uniqueIdInThread: 1, body, userName },
				{ uniqueIdInThread: 2, body: replyBody, userName: replyUserName }
			];
			const thread = upcastPartial<CommentThread>({ threadId: 'thread', comments });
			const node = ResourceWithCommentThreads.createCommentNode('owner', 'owner', resource, thread);
			const filter = new Filter(new FilterOptions('needle', true, true));
			const result = filter.filter(node, TreeVisibility.Recurse);
			assert.strictEqual(typeof result === 'object' && result.visibility, true);
		});
	}

	test('does not match unrelated resources or comments and honors negation', () => {
		const thread = upcastPartial<CommentThread>({
			threadId: 'thread', comments: [{ uniqueIdInThread: 1, body: 'body', userName: 'author' }]
		});
		const item = new ResourceWithCommentThreads('owner', 'owner', resource, [thread]);
		const filter = new Filter(new FilterOptions('needle', true, true));
		assert.deepStrictEqual([
			filter.filter(item, TreeVisibility.Recurse),
			filter.filter(item.commentThreads[0], TreeVisibility.Recurse)
		], [TreeVisibility.Recurse, TreeVisibility.Recurse]);
		filter.options = new FilterOptions('!needle', true, true);
		assert.strictEqual(filter.filter(item.commentThreads[0], TreeVisibility.Recurse), true);
	});
});
