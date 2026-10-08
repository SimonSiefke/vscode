/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clearMarks, mark } from '../../../base/common/performance.js';

/** Records the latest window lifecycle sample without changing other main-process startup marks. */
export function markWindowPerformance(name: string): void {
	clearMarks(name);
	mark(name);
}
