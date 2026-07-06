/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import fs from 'fs';
const regexp9a = /^[0-9a-f]{40}$/i;
const regexpRef = /^ref: (.*)$/;
const regexp9a1 = /^([0-9a-f]{40})\s+(.+)$/gm;


/**
 * Returns the sha1 commit version of a repository or undefined in case of failure.
 */
export function getVersion(repo: string): string | undefined {
	const git = path.join(repo, '.git');
	const headPath = path.join(git, 'HEAD');
	let head: string;

	try {
		head = fs.readFileSync(headPath, 'utf8').trim();
	} catch (e) {
		return undefined;
	}

	if (regexp9a.test(head)) {
		return head;
	}

	const refMatch = regexpRef.exec(head);

	if (!refMatch) {
		return undefined;
	}

	const ref = refMatch[1];
	const refPath = path.join(git, ref);

	try {
		return fs.readFileSync(refPath, 'utf8').trim();
	} catch (e) {
		// noop
	}

	const packedRefsPath = path.join(git, 'packed-refs');
	let refsRaw: string;

	try {
		refsRaw = fs.readFileSync(packedRefsPath, 'utf8').trim();
	} catch (e) {
		return undefined;
	}

	const refsRegex = new RegExp(regexp9a1.source, regexp9a1.flags);
	let refsMatch: RegExpExecArray | null;
	const refs: { [ref: string]: string } = {};

	while (refsMatch = refsRegex.exec(refsRaw)) {
		refs[refsMatch[2]] = refsMatch[1];
	}

	return refs[ref];
}
