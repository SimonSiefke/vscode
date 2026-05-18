/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { AgentSessionsModel, IAgentSession, IAgentSessionsModel } from './agentSessionsModel.js';

export interface IAgentSessionsService {

	readonly _serviceBrand: undefined;

	readonly model: IAgentSessionsModel;
	readonly onDidChangeSessionArchivedState: Event<IAgentSession>;

	getSession(resource: URI): IAgentSession | undefined;
}

export class AgentSessionsService extends Disposable implements IAgentSessionsService {

	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeSessionArchivedState = this._register(new Emitter<IAgentSession>());
	readonly onDidChangeSessionArchivedState = this._onDidChangeSessionArchivedState.event;

	private _model: IAgentSessionsModel | undefined;
	private _didResolveAllProviders = false;

	private getOrCreateModel(resolveAllProviders: boolean): IAgentSessionsModel {
		if (!this._model) {
			this._model = this._register(this.instantiationService.createInstance(AgentSessionsModel));
			this._register(this._model.onDidChangeSessionArchivedState(session => {
				if (session.isArchived()) {
					void this.chatService.cancelCurrentRequestForSession(session.resource, 'archive');
				}

				this._onDidChangeSessionArchivedState.fire(session);
			}));
		}

		if (resolveAllProviders && !this._didResolveAllProviders) {
			this._didResolveAllProviders = true;
			this._model.resolve(undefined /* all providers */);
		}

		return this._model;
	}

	get model(): IAgentSessionsModel {
		return this.getOrCreateModel(true);
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatService private readonly chatService: IChatService,
	) {
		super();
	}

	getSession(resource: URI): IAgentSession | undefined {
		const model = this.getOrCreateModel(false);
		model.observeSession(resource);
		return model.getSession(resource);
	}
}

export const IAgentSessionsService = createDecorator<IAgentSessionsService>('agentSessions');
