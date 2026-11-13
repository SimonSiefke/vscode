/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IChatWidget, IChatWidgetService } from '../../browser/chat.js';
import { ChatAgentActionsContribution } from '../../browser/chatAgentActionsContribution.js';
import { IChatMode, IChatModes, IChatModeService } from '../../common/chatModes.js';
import { ChatModeKind } from '../../common/constants.js';
import { Target } from '../../common/promptSyntax/promptTypes.js';

const createMode = (): IChatMode => ({
	id: 'testMode',
	kind: ChatModeKind.Agent,
	name: constObservable('testMode'),
	label: constObservable('testMode'),
	icon: constObservable(undefined),
	description: constObservable(undefined),
	isBuiltin: false,
	target: constObservable(Target.Undefined),
}) as IChatMode;

const createModes = (mode: IChatMode): IChatModes => ({
	builtin: [],
	custom: [mode],
	findModeById: id => id === mode.id ? mode : undefined,
	findModeByName: name => name === mode.name.get() ? mode : undefined,
	onDidChange: Event.None,
	waitForPendingUpdates: async () => { },
});

suite('ChatAgentActionsContribution', () => {
	const store = new DisposableStore();

	teardown(() => store.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	test('replaces a mode action when the mode instance changes', () => {
		const firstMode = createMode();
		const modes = observableValue<IChatModes>('currentChatModes', createModes(firstMode));
		const widget = {
			input: { currentChatModesObs: modes },
		} as unknown as IChatWidget;
		const widgetService = {
			lastFocusedWidget: widget,
			onDidChangeFocusedSession: Event.None,
		} as unknown as IChatWidgetService;
		const contribution = store.add(new ChatAgentActionsContribution({} as IChatModeService, widgetService));
		const registrations = (contribution as unknown as {
			_modeActionDisposables: { get(id: string): { readonly mode: IChatMode } | undefined };
		})._modeActionDisposables;

		assert.strictEqual(registrations.get(firstMode.id)?.mode, firstMode);

		const replacementMode = createMode();
		modes.set(createModes(replacementMode), undefined);

		assert.strictEqual(registrations.get(replacementMode.id)?.mode, replacementMode);
	});
});
