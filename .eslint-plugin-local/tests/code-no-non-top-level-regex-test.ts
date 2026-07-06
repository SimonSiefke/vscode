/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const topLevelRegex = /top-level/;

export const exportedTopLevelRegex = /exported/;

const topLevelContainer = {
	regex: /object-literal/,
	nested: [
		/array-literal/,
	],
};

export function validUsage(value: string): boolean {
	return topLevelRegex.test(value)
		|| exportedTopLevelRegex.test(value)
		|| topLevelContainer.regex.test(value)
		|| topLevelContainer.nested[0].test(value);
}

export function invalidFunction(value: string): boolean {
	// eslint-disable-next-line local/code-no-non-top-level-regex
	return /function/.test(value);
}

export const invalidArrowFunction = (value: string): boolean => {
	// eslint-disable-next-line local/code-no-non-top-level-regex
	return /arrow-function/.test(value);
};

export class InvalidRegexInClass {

	// eslint-disable-next-line local/code-no-non-top-level-regex
	private readonly field = /field/;

	// eslint-disable-next-line local/code-no-non-top-level-regex
	private static readonly staticField = /static-field/;

	static {
		// eslint-disable-next-line local/code-no-non-top-level-regex
		/static-block/.test('static-block');
	}

	constructor(value =
		// eslint-disable-next-line local/code-no-non-top-level-regex
		/constructor-default/.source
	) {
		// eslint-disable-next-line local/code-no-non-top-level-regex
		/constructor/.test(value);
	}

	method(value: string): boolean {
		// eslint-disable-next-line local/code-no-non-top-level-regex
		return /method/.test(value);
	}
}
