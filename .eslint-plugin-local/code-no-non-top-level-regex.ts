/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as ESTree from 'estree';

const message = 'Regular expressions should be hoisted to module scope.';

type RegexLiteral = ESTree.Literal & { regex?: unknown };

export default new class NoNonTopLevelRegex implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		docs: {
			description: 'Disallows regular expression literals outside module top-level scope.',
		},
		messages: {
			noNonTopLevelRegex: message,
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		function checkRegexLiteral(node: RegexLiteral): void {
			if (!node.regex) {
				return;
			}

			if (context.sourceCode.getAncestors(node as ESTree.Node).some(isNonTopLevelScope)) {
				context.report({
					node: node as ESTree.Node,
					messageId: 'noNonTopLevelRegex',
				});
			}
		}

		return {
			Literal: (node: ESTree.Literal) => checkRegexLiteral(node),
		};
	}
};

function isNonTopLevelScope(node: ESTree.Node): boolean {
	return node.type === 'FunctionDeclaration'
		|| node.type === 'FunctionExpression'
		|| node.type === 'ArrowFunctionExpression'
		|| node.type === 'MethodDefinition'
		|| node.type === 'PropertyDefinition'
		|| node.type === 'StaticBlock';
}
