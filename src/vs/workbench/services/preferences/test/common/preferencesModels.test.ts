/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { DefaultSettings } from '../../common/preferencesModels.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { Extensions, IConfigurationRegistry, IConfigurationNode } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';

suite('DefaultSettings', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let configurationRegistry: IConfigurationRegistry;
	let configurationService: TestConfigurationService;

	setup(() => {
		configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		configurationService = new TestConfigurationService();
	});

	test('initializes setting ranges without caching JSON content', () => {
		const config: IConfigurationNode = {
			id: 'lazySettings',
			title: 'Lazy Settings',
			properties: {
				'test.lazySetting': { type: 'string', default: 'value', description: 'A setting description.' }
			}
		};
		configurationRegistry.registerConfiguration(config);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config])));
		const settings = disposables.add(new DefaultSettings(['test.lazySetting'], ConfigurationTarget.USER, configurationService));
		const expected = disposables.add(new DefaultSettings(['test.lazySetting'], ConfigurationTarget.USER, configurationService));

		const groups = settings.getSettingsGroups();
		const commonlyUsedSetting = groups[0].sections[0].settings[0];
		assert.deepStrictEqual({
			key: [commonlyUsedSetting.keyRange.startLineNumber, commonlyUsedSetting.keyRange.startColumn],
			value: [commonlyUsedSetting.valueRange.startLineNumber, commonlyUsedSetting.valueRange.startColumn],
			description: commonlyUsedSetting.descriptionRanges.map(range => [range.startLineNumber, range.startColumn])
		}, { key: [3, 4], value: [3, 23], description: [[2, 6]] });
		assert.deepStrictEqual({
			content: Reflect.get(settings, '_content'),
			contentWithoutMostCommonlyUsed: Reflect.get(settings, '_contentWithoutMostCommonlyUsed')
		}, { content: undefined, contentWithoutMostCommonlyUsed: undefined });

		const content = expected.getContent();
		const contentWithoutMostCommonlyUsed = expected.getContentWithoutMostCommonlyUsed();
		const getRanges = (model: DefaultSettings) => model.getSettingsGroups().map(group => ({
			range: group.range,
			titleRange: group.titleRange,
			settings: group.sections.flatMap(section => section.settings.map(setting => ({
				key: setting.key,
				range: setting.range,
				keyRange: setting.keyRange,
				valueRange: setting.valueRange,
				descriptionRanges: setting.descriptionRanges
			})))
		}));
		assert.deepStrictEqual(getRanges(settings), getRanges(expected));
		assert.strictEqual(settings.getContent(), content);
		assert.strictEqual(settings.getContentWithoutMostCommonlyUsed(), contentWithoutMostCommonlyUsed);
		assert.strictEqual(settings.getSettingsGroups(), groups);
		assert.deepStrictEqual(getRanges(settings), getRanges(expected));
	});

	test('refreshing setting groups invalidates previously cached JSON content', () => {
		const config: IConfigurationNode = {
			id: 'refreshedSettings',
			title: 'Refreshed Settings',
			properties: {
				'test.refreshedSetting': { type: 'string', default: 'value' }
			}
		};
		const settings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const previousContent = settings.getContent();
		configurationRegistry.registerConfiguration(config);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config])));

		const groups = settings.getSettingsGroups(true);
		assert.deepStrictEqual({
			content: Reflect.get(settings, '_content'),
			contentWithoutMostCommonlyUsed: Reflect.get(settings, '_contentWithoutMostCommonlyUsed')
		}, { content: undefined, contentWithoutMostCommonlyUsed: undefined });
		assert.notStrictEqual(settings.getContent(), previousContent);
		assert.ok(settings.getContentWithoutMostCommonlyUsed().includes('"test.refreshedSetting"'));
		assert.strictEqual(settings.getSettingsGroups(), groups);
	});

	test('preserves deprecation message presentation', () => {
		const config: IConfigurationNode = {
			id: 'deprecatedSettings',
			title: 'Deprecated Settings',
			type: 'object',
			properties: {
				'test.deprecatedSetting': {
					type: 'boolean',
					default: false,
					deprecationMessage: 'Use the replacement setting.',
					deprecationMessageSeverity: 'info',
					deprecationMessageShowInSettings: true
				}
			}
		};

		configurationRegistry.registerConfiguration(config);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const setting = defaultSettings.getRegisteredGroups()
			.flatMap(group => group.sections)
			.flatMap(section => section.settings)
			.find(setting => setting.key === 'test.deprecatedSetting');

		assert.deepStrictEqual({
			severity: setting?.deprecationMessageSeverity,
			showInSettings: setting?.deprecationMessageShowInSettings,
		}, { severity: 'info', showInSettings: true });
	});

	test('groups settings by title when they share the same extension id', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: 'config1',
			title: 'Group 1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: 'config2',
			title: 'Group 2',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 2, 'Should have 2 groups');
		assert.strictEqual(extensionGroups[0].title, 'Group 1');
		assert.strictEqual(extensionGroups[1].title, 'Group 2');

		assert.strictEqual(extensionGroups[0].sections[0].settings.length, 1);
		assert.strictEqual(extensionGroups[0].sections[0].settings[0].key, 'test.setting1');

		assert.strictEqual(extensionGroups[1].sections[0].settings.length, 1);
		assert.strictEqual(extensionGroups[1].sections[0].settings[0].key, 'test.setting2');
	});

	test('groups settings by id when they share the same extension id and have no title', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: 'group1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: 'group1',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 1, 'Should have 1 group');
		assert.strictEqual(extensionGroups[0].id, 'group1');
		assert.strictEqual(extensionGroups[0].sections[0].settings.length, 2);
	});

	test('separates groups with same id but different titles', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: 'group1',
			title: 'Title 1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: 'group1',
			title: 'Title 2',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 2, 'Should have 2 groups');
		assert.strictEqual(extensionGroups[0].title, 'Title 1');
		assert.strictEqual(extensionGroups[1].title, 'Title 2');
	});

	test('merges untitled group into titled group if id matches', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: 'group1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: 'group1',
			title: 'Title 1',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 1, 'Should have 1 group');
		assert.strictEqual(extensionGroups[0].title, 'Title 1');
		assert.strictEqual(extensionGroups[0].sections[0].settings.length, 2);
	});

	test('separates groups with same id and title but different extension ids', () => {
		const extensionId1 = 'test.extension1';
		const extensionId2 = 'test.extension2';
		const config1: IConfigurationNode = {
			id: 'group1',
			title: 'Title 1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId1 }
		};

		const config2: IConfigurationNode = {
			id: 'group1',
			title: 'Title 1',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId2 }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const group1 = groups.find(g => g.extensionInfo?.id === extensionId1);
		const group2 = groups.find(g => g.extensionInfo?.id === extensionId2);

		assert.ok(group1);
		assert.ok(group2);
		assert.notStrictEqual(group1, group2);
		assert.strictEqual(group1.title, 'Title 1');
		assert.strictEqual(group2.title, 'Title 1');
	});

	test('separates groups with same id (no title) but different extension ids', () => {
		const extensionId1 = 'test.extension1';
		const extensionId2 = 'test.extension2';
		const config1: IConfigurationNode = {
			id: 'group1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId1 }
		};

		const config2: IConfigurationNode = {
			id: 'group1',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId2 }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const group1 = groups.find(g => g.extensionInfo?.id === extensionId1);
		const group2 = groups.find(g => g.extensionInfo?.id === extensionId2);

		assert.ok(group1);
		assert.ok(group2);
		assert.notStrictEqual(group1, group2);
	});

	test('groups settings correctly when extension id is same as group id', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: extensionId,
			title: 'Group 1',
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: extensionId,
			title: 'Group 2',
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 2, 'Should have 2 groups');
		assert.strictEqual(extensionGroups[0].title, 'Group 1');
		assert.strictEqual(extensionGroups[1].title, 'Group 2');
	});

	test('sorts groups by order', () => {
		const extensionId = 'test.extension';
		const config1: IConfigurationNode = {
			id: 'group1',
			title: 'Group 1',
			order: 2,
			type: 'object',
			properties: {
				'test.setting1': {
					type: 'string',
					default: 'value1',
					description: 'Setting 1'
				}
			},
			extensionInfo: { id: extensionId }
		};

		const config2: IConfigurationNode = {
			id: 'group2',
			title: 'Group 2',
			order: 1,
			type: 'object',
			properties: {
				'test.setting2': {
					type: 'string',
					default: 'value2',
					description: 'Setting 2'
				}
			},
			extensionInfo: { id: extensionId }
		};

		configurationRegistry.registerConfiguration(config1);
		configurationRegistry.registerConfiguration(config2);
		disposables.add(toDisposable(() => configurationRegistry.deregisterConfigurations([config1, config2])));

		const defaultSettings = disposables.add(new DefaultSettings([], ConfigurationTarget.USER, configurationService));
		const groups = defaultSettings.getRegisteredGroups();

		const extensionGroups = groups.filter(g => g.extensionInfo?.id === extensionId);

		assert.strictEqual(extensionGroups.length, 2);
		assert.strictEqual(extensionGroups[0].title, 'Group 2');
		assert.strictEqual(extensionGroups[1].title, 'Group 1');
	});
});
