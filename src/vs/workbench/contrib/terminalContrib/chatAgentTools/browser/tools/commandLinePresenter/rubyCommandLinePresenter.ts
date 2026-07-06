/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from '../../../../../../../base/common/platform.js';
import { isPowerShell } from '../../runInTerminalHelpers.js';
import type { ICommandLinePresenter, ICommandLinePresenterOptions, ICommandLinePresenterResult } from './commandLinePresenter.js';
const regexpRubyCode = /^ruby\s+-e\s+"(?<code>.+)"$/s;
const regexp2 = /\\"/g;
const regexp3 = /`"/g;
const regexpRubyCode1 = /^ruby\s+-e\s+'(?<code>.+)'$/s;


/**
 * Command line presenter for Ruby inline commands (`ruby -e "..."`).
 * Extracts the Ruby code and sets up Ruby syntax highlighting.
 */
export class RubyCommandLinePresenter implements ICommandLinePresenter {
	present(options: ICommandLinePresenterOptions): ICommandLinePresenterResult | undefined {
		const commandLine = options.commandLine.forDisplay;
		const extractedRuby = extractRubyCommand(commandLine, options.shell, options.os);
		if (extractedRuby) {
			return {
				commandLine: extractedRuby,
				language: 'ruby',
				languageDisplayName: 'Ruby',
			};
		}
		return undefined;
	}
}

/**
 * Extracts the Ruby code from a `ruby -e "..."` or `ruby -e '...'` command,
 * returning the code with properly unescaped quotes.
 *
 * @param commandLine The full command line to parse
 * @param shell The shell path (to determine quote escaping style)
 * @param os The operating system
 * @returns The extracted Ruby code, or undefined if not a ruby -e command
 */
export function extractRubyCommand(commandLine: string, shell: string, os: OperatingSystem): string | undefined {
	// Match ruby -e "..." pattern (double quotes)
	const doubleQuoteMatch = commandLine.match(regexpRubyCode);
	if (doubleQuoteMatch?.groups?.code) {
		let rubyCode = doubleQuoteMatch.groups.code.trim();

		// Return undefined if the trimmed code is empty
		if (!rubyCode) {
			return undefined;
		}

		// Unescape quotes based on shell type
		if (isPowerShell(shell, os)) {
			// PowerShell uses backtick-quote (`") to escape quotes inside double-quoted strings
			rubyCode = rubyCode.replace(new RegExp(regexp3), '"');
		} else {
			// Bash/sh/zsh use backslash-quote (\")
			rubyCode = rubyCode.replace(new RegExp(regexp2), '"');
		}

		return rubyCode;
	}

	// Match ruby -e '...' pattern (single quotes)
	// Single quotes in bash/sh/zsh are literal - no escaping inside
	// Single quotes in PowerShell are also literal
	const singleQuoteMatch = commandLine.match(regexpRubyCode1);
	if (singleQuoteMatch?.groups?.code) {
		const rubyCode = singleQuoteMatch.groups.code.trim();

		// Return undefined if the trimmed code is empty
		if (!rubyCode) {
			return undefined;
		}

		return rubyCode;
	}

	return undefined;
}
