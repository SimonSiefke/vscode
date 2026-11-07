/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';

interface IAuxiliaryWindowCloseTarget extends NodeJS.EventEmitter {
	readonly webContents: NodeJS.EventEmitter;
	close(): void;
}

/** Observe both native and renderer vetoes until the auxiliary window actually closes. */
export function closeAuxiliaryWindow(window: IAuxiliaryWindowCloseTarget): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const disposables = new DisposableStore();
		const complete = (closed: boolean) => {
			if (!disposables.isDisposed) {
				disposables.dispose();
				resolve(closed);
			}
		};
		disposables.add(Event.once(Event.fromNodeEventEmitter(window, 'closed'))(() => complete(true)));
		disposables.add(Event.fromNodeEventEmitter<{ readonly defaultPrevented: boolean }>(window, 'close')(event => {
			// Other main-process listeners, including quit coordination, can veto.
			queueMicrotask(() => { if (event.defaultPrevented) { complete(false); } });
		}));
		disposables.add(Event.fromNodeEventEmitter<{ readonly defaultPrevented: boolean }>(window.webContents, 'will-prevent-unload')(event => {
			queueMicrotask(() => { if (!event.defaultPrevented) { complete(false); } });
		}));
		try {
			window.close();
		} catch (error) {
			disposables.dispose();
			reject(error);
		}
	});
}
