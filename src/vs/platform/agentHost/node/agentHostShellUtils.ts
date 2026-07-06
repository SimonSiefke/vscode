/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { posix as pathPosix, win32 as pathWin32 } from '../../../base/common/path.js';
import * as platform from '../../../base/common/platform.js';
const regexpZshExe = /^zsh(?:\.exe)?$/i;
const regexpZsh = /^zsh$/;


export function isZsh(shell: string): boolean {
	if (platform.OS === platform.OperatingSystem.Windows) {
		return regexpZshExe.test(pathWin32.basename(shell));
	}
	return regexpZsh.test(pathPosix.basename(shell));
}
