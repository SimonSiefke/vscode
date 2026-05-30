/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CONTEXT_MENU_CHANNEL, CONTEXT_MENU_CLOSE_CHANNEL, IContextMenuEvent, IContextMenuItem, IPopupOptions, ISerializableContextMenuItem } from '../common/contextmenu.js';
import { ipcRenderer } from '../../sandbox/electron-browser/globals.js';

let contextMenuIdPool = 0;

export function popup(items: IContextMenuItem[], options?: IPopupOptions, onHide?: () => void): void {
	const processedItems: IContextMenuItem[] = [];

	const contextMenuId = contextMenuIdPool++;
	const onClickChannel = `vscode:onContextMenu${contextMenuId}`;
	let didDispose = false;
	function cleanup(): void {
		if (didDispose) {
			return;
		}

		didDispose = true;
		ipcRenderer.removeListener(CONTEXT_MENU_CLOSE_CHANNEL, onCloseChannelHandler);
		ipcRenderer.removeListener(onClickChannel, onClickChannelHandler);
		processedItems.length = 0;
	}

	const onClickChannelHandler = (_event: unknown, ...args: unknown[]) => {
		const itemId = args[0] as number;
		const context = args[1] as IContextMenuEvent;
		const item = processedItems[itemId];
		const click = item.click;
		cleanup();
		click?.(context);
	};

	ipcRenderer.once(onClickChannel, onClickChannelHandler);
	const onCloseChannelHandler = (_event: unknown, ...args: unknown[]) => {
		const closedContextMenuId = args[0] as number;
		if (closedContextMenuId !== contextMenuId) {
			return;
		}

		cleanup();

		onHide?.();
	};
	ipcRenderer.on(CONTEXT_MENU_CLOSE_CHANNEL, onCloseChannelHandler);

	ipcRenderer.send(CONTEXT_MENU_CHANNEL, contextMenuId, items.map(item => createItem(item, processedItems)), onClickChannel, options);
}

function createItem(item: IContextMenuItem, processedItems: IContextMenuItem[]): ISerializableContextMenuItem {
	const serializableItem: ISerializableContextMenuItem = {
		id: processedItems.length,
		label: item.label,
		type: item.type,
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
		visible: typeof item.visible === 'boolean' ? item.visible : true
	};

	processedItems.push(item);

	// Submenu
	if (Array.isArray(item.submenu)) {
		serializableItem.submenu = item.submenu.map(submenuItem => createItem(submenuItem, processedItems));
	}

	return serializableItem;
}
