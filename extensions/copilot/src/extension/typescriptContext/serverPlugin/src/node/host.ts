/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import crypto from 'crypto';

import { Hash, Host } from '../common/host';
const regexpInspectDebugBrk = /^--(?:inspect|debug)(?:-brk)?(?:=\d+)?$/i;



export class NodeHost implements Host {
	public constructor() {
	}

	public createHash(algorithm: string): Hash {
		return crypto.createHash(algorithm);
	}

	public isDebugging(): boolean {
		return process.execArgv.some((arg) => regexpInspectDebugBrk.test(arg));
	}
}