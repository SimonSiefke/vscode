/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexp1 = /\.[^/.]+$/;

const FILES_WITHOUT_EXTENSION = ['dockerfile', 'license', 'makefile', 'readme', 'procfile', 'gemfile', 'rakefile', 'jenkinsfile', 'vagrantfile'];
export function looksLikeDirectory(filePath: string): boolean {
	return regexp1.test(filePath) && FILES_WITHOUT_EXTENSION.indexOf(filePath.toLowerCase()) === -1;
}