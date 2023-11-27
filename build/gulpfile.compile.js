/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import * as util from './lib/util.js';
import * as task from './lib/task.js';
import * as compilation from './lib/compilation.js';
import * as optimize from './lib/optimize.js';

function makeCompileBuildTask(disableMangle) {
	return task.series(
		util.rimraf('out-build'),
		util.buildWebNodePaths('out-build'),
		compilation.compileApiProposalNamesTask,
		compilation.compileTask('src', 'out-build', true, { disableMangle }),
		optimize.optimizeLoaderTask('out-build', 'out-build', true)
	);
}

// Full compile, including nls and inline sources in sourcemaps, mangling, minification, for build
export const compileBuildTask = task.define('compile-build', makeCompileBuildTask(false));
gulp.task(compileBuildTask);

// Full compile for PR ci, e.g no mangling
export const compileBuildTaskPullRequest = task.define('compile-build-pr', makeCompileBuildTask(true));
gulp.task(compileBuildTaskPullRequest);
