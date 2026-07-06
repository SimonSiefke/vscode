/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Uri } from 'vscode';
const regexpVscodeDev = /(?:^|\.)vscode\.dev$/;
const regexpGithubDev = /(?:^|\.)github\.dev$/;
const regexpLocalhost = /^localhost:\d+$/;
const regexp4 = /^127\.0\.0\.1:\d+$/;


export const DEFAULT_REDIRECT_URI = 'https://vscode.dev/redirect';

const VALID_DESKTOP_CALLBACK_SCHEMES = [
	'vscode',
	'vscode-insiders',
	'vscode-exploration',
	'vscode-agents',
	'vscode-agents-insiders',
	'vscode-agents-exploration',
	// On Windows, some browsers don't seem to redirect back to OSS properly.
	// As a result, you get stuck in the auth flow. We exclude this from the
	// list until we can figure out a way to fix this behavior in browsers.
	// 'code-oss',
	'vscode-wsl',
];

export function isSupportedClient(uri: Uri): boolean {
	return (
		VALID_DESKTOP_CALLBACK_SCHEMES.includes(uri.scheme) ||
		// vscode.dev & insiders.vscode.dev
		regexpVscodeDev.test(uri.authority) ||
		// github.dev & codespaces
		regexpGithubDev.test(uri.authority) ||
		// localhost
		regexpLocalhost.test(uri.authority) ||
		// 127.0.0.1
		regexp4.test(uri.authority)
	);
}
