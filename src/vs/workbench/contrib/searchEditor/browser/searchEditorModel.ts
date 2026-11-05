/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { parseSavedSearchEditor, parseSerializedSearchEditor } from './searchEditorSerialization.js';
import { IWorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackup.js';
import { SearchConfiguration, SearchEditorWorkingCopyTypeId } from './constants.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { createTextBufferFactoryFromStream } from '../../../../editor/common/model/textModel.js';
import { Emitter } from '../../../../base/common/event.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { SEARCH_RESULT_LANGUAGE_ID } from '../../../services/search/common/search.js';
import { CancellationError } from '../../../../base/common/errors.js';

export type SearchEditorData = { resultsModel: ITextModel; configurationModel: SearchConfigurationModel };

interface ISearchEditorModelReference {
	resolve(): Promise<SearchEditorData>;
}

export class SearchConfigurationModel {
	private _onConfigDidUpdate = new Emitter<SearchConfiguration>();
	public readonly onConfigDidUpdate = this._onConfigDidUpdate.event;

	constructor(public config: Readonly<SearchConfiguration>) { }
	updateConfig(config: SearchConfiguration) { this.config = config; this._onConfigDidUpdate.fire(config); }
}

export class SearchEditorModel {
	private readonly modelReference: ISearchEditorModelReference;

	constructor(
		private readonly resource: URI,
	) {
		this.modelReference = assertReturnsDefined(searchEditorModelFactory.models.get(this.resource));
	}

	async resolve(): Promise<SearchEditorData> {
		return this.modelReference.resolve();
	}

	dispose(): void {
		if (searchEditorModelFactory.models.get(this.resource) === this.modelReference) {
			searchEditorModelFactory.models.delete(this.resource);
		}
	}
}

class SearchEditorModelFactory {
	models = new ResourceMap<ISearchEditorModelReference>();

	constructor() { }

	initializeModelFromExistingModel(accessor: ServicesAccessor, resource: URI, config: SearchConfiguration) {
		if (this.models.has(resource)) {
			throw Error('Unable to contruct model for resource that already exists');
		}

		const languageService = accessor.get(ILanguageService);
		const modelService = accessor.get(IModelService);
		const instantiationService = accessor.get(IInstantiationService);
		const workingCopyBackupService = accessor.get(IWorkingCopyBackupService);

		let ongoingResolve: Promise<SearchEditorData> | undefined;

		const modelReference: ISearchEditorModelReference = {
			resolve: () => {
				if (!ongoingResolve) {
					ongoingResolve = (async () => {

						const backup = await this.tryFetchModelFromBackupService(resource, modelReference, languageService, modelService, workingCopyBackupService, instantiationService);
						this.assertModelReferenceIsCurrent(resource, modelReference);
						if (backup) {
							return backup;
						}

						return Promise.resolve({
							resultsModel: modelService.getModel(resource) ?? modelService.createModel('', languageService.createById(SEARCH_RESULT_LANGUAGE_ID), resource),
							configurationModel: new SearchConfigurationModel(config)
						});
					})();
				}
				return ongoingResolve;
			}
		};
		this.models.set(resource, modelReference);
	}

	initializeModelFromRawData(accessor: ServicesAccessor, resource: URI, config: SearchConfiguration, contents: string | undefined) {
		if (this.models.has(resource)) {
			throw Error('Unable to contruct model for resource that already exists');
		}

		const languageService = accessor.get(ILanguageService);
		const modelService = accessor.get(IModelService);
		const instantiationService = accessor.get(IInstantiationService);
		const workingCopyBackupService = accessor.get(IWorkingCopyBackupService);

		let ongoingResolve: Promise<SearchEditorData> | undefined;

		const modelReference: ISearchEditorModelReference = {
			resolve: () => {
				if (!ongoingResolve) {
					ongoingResolve = (async () => {

						const backup = await this.tryFetchModelFromBackupService(resource, modelReference, languageService, modelService, workingCopyBackupService, instantiationService);
						this.assertModelReferenceIsCurrent(resource, modelReference);
						if (backup) {
							return backup;
						}

						return Promise.resolve({
							resultsModel: modelService.createModel(contents ?? '', languageService.createById(SEARCH_RESULT_LANGUAGE_ID), resource),
							configurationModel: new SearchConfigurationModel(config)
						});
					})();
				}
				return ongoingResolve;
			}
		};
		this.models.set(resource, modelReference);
	}

	initializeModelFromExistingFile(accessor: ServicesAccessor, resource: URI, existingFile: URI) {
		if (this.models.has(resource)) {
			throw Error('Unable to contruct model for resource that already exists');
		}

		const languageService = accessor.get(ILanguageService);
		const modelService = accessor.get(IModelService);
		const instantiationService = accessor.get(IInstantiationService);
		const workingCopyBackupService = accessor.get(IWorkingCopyBackupService);

		let ongoingResolve: Promise<SearchEditorData> | undefined;

		const modelReference: ISearchEditorModelReference = {
			resolve: async () => {
				if (!ongoingResolve) {
					ongoingResolve = (async () => {

						const backup = await this.tryFetchModelFromBackupService(resource, modelReference, languageService, modelService, workingCopyBackupService, instantiationService);
						this.assertModelReferenceIsCurrent(resource, modelReference);
						if (backup) {
							return backup;
						}

						const { text, config } = await instantiationService.invokeFunction(parseSavedSearchEditor, existingFile);
						this.assertModelReferenceIsCurrent(resource, modelReference);
						return ({
							resultsModel: modelService.createModel(text ?? '', languageService.createById(SEARCH_RESULT_LANGUAGE_ID), resource),
							configurationModel: new SearchConfigurationModel(config)
						});
					})();
				}
				return ongoingResolve;
			}
		};
		this.models.set(resource, modelReference);
	}

	private assertModelReferenceIsCurrent(resource: URI, modelReference: ISearchEditorModelReference): void {
		if (this.models.get(resource) !== modelReference) {
			throw new CancellationError();
		}
	}

	private async tryFetchModelFromBackupService(resource: URI, modelReference: ISearchEditorModelReference, languageService: ILanguageService, modelService: IModelService, workingCopyBackupService: IWorkingCopyBackupService, instantiationService: IInstantiationService): Promise<SearchEditorData | undefined> {
		const backup = await workingCopyBackupService.resolve({ resource, typeId: SearchEditorWorkingCopyTypeId });
		const factory = backup ? await createTextBufferFactoryFromStream(backup.value) : undefined;
		this.assertModelReferenceIsCurrent(resource, modelReference);

		let model = modelService.getModel(resource);
		if (!model && factory) {
			model = modelService.createModel(factory, languageService.createById(SEARCH_RESULT_LANGUAGE_ID), resource);
		}

		if (model) {
			const existingFile = model.getValue();
			const { text, config } = parseSerializedSearchEditor(existingFile);
			modelService.destroyModel(resource);
			this.assertModelReferenceIsCurrent(resource, modelReference);
			return ({
				resultsModel: modelService.createModel(text ?? '', languageService.createById(SEARCH_RESULT_LANGUAGE_ID), resource),
				configurationModel: new SearchConfigurationModel(config)
			});
		}
		else {
			return undefined;
		}
	}
}

export const searchEditorModelFactory = new SearchEditorModelFactory();
