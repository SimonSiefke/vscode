/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as es from 'event-stream';
import * as vfs from 'vinyl-fs';
import { stylelintFilter } from './filters.js';
import { getVariableNameValidator } from './lib/stylelint/validateVariableNames.js';

/** use regex on lines */
export function gulpstylelint(reporter) {
	const variableValidator = getVariableNameValidator();
	let errorCount = 0;
	return es.through(function (file) {
		const lines = file.__lines || file.contents.toString('utf8').split(/\r\n|\r|\n/);
		file.__lines = lines;

		lines.forEach((line, i) => {
			variableValidator(line, unknownVariable => {
				reporter(file.relative + '(' + (i + 1) + ',1): Unknown variable: ' + unknownVariable, true);
				errorCount++;
			});
		});

		this.emit('data', file);
	}, function () {
		if (errorCount > 0) {
			reporter('All valid variable names are in `build/lib/stylelint/vscode-known-variables.json`\nTo update that file, run `./scripts/test-documentation.sh|bat.`', false);
		}
		this.emit('end');
	}
	);
}

function stylelint() {
	return vfs
		.src(stylelintFilter, { base: '.', follow: true, allowEmpty: true })
		.pipe(gulpstylelint((message, isError) => {
			if (isError) {
				console.error(message);
			} else {
				console.info(message);
			}
		}))
		.pipe(es.through(function () { /* noop, important for the stream to end */ }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	stylelint().on('error', (err) => {
		console.error();
		console.error(err);
		process.exit(1);
	});
}
