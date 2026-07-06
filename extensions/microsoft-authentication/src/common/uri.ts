/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { env, UIKind, Uri } from 'vscode';
const regexpHttps = /^https?$/i;
const regexpVscodeDev = /(?:^|\.)vscode\.dev$/;
const regexpGithubDev = /(?:^|\.)github\.dev$/;
const regexpGithubLocalhost = /(?:^|\.)github\.localhost$/;


const LOCALHOST_ADDRESSES = ['localhost', '127.0.0.1', '0:0:0:0:0:0:0:1', '::1'];
function isLocalhost(uri: Uri): boolean {
	if (!regexpHttps.test(uri.scheme)) {
		return false;
	}
	const host = uri.authority.split(':')[0];
	return LOCALHOST_ADDRESSES.indexOf(host) >= 0;
}

export function isSupportedEnvironment(uri: Uri): boolean {
	if (env.uiKind === UIKind.Desktop) {
		return true;
	}
	// local development (localhost:* or 127.0.0.1:*)
	if (isLocalhost(uri)) {
		return true;
	}
	// At this point we should only ever see https
	if (uri.scheme !== 'https') {
		return false;
	}

	return (
		// vscode.dev & insiders.vscode.dev
		regexpVscodeDev.test(uri.authority) ||
		// github.dev & codespaces
		regexpGithubDev.test(uri.authority) ||
		// github.dev/codespaces local setup (github.localhost)
		regexpGithubLocalhost.test(uri.authority)
	);
}
