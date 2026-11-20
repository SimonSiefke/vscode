/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { stub } from 'sinon';
import { timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createCodeEditorServices, instantiateTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { instantiateTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { TestViewsService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { CommentService, ICommentService } from '../../browser/commentService.js';
import { CommentController } from '../../browser/commentsController.js';

suite('CommentController', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('cancels a pending range refresh when the editor switches models', () => runWithFakedTimers({}, async () => {
		const editorServices = createCodeEditorServices(store);
		const first = store.add(instantiateTextModel(editorServices, 'first', undefined, undefined, URI.file('/first.txt')));
		const second = store.add(instantiateTextModel(editorServices, 'second', undefined, undefined, URI.file('/second.txt')));
		const editor = store.add(instantiateTestCodeEditor(editorServices, first));
		const workbenchServices = workbenchInstantiationService({}, store);
		workbenchServices.stub(IViewsService, new TestViewsService());
		const commentService = store.add(workbenchServices.createInstance(CommentService));
		workbenchServices.stub(ICommentService, commentService);
		const requests: URI[] = [];
		const getDocumentComments = stub(commentService, 'getDocumentComments').callsFake(async resource => {
			requests.push(resource);
			return [];
		});
		store.add(toDisposable(() => getDocumentComments.restore()));
		const controller = store.add(workbenchServices.createInstance(CommentController, editor));

		first.setValue('edited first');
		assert.deepStrictEqual(requests, [first.uri]);
		editor.setModel(second);
		await timeout(201);
		assert.deepStrictEqual(requests, [first.uri, second.uri]);

		second.setValue('edited second');
		await timeout(201);
		assert.deepStrictEqual(requests, [first.uri, second.uri, second.uri]);

		controller.dispose();
	}));
});
