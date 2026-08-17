/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderedMarkdown, MarkdownRenderOptions, renderMarkdown } from '../../../base/browser/markdownRenderer.js';
import { onUnexpectedError } from '../../../base/common/errors.js';
import { IMarkdownString, MarkdownStringTrustedOptions } from '../../../base/common/htmlContent.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IOpenerService } from '../../opener/common/opener.js';

/**
 * Renders markdown to HTML.
 *
 * This interface allows a upper level component to pass a custom markdown renderer to sub-components.
 *
 * If you want to render markdown content in a standard way, prefer using the {@linkcode IMarkdownRendererService}.
 */
export interface IMarkdownRenderer {
	render(markdown: IMarkdownString, options?: MarkdownRenderOptions, outElement?: HTMLElement): IRenderedMarkdown;
}

export interface IMarkdownRendererExtraOptions {
	/**
	 * The context in which the markdown is being rendered.
	 */
	readonly context?: unknown;
}

export interface IMarkdownCodeBlockRenderer {
	renderCodeBlock(languageAlias: string | undefined, value: string, options: IMarkdownRendererExtraOptions): Promise<HTMLElement>;
}

export type MarkdownCodeBlockRendererFactory = () => Promise<IMarkdownCodeBlockRenderer>;

export const IMarkdownRendererService = createDecorator<IMarkdownRendererService>('markdownRendererService');

/**
 * Service that renders markdown content in a standard manner.
 *
 * Unlike the lower-level {@linkcode renderMarkdown} function, this includes built-in support for features such as syntax
 * highlighting of code blocks and link handling.
 *
 * This service should be preferred for rendering markdown in most cases.
 */
export interface IMarkdownRendererService extends IMarkdownRenderer {
	readonly _serviceBrand: undefined;

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions & IMarkdownRendererExtraOptions, outElement?: HTMLElement): IRenderedMarkdown;

	setDefaultCodeBlockRenderer(renderer: IMarkdownCodeBlockRenderer | MarkdownCodeBlockRendererFactory): void;
}


export class MarkdownRendererService implements IMarkdownRendererService {
	declare readonly _serviceBrand: undefined;

	private _defaultCodeBlockRenderer: IMarkdownCodeBlockRenderer | MarkdownCodeBlockRendererFactory | undefined;
	private _defaultCodeBlockRendererPromise: Promise<IMarkdownCodeBlockRenderer> | undefined;

	constructor(
		@IOpenerService private readonly _openerService: IOpenerService,
	) { }

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions & IMarkdownRendererExtraOptions, outElement?: HTMLElement): IRenderedMarkdown {
		const resolvedOptions = { ...options };

		if (!resolvedOptions.actionHandler) {
			resolvedOptions.actionHandler = (link, mdStr) => {
				return openLinkFromMarkdown(this._openerService, link, mdStr.isTrusted);
			};
		}

		if (!resolvedOptions.codeBlockRenderer) {
			resolvedOptions.codeBlockRenderer = (alias, value) => {
				return this._renderCodeBlock(alias, value, resolvedOptions ?? {});
			};
		}

		const rendered = renderMarkdown(markdown, resolvedOptions, outElement);
		rendered.element.classList.add('rendered-markdown');
		return rendered;
	}

	setDefaultCodeBlockRenderer(renderer: IMarkdownCodeBlockRenderer | MarkdownCodeBlockRendererFactory): void {
		this._defaultCodeBlockRenderer = renderer;
		this._defaultCodeBlockRendererPromise = undefined;
	}

	private async _renderCodeBlock(languageAlias: string | undefined, value: string, options: IMarkdownRendererExtraOptions): Promise<HTMLElement> {
		const renderer = await this._getDefaultCodeBlockRenderer();
		return renderer?.renderCodeBlock(languageAlias, value, options) ?? document.createElement('span');
	}

	private async _getDefaultCodeBlockRenderer(): Promise<IMarkdownCodeBlockRenderer | undefined> {
		if (!this._defaultCodeBlockRenderer) {
			return undefined;
		}

		if (typeof this._defaultCodeBlockRenderer !== 'function') {
			return this._defaultCodeBlockRenderer;
		}

		this._defaultCodeBlockRendererPromise ??= this._defaultCodeBlockRenderer();
		const renderer = await this._defaultCodeBlockRendererPromise;
		this._defaultCodeBlockRenderer = renderer;
		return renderer;
	}
}

export async function openLinkFromMarkdown(openerService: IOpenerService, link: string, isTrusted: boolean | MarkdownStringTrustedOptions | undefined, skipValidation?: boolean): Promise<boolean> {
	try {
		return await openerService.open(link, {
			fromUserGesture: true,
			allowContributedOpeners: true,
			allowCommands: toAllowCommandsOption(isTrusted),
			skipValidation
		});
	} catch (e) {
		onUnexpectedError(e);
		return false;
	}
}

function toAllowCommandsOption(isTrusted: boolean | MarkdownStringTrustedOptions | undefined): boolean | readonly string[] {
	if (isTrusted === true) {
		return true; // Allow all commands
	}

	if (isTrusted && Array.isArray(isTrusted.enabledCommands)) {
		return isTrusted.enabledCommands; // Allow subset of commands
	}

	return false; // Block commands
}

registerSingleton(IMarkdownRendererService, MarkdownRendererService, InstantiationType.Delayed);
