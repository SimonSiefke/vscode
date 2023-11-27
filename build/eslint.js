/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import vfs from 'vinyl-fs';
import { eslintFilter } from './filters.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function eslint() {
	const gulpeslint = require('gulp-eslint');
	return vfs
		.src(eslintFilter, { base: '.', follow: true, allowEmpty: true })
		.pipe(
			gulpeslint({
				configFile: '.eslintrc.json'
			})
		)
		.pipe(gulpeslint.formatEach('compact'))
		.pipe(
			gulpeslint.results((results) => {
				if (results.warningCount > 0 || results.errorCount > 0) {
					throw new Error('eslint failed with warnings and/or errors');
				}
			})
		).pipe(es.through(function () { /* noop, important for the stream to end */ }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	eslint().on('error', (err) => {
		console.error();
		console.error(err);
		process.exit(1);
	});
}
