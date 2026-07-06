/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from '@vscode/copilot-api';
import { URI } from '../../../util/vs/base/common/uri';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IImageService } from '../common/imageService';
const regexpZAZ0 = /[^a-zA-Z0-9._-]/g;
const regexp2 = /^[^\/]+\/([^+;]+)/;


export class ImageServiceImpl implements IImageService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICAPIClientService private readonly capiClient: ICAPIClientService,
	) { }

	async uploadChatImageAttachment(binaryData: Uint8Array, name: string, mimeType: string | undefined, token: string | undefined): Promise<URI> {
		if (!mimeType || !token) {
			throw new Error('Missing required mimeType or token for image upload');
		}

		const sanitizedName = name.replace(regexpZAZ0, '');
		let uploadName = sanitizedName;

		// can catch unexpected types like "IMAGE/JPEG", "image/svg+xml", or "image/png; charset=UTF-8"
		const subtypeMatch = mimeType.toLowerCase().match(regexp2);
		const subtype = subtypeMatch?.[1];

		// add the extension if it is missing.
		if (subtype && !uploadName.toLowerCase().endsWith(`.${subtype}`)) {
			uploadName = `${uploadName}.${subtype}`;
		}

		try {
			const response = await this.capiClient.makeRequest<Response>({
				method: 'POST',
				body: binaryData,
				headers: {
					'Content-Type': 'application/octet-stream',
					Authorization: `Bearer ${token}`,
				}
			}, { type: RequestType.ChatAttachmentUpload, uploadName, mimeType });
			if (!response.ok) {
				throw new Error(`Image upload failed: ${response.status} ${response.statusText}`);
			}
			const result = await response.json() as { url: string };
			return URI.parse(result.url);
		} catch (error) {
			throw new Error(`Error uploading image: ${error}`);
		}
	}

	async resizeImage(data: Uint8Array, mimeType: string): Promise<{ data: Uint8Array; mimeType: string }> {
		return { data, mimeType };
	}
}
