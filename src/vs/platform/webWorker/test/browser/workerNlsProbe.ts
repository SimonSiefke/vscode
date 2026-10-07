/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bootstrapWebWorker } from '../../../../base/common/worker/webWorkerBootstrap.js';
import { getNLSLanguage, getNLSMessages } from '../../../../nls.js';

export interface IWorkerNlsProbe {
	$inspect(): { messages: string[]; language: string | undefined };
	$echo(value: string): string;
}

// Capture during module loading, before any client RPC is delivered.
const messages = getNLSMessages();
const language = getNLSLanguage();

bootstrapWebWorker(() => ({
	_requestHandlerBrand: undefined,
	$inspect: () => ({ messages, language }),
	$echo: (value: string) => value
}));
