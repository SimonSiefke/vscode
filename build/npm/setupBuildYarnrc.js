/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

// make sure we install the deps of build for the system installed
// node, since that is the driver of gulp
function setupBuildYarnrc() {
	const yarnrcPath = path.join(path.dirname(__dirname), '.yarnrc');
	const yarnrc = `disturl "https://nodejs.org/download/release"
target "${process.versions.node}"
runtime "node"
arch "${process.arch}"`;

	fs.writeFileSync(yarnrcPath, yarnrc, 'utf8');
}

exports.setupBuildYarnrc = setupBuildYarnrc;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	setupBuildYarnrc();
}
