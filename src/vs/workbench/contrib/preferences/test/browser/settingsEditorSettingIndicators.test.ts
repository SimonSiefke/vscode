/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import {
	Disposable,
	DisposableStore,
} from "../../../../../base/common/lifecycle.js";
import { Event } from "../../../../../base/common/event.js";
import { ICommandService } from "../../../../../platform/commands/common/commands.js";
import {
	IHoverService,
	IHoverOptions,
} from "../../../../../base/browser/ui/hover/hover.js";
import { NullCommandService } from "../../../../../platform/commands/test/common/nullCommandService.js";
import { NullHoverService } from "../../../../../platform/hover/test/browser/nullHoverService.js";
import { IUserDataSyncEnablementService } from "../../../../../platform/userDataSync/common/userDataSync.js";
import { workbenchInstantiationService } from "../../../../../workbench/test/browser/workbenchTestServices.js";
import { SettingsTreeIndicatorsLabel } from "../../browser/settingsEditorSettingIndicators.js";
import { SettingsTreeSettingElement } from "../../browser/settingsTreeModels.js";
import {
	EXPERIMENTAL_INDICATOR_DESCRIPTION,
	PREVIEW_INDICATOR_DESCRIPTION,
} from "../../common/preferences.js";

suite("SettingsTreeIndicatorsLabel", () => {
	test("replaces the preview hover disposable on rerender", () => {
		const disposables = new DisposableStore();
		const instantiationService = workbenchInstantiationService(
			undefined,
			disposables,
		);
		instantiationService.stub(ICommandService, NullCommandService);

		let previewHoverCount = 0;
		let previewHoverDisposeCount = 0;
		const hoverService: IHoverService = {
			...NullHoverService,
			showDelayedHover: () => undefined,
			setupDelayedHover: (
				_target: HTMLElement,
				hoverOptions: (() => IHoverOptions) | IHoverOptions,
			) => {
				const resolvedHoverOptions =
					typeof hoverOptions === "function" ? hoverOptions() : hoverOptions;
				const isPreviewHover =
					resolvedHoverOptions.content === PREVIEW_INDICATOR_DESCRIPTION ||
					resolvedHoverOptions.content === EXPERIMENTAL_INDICATOR_DESCRIPTION;
				if (isPreviewHover) {
					previewHoverCount++;
				}

				return new Disposable(() => {
					if (isPreviewHover) {
						previewHoverDisposeCount++;
					}
				});
			},
		};

		instantiationService.stub(IHoverService, hoverService);
		instantiationService.stub(IUserDataSyncEnablementService, {
			_serviceBrand: undefined,
			onDidChangeEnablement: Event.None,
			isEnabled: () => false,
			canToggleEnablement: () => false,
			setEnablement: () => undefined,
			onDidChangeResourceEnablement: Event.None,
			isResourceEnabled: () => false,
			setResourceEnablement: () => undefined,
		});

		const container = document.createElement("div");
		const indicatorsLabel = instantiationService.createInstance(
			SettingsTreeIndicatorsLabel,
			container,
		);

		const setting = {
			key: "test.previewSetting",
			type: "string",
			description: [],
			isLanguageTagSetting: false,
		} as SettingsTreeSettingElement;
		setting.tags = new Set(["preview"]);

		indicatorsLabel.updatePreviewIndicator(setting);
		indicatorsLabel.updatePreviewIndicator(setting);
			indicatorsLabel.updatePreviewIndicator({
				...setting,
				tags: undefined,
			});

		assert.strictEqual(previewHoverCount, 2);
			assert.strictEqual(previewHoverDisposeCount, 2);

		indicatorsLabel.dispose();
			assert.strictEqual(previewHoverDisposeCount, 2);

		disposables.dispose();
	});
});
