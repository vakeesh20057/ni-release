/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Web interaction tools for Power Mode: web search and enhanced web fetch.
 */

import { IPowerTool, IToolContext, IToolResult } from '../../common/powerModeTypes.js';
import { definePowerTool } from './powerToolRegistry.js';

// ─── Web Search Tool ─────────────────────────────────────────────────────────

interface ISearchResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * Parse DuckDuckGo HTML search results.
 */
function parseDDGResults(html: string, maxResults: number): ISearchResult[] {
	const results: ISearchResult[] = [];

	// DuckDuckGo HTML results are wrapped in result__a and result__snippet divs
	// Simple regex parsing since we don't have a DOM parser in service worker
	const resultPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)</g;

	let match;
	let count = 0;
	while ((match = resultPattern.exec(html)) !== null && count < maxResults) {
		const url = match[1];
		const title = _decodeHTMLEntities(match[2]);
		const snippet = _decodeHTMLEntities(match[3]);

		if (url && title) {
			results.push({ title, url, snippet: snippet || '' });
			count++;
		}
	}

	// Fallback: try alternative DuckDuckGo patterns
	if (results.length === 0) {
		const altPattern = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
		let altMatch;
		let altCount = 0;
		while ((altMatch = altPattern.exec(html)) !== null && altCount < maxResults) {
			results.push({
				title: _decodeHTMLEntities(altMatch[2]),
				url: altMatch[1],
				snippet: '',
			});
			altCount++;
		}
	}

	return results;
}

function _decodeHTMLEntities(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.trim();
}

export function createWebSearchTool(): IPowerTool {
	return definePowerTool(
		'web_search',
		`Search the web for current information using DuckDuckGo.

Rules:
- Use this to find up-to-date information, documentation, tutorials, etc.
- Returns titles, URLs, and snippets from search results
- Max results: 10
- Timeout: 30 seconds`,
		[
			{ name: 'query', type: 'string', description: 'The search query', required: true },
			{ name: 'maxResults', type: 'number', description: 'Maximum number of results (default: 5, max: 10)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const query = args.query as string;
			const maxResults = Math.min((args.maxResults as number) || 5, 10);

			ctx.metadata({ title: `Searching: ${query}` });

			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 30000);

				const encodedQuery = encodeURIComponent(query);
				const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

				const response = await fetch(searchUrl, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Neural-Inverse-Power-Mode/1.0',
					},
				});
				clearTimeout(timeoutId);

				if (!response.ok) {
					return {
						title: 'Search failed',
						output: `HTTP ${response.status}: ${response.statusText}`,
						metadata: { query, error: true, status: response.status },
					};
				}

				const html = await response.text();
				const results = parseDDGResults(html, maxResults);

				if (results.length === 0) {
					return {
						title: 'No results',
						output: `No search results found for: ${query}`,
						metadata: { query, count: 0 },
					};
				}

				// Format results
				const output = results.map((r, i) => {
					const snippetText = r.snippet ? `\n  ${r.snippet}` : '';
					return `${i + 1}. ${r.title}\n  ${r.url}${snippetText}`;
				}).join('\n\n');

				// Cap at 10KB
				const MAX_SIZE = 10 * 1024;
				const finalOutput = output.length > MAX_SIZE
					? output.substring(0, MAX_SIZE) + '\n[Results truncated at 10KB]'
					: output;

				return {
					title: `Found ${results.length} results`,
					output: finalOutput,
					metadata: { query, count: results.length },
				};
			} catch (err: any) {
				if (err.name === 'AbortError') {
					return {
						title: 'Search timeout',
						output: 'Search request timed out after 30 seconds',
						metadata: { query, error: true },
					};
				}

				return {
					title: 'Search error',
					output: `Error: ${err.message}`,
					metadata: { query, error: true },
				};
			}
		},
	);
}

// ─── Enhanced Web Fetch Tool ─────────────────────────────────────────────────

