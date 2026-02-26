/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseUrl, Url } from 'url';
import type * as http from 'http';
import type * as https from 'https';
import { isBoolean } from '../../../base/common/types.js';

export type Agent = http.Agent | https.Agent | null;

type DisposableAgent = NonNullable<Agent> & {
	destroy?: () => void;
	close?: () => void;
};

const MAX_CACHED_PROXY_AGENTS = 32;
const cachedProxyAgents = new Map<string, DisposableAgent>();

function disposeAgent(agent: DisposableAgent): void {
	agent.destroy?.();
	agent.close?.();
}

function cacheProxyAgent(key: string, agent: DisposableAgent): DisposableAgent {
	cachedProxyAgents.set(key, agent);
	if (cachedProxyAgents.size > MAX_CACHED_PROXY_AGENTS) {
		const oldest = cachedProxyAgents.entries().next().value;
		if (oldest) {
			const [oldestKey, oldestAgent] = oldest;
			cachedProxyAgents.delete(oldestKey);
			disposeAgent(oldestAgent);
		}
	}
	return agent;
}

export function disposeCachedProxyAgents(): void {
	for (const agent of cachedProxyAgents.values()) {
		disposeAgent(agent);
	}
	cachedProxyAgents.clear();
}

function getSystemProxyURI(requestURL: Url, env: typeof process.env): string | null {
	if (requestURL.protocol === 'http:') {
		return env.HTTP_PROXY || env.http_proxy || null;
	} else if (requestURL.protocol === 'https:') {
		return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
	}

	return null;
}

export interface IOptions {
	proxyUrl?: string;
	strictSSL?: boolean;
}

export async function getProxyAgent(rawRequestURL: string, env: typeof process.env, options: IOptions = {}): Promise<Agent> {
	const requestURL = parseUrl(rawRequestURL);
	const proxyURL = options.proxyUrl || getSystemProxyURI(requestURL, env);

	if (!proxyURL) {
		return null;
	}

	const proxyEndpoint = parseUrl(proxyURL);

	if (!/^https?:$/.test(proxyEndpoint.protocol || '')) {
		return null;
	}

	const strictSSL = isBoolean(options.strictSSL) ? options.strictSSL : true;
	const cacheKey = `${requestURL.protocol || ''}|${proxyURL}|${strictSSL}`;
	const cachedAgent = cachedProxyAgents.get(cacheKey);
	if (cachedAgent) {
		return cachedAgent;
	}

	const opts = {
		host: proxyEndpoint.hostname || '',
		port: (proxyEndpoint.port ? +proxyEndpoint.port : 0) || (proxyEndpoint.protocol === 'https' ? 443 : 80),
		auth: proxyEndpoint.auth,
		rejectUnauthorized: strictSSL,
	};

	if (requestURL.protocol === 'http:') {
		const { default: mod } = await import('http-proxy-agent');
		const agent = new mod.HttpProxyAgent(proxyURL, opts);
		if (env['VSCODE_LOG_PROXY_AGENT_CREATION_STACK'] === 'true') {
			console.warn(`[proxy-agent] create HttpProxyAgent request=${rawRequestURL} proxy=${proxyURL}\n${new Error().stack ?? ''}`);
		}
		return cacheProxyAgent(cacheKey, agent);
	} else {
		const { default: mod } = await import('https-proxy-agent');
		const agent = new mod.HttpsProxyAgent(proxyURL, opts);
		if (env['VSCODE_LOG_PROXY_AGENT_CREATION_STACK'] === 'true') {
			console.warn(`[proxy-agent] create HttpsProxyAgent request=${rawRequestURL} proxy=${proxyURL}\n${new Error().stack ?? ''}`);
		}
		return cacheProxyAgent(cacheKey, agent);
	}
}
