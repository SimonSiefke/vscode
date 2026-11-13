/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { autorun, observableFromEvent } from '../../../../base/common/observable.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IChatMode, IChatModes, IChatModeService } from '../common/chatModes.js';
import { IChatWidgetService } from './chat.js';
import { ModeOpenChatGlobalAction } from './actions/chatActions.js';

/**
 * Given builtin and custom modes, returns only the custom mode IDs that should have actions registered.
 * Custom modes whose names conflict with builtin modes are excluded.
 * If there are name collisions among custom modes, the later mode in the list wins.
 */
function getCustomModesWithUniqueNames(builtinModes: readonly IChatMode[], customModes: readonly IChatMode[]): Set<string> {
	const customModeIds = new Set<string>();
	const builtinNames = new Set(builtinModes.map(mode => mode.name.get()));
	const customNameToId = new Map<string, string>();

	for (const mode of customModes) {
		const modeName = mode.name.get();

		// Skip custom modes that conflict with builtin mode names
		if (builtinNames.has(modeName)) {
			continue;
		}

		// If there is a name collision among custom modes, the later mode in the list wins
		const existingId = customNameToId.get(modeName);
		if (existingId) {
			customModeIds.delete(existingId);
		}

		customNameToId.set(modeName, mode.id);
		customModeIds.add(mode.id);
	}

	return customModeIds;
}

/**
 * Workbench contribution to register actions for custom chat modes via events
 */
export class ChatAgentActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatAgentActions';

	private readonly _modeActionDisposables = new DisposableMap<string, { readonly mode: IChatMode; dispose(): void }>();

	constructor(
		@IChatModeService _chatModeService: IChatModeService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super();
		this._store.add(this._modeActionDisposables);

		const focusedWidget = observableFromEvent(this, this.chatWidgetService.onDidChangeFocusedSession, () => this.chatWidgetService.lastFocusedWidget);
		this._register(autorun(reader => {
			const chatModes = focusedWidget.read(reader)?.input.currentChatModesObs.read(reader);
			this._syncModeActions(chatModes);
		}));
	}

	private _syncModeActions(chatModes: IChatModes | undefined): void {
		if (!chatModes) {
			this._modeActionDisposables.clearAndDisposeAll();
			return;
		}

		const { builtin, custom } = chatModes;
		const currentModeIds = getCustomModesWithUniqueNames(builtin, custom);

		// Remove modes that no longer exist, have been replaced, or lost a name collision.
		for (const modeId of this._modeActionDisposables.keys()) {
			const currentMode = custom.find(mode => mode.id === modeId);
			if (!currentModeIds.has(modeId) || this._modeActionDisposables.get(modeId)?.mode !== currentMode) {
				this._modeActionDisposables.deleteAndDispose(modeId);
			}
		}

		// Register new modes.
		for (const mode of custom) {
			if (currentModeIds.has(mode.id) && !this._modeActionDisposables.has(mode.id)) {
				this._registerModeAction(mode);
			}
		}
	}

	private _registerModeAction(mode: IChatMode): void {
		const actionClass = class extends ModeOpenChatGlobalAction {
			constructor() {
				super(mode);
			}
		};
		const disposable = registerAction2(actionClass);
		this._modeActionDisposables.set(mode.id, {
			mode,
			dispose: () => disposable.dispose(),
		});
	}
}
