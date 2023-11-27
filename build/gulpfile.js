/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'node:events'
import gulp from 'gulp';
import * as util from './lib/util.js';
import * as task from './lib/task.js';
import { transpileTask, compileTask, watchTask, compileApiProposalNamesTask, watchApiProposalNamesTask } from './lib/compilation.js';
import { monacoTypecheckTask/* , monacoTypecheckWatchTask */ } from './gulpfile.editor.js';
import { compileExtensionsTask, watchExtensionsTask, compileExtensionMediaTask } from './gulpfile.extensions.js';
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url))

// Increase max listeners for event emitters
EventEmitter.defaultMaxListeners = 100;

// API proposal names
gulp.task(compileApiProposalNamesTask);
gulp.task(watchApiProposalNamesTask);

// SWC Client Transpile
export const transpileClientSWCTask = task.define('transpile-client-swc', task.series(util.rimraf('out'), util.buildWebNodePaths('out'), transpileTask('src', 'out', true)));
gulp.task(transpileClientSWCTask);

// Transpile only
export const transpileClientTask = task.define('transpile-client', task.series(util.rimraf('out'), util.buildWebNodePaths('out'), transpileTask('src', 'out')));
gulp.task(transpileClientTask);

// Fast compile for development time
export const compileClientTask = task.define('compile-client', task.series(util.rimraf('out'), util.buildWebNodePaths('out'), compileApiProposalNamesTask, compileTask('src', 'out', false)));
gulp.task(compileClientTask);

export const watchClientTask = task.define('watch-client', task.series(util.rimraf('out'), util.buildWebNodePaths('out'), task.parallel(watchTask('out', false), watchApiProposalNamesTask)));
gulp.task(watchClientTask);

// All
const _compileTask = task.define('compile', task.parallel(monacoTypecheckTask, compileClientTask, compileExtensionsTask, compileExtensionMediaTask));
gulp.task(_compileTask);

gulp.task(task.define('watch', task.parallel(/* monacoTypecheckWatchTask, */ watchClientTask, watchExtensionsTask)));

// Default
gulp.task('default', _compileTask);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	process.exit(1);
});

// Load all the gulpfiles only if running tasks other than the editor tasks
require('glob').sync('gulpfile.*.js', { cwd: __dirname })
	.forEach(f => require(`./${f}`));
