/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import es from 'event-stream';
import * as path from 'node:path';
import * as task from './lib/task.js';
import { hygiene } from './hygiene.js';
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {string} actualPath
 */
function checkPackageJSON(actualPath) {
	const actual = require(path.join(__dirname, '..', actualPath));
	const rootPackageJSON = require('../package.json');
	const checkIncluded = (set1, set2) => {
		for (const depName in set1) {
			const depVersion = set1[depName];
			const rootDepVersion = set2[depName];
			if (!rootDepVersion) {
				// missing in root is allowed
				continue;
			}
			if (depVersion !== rootDepVersion) {
				this.emit(
					'error',
					`The dependency ${depName} in '${actualPath}' (${depVersion}) is different than in the root package.json (${rootDepVersion})`
				);
			}
		}
	};

	checkIncluded(actual.dependencies, rootPackageJSON.dependencies);
	checkIncluded(actual.devDependencies, rootPackageJSON.devDependencies);
}

const checkPackageJSONTask = task.define('check-package-json', () => {
	return gulp.src('package.json').pipe(
		es.through(function () {
			checkPackageJSON.call(this, 'remote/package.json');
			checkPackageJSON.call(this, 'remote/web/package.json');
			checkPackageJSON.call(this, 'build/package.json');
		})
	);
});
gulp.task(checkPackageJSONTask);

const hygieneTask = task.define('hygiene', task.series(checkPackageJSONTask, () => hygiene(undefined, false)));
gulp.task(hygieneTask);