function stripHTMLTags(html: string): string {
	// Remove script and style blocks
	let cleaned = html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

	// Remove navigation, header, footer elements (common noise)
	cleaned = cleaned
		.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
		.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
		.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

	// Strip all remaining HTML tags
	cleaned = cleaned.replace(/<[^>]+>/g, ' ');

	// Decode HTML entities
	cleaned = _decodeHTMLEntities(cleaned);

	// Normalize whitespace
	cleaned = cleaned
		.replace(/\s+/g, ' ')
		.trim();

	return cleaned;
}

/**
 * Simple content filtering by selector concept (regex-based, no DOM parser).
 * This is a best-effort approximation of CSS selector behavior.
 */
function filterBySelector(html: string, selector: string): string {
	// Support simple selectors: id (#), class (.), tag name
	let pattern: RegExp | null = null;

	if (selector.startsWith('#')) {
		// ID selector: #myid
		const id = selector.substring(1);
		pattern = new RegExp(`<[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
	} else if (selector.startsWith('.')) {
		// Class selector: .myclass
		const cls = selector.substring(1);
		pattern = new RegExp(`<[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
	} else {
		// Tag selector: div, article, main, etc.
		pattern = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, 'i');
	}

	const match = pattern.exec(html);
	return match ? match[0] : html;
}

export function createEnhancedWebFetchTool(): IPowerTool {
	return definePowerTool(
		'web_fetch_enhanced',
		`Fetch and extract clean text content from a URL.

Rules:
- Fetches web pages and extracts readable text content
- Automatically strips scripts, styles, navigation elements
- Optional CSS selector to filter content (e.g., "article", ".content", "#main")
- Timeout: 30 seconds
- Download limit: 1MB
- Output limit: 50KB`,
		[
			{ name: 'url', type: 'string', description: 'The URL to fetch', required: true },
			{ name: 'selector', type: 'string', description: 'Optional CSS selector to filter content (e.g., "article", ".content")', required: false },
			{ name: 'maxLength', type: 'number', description: 'Optional max output length in characters (default: 50000)', required: false },
		],
		async (args: Record<string, any>, ctx: IToolContext): Promise<IToolResult> => {
			const url = args.url as string;
			const selector = args.selector as string | undefined;
			const maxLength = (args.maxLength as number) || 50000;

			ctx.metadata({ title: `Fetching: ${url}` });

			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 30000);

				const response = await fetch(url, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Neural-Inverse-Power-Mode/1.0',
					},
					redirect: 'follow',
				});
				clearTimeout(timeoutId);

				if (!response.ok) {
					return {
						title: 'Fetch failed',
						output: `HTTP ${response.status}: ${response.statusText}`,
						metadata: { url, error: true, status: response.status },
					};
				}

				const contentType = response.headers.get('content-type') || '';

				// Check content length
				const contentLength = response.headers.get('content-length');
				if (contentLength && parseInt(contentLength, 10) > 1024 * 1024) {
					return {
						title: 'Content too large',
						output: 'Content exceeds 1MB download limit',
						metadata: { url, error: true, size: contentLength },
					};
				}

				let content = await response.text();

				// Enforce download size limit
				const MAX_DOWNLOAD = 1024 * 1024; // 1MB
				if (content.length > MAX_DOWNLOAD) {
					content = content.substring(0, MAX_DOWNLOAD);
				}

				// Filter by selector if provided
				if (selector && contentType.includes('text/html')) {
					content = filterBySelector(content, selector);
				}

				// Strip HTML if content is HTML
				if (contentType.includes('text/html')) {
					content = stripHTMLTags(content);
				}

				// Truncate to max length
				if (content.length > maxLength) {
					content = content.substring(0, maxLength) + '\n[Content truncated]';
				}

				return {
					title: 'Fetched',
					output: content,
					metadata: {
						url,
						contentType,
						size: content.length,
						selector: selector || null,
					},
				};
			} catch (err: any) {
				if (err.name === 'AbortError') {
					return {
						title: 'Fetch timeout',
						output: 'Request timed out after 30 seconds',
						metadata: { url, error: true },
					};
				}

				return {
					title: 'Fetch error',
					output: `Error: ${err.message}`,
					metadata: { url, error: true },
				};
			}
		},
	);
}
