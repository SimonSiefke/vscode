/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
const regexp1 = /^\//;


export function toAgentHostBackendSessionUri(sessionResource: URI): URI | undefined {
	const scheme = sessionResource.scheme;
	const prefix = 'agent-host-';
	if (!scheme.startsWith(prefix)) {
		return undefined;
	}
	const provider = scheme.substring(prefix.length);
	if (!provider) {
		return undefined;
	}
	const rawId = sessionResource.path.replace(regexp1, '');
	return URI.from({ scheme: provider, path: `/${rawId}` });
}
