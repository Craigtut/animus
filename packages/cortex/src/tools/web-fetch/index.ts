/**
 * WebFetch tool: fetch a web page and return its content as processed text.
 *
 * Two-model architecture:
 * 1. Fetch: HTTP request via Node built-in fetch
 * 2. Convert: HTML to markdown via Turndown
 * 3. Summarize: utility model answers the prompt using the page content
 *
 * The main agent never sees raw page content.
 *
 * Reference: docs/cortex/tools/web-fetch.md
 */

import { Type, type Static } from '@sinclair/typebox';
import type { ToolContentDetails } from '../../types.js';
import { WebFetchCache } from './cache.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const WebFetchParams = Type.Object({
  url: Type.String({ description: 'The URL to fetch. HTTP auto-upgraded to HTTPS.' }),
  prompt: Type.String({ description: 'A question or instruction about what to extract from the page.' }),
});

export type WebFetchParamsType = Static<typeof WebFetchParams>;

// ---------------------------------------------------------------------------
// Details type
// ---------------------------------------------------------------------------

export interface WebFetchDetails {
  finalUrl: string;
  statusCode: number;
  cacheHit: boolean;
  rawSize: number;
  markdownSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = 30_000;
const DEFAULT_MAX_PER_LOOP = 20;
const MAX_CONTENT_TOKENS = 25_000; // approximate token limit for summarization
const USER_AGENT = 'AnimusCortex/1.0 (web-fetch tool)';

/**
 * Private IP ranges to reject.
 */
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^localhost$/i,
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WebFetchToolConfig {
  /** Utility model completion function for summarization. */
  utilityComplete?: ((context: unknown) => Promise<unknown>) | undefined;
  /** Max fetches per agentic loop. */
  maxPerLoop?: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a URL, rejecting dangerous schemes and private IPs.
 */
function validateUrl(urlStr: string): { valid: boolean; reason?: string | undefined; url?: URL | undefined } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Reject non-HTTP(S) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, reason: `URL scheme "${url.protocol}" is not allowed. Only http: and https: are supported.` };
  }

  // Auto-upgrade HTTP to HTTPS
  if (url.protocol === 'http:') {
    url = new URL(urlStr.replace(/^http:/, 'https:'));
  }

  // Check for private IP ranges
  const hostname = url.hostname;
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: `URL rejected: private/local network address (${hostname})` };
    }
  }

  return { valid: true, url };
}

/**
 * Strip HTML elements that are not useful for content extraction.
 * This is a simple regex-based approach for removing script, style,
 * nav, footer, and header elements before Turndown conversion.
 */
function stripBoilerplateHtml(html: string): string {
  // Remove script, style, nav, footer, header, aside, noscript
  const tagsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg'];
  let cleaned = html;
  for (const tag of tagsToRemove) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
    // Also remove self-closing variants
    cleaned = cleaned.replace(new RegExp(`<${tag}[^>]*/>`, 'gi'), '');
  }
  return cleaned;
}

/**
 * Convert HTML to plain text markdown-like format.
 * Simple built-in converter (Turndown would be better but requires a dependency).
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove all tags except some structural ones
  // First handle headings
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, content) => {
    const prefix = '#'.repeat(Number(level));
    return `\n${prefix} ${content.trim()}\n`;
  });

  // Handle links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Handle lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<[uo]l[^>]*>/gi, '\n');
  text = text.replace(/<\/[uo]l>/gi, '\n');

  // Handle paragraphs and line breaks
  text = text.replace(/<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Handle emphasis
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Handle code blocks
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Handle tables minimally
  text = text.replace(/<tr[^>]*>/gi, '\n');
  text = text.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, '$1 | ');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Truncate text to approximately maxTokens tokens.
 * Uses a rough estimate of 1 token per 4 characters.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[Content truncated for summarization]';
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createWebFetchTool(config: WebFetchToolConfig): {
  name: string;
  description: string;
  parameters: typeof WebFetchParams;
  execute: (params: WebFetchParamsType) => Promise<ToolContentDetails<WebFetchDetails>>;
  /** Reset the per-loop rate counter. Called at the start of each loop. */
  resetRateLimit: () => void;
  /** Get the underlying cache (for testing/diagnostics). */
  getCache: () => WebFetchCache;
} {
  const cache = new WebFetchCache();
  const maxPerLoop = config.maxPerLoop ?? DEFAULT_MAX_PER_LOOP;
  let fetchesThisLoop = 0;

  return {
    name: 'WebFetch',
    description: 'Fetch a web page and return a summarized answer to your question about its content.',
    parameters: WebFetchParams,

    resetRateLimit() {
      fetchesThisLoop = 0;
    },

    getCache() {
      return cache;
    },

    async execute(params: WebFetchParamsType): Promise<ToolContentDetails<WebFetchDetails>> {
      // URL validation
      const validation = validateUrl(params.url);
      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `URL rejected: ${validation.reason}` }],
          details: {
            finalUrl: params.url,
            statusCode: 0,
            cacheHit: false,
            rawSize: 0,
            markdownSize: 0,
          },
        };
      }

      const url = validation.url!;
      const urlStr = url.toString();

      // Check cache (cached responses don't count against rate limit)
      const cached = cache.get(urlStr);
      if (cached) {
        // Still need to summarize with the user's prompt
        const summary = await summarize(
          cached.content,
          params.prompt,
          config.utilityComplete,
        );

        return {
          content: [{ type: 'text', text: summary }],
          details: {
            finalUrl: cached.finalUrl,
            statusCode: cached.statusCode,
            cacheHit: true,
            rawSize: 0,
            markdownSize: cached.content.length,
          },
        };
      }

      // Rate limit check (only for non-cached fetches)
      if (fetchesThisLoop >= maxPerLoop) {
        return {
          content: [{ type: 'text', text: `WebFetch rate limit reached (${maxPerLoop} per loop). Wait for the next loop or use Bash with curl for direct access.` }],
          details: {
            finalUrl: urlStr,
            statusCode: 0,
            cacheHit: false,
            rawSize: 0,
            markdownSize: 0,
          },
        };
      }

      fetchesThisLoop++;

      // Fetch the URL (manual redirect to detect cross-host redirects)
      let response: Response;
      let currentUrl = urlStr;
      const maxRedirects = 10;
      let redirectCount = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

          response = await fetch(currentUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': USER_AGENT,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'manual',
          });

          clearTimeout(timeoutId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('abort')) {
            return {
              content: [{ type: 'text', text: `Request timed out: ${currentUrl}` }],
              details: { finalUrl: currentUrl, statusCode: 0, cacheHit: false, rawSize: 0, markdownSize: 0 },
            };
          }
          if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
            const hostname = url.hostname;
            return {
              content: [{ type: 'text', text: `Could not resolve host: ${hostname}` }],
              details: { finalUrl: currentUrl, statusCode: 0, cacheHit: false, rawSize: 0, markdownSize: 0 },
            };
          }
          if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('TLS')) {
            return {
              content: [{ type: 'text', text: `SSL certificate error for ${currentUrl}` }],
              details: { finalUrl: currentUrl, statusCode: 0, cacheHit: false, rawSize: 0, markdownSize: 0 },
            };
          }
          return {
            content: [{ type: 'text', text: `Failed to fetch ${currentUrl}: ${msg}` }],
            details: { finalUrl: currentUrl, statusCode: 0, cacheHit: false, rawSize: 0, markdownSize: 0 },
          };
        }

        // Handle redirects (3xx status)
        const status = response.status;
        if (status >= 300 && status < 400) {
          const location = response.headers.get('location');
          if (!location) break; // No Location header, treat as final response

          // Resolve relative redirect URLs
          const redirectUrl = new URL(location, currentUrl).toString();
          const currentHost = new URL(currentUrl).hostname;
          const redirectHost = new URL(redirectUrl).hostname;

          // Cross-host redirect: inform the model instead of following
          if (redirectHost !== currentHost) {
            return {
              content: [{ type: 'text', text: `This URL redirects to ${redirectUrl}. Make a new WebFetch request with this URL.` }],
              details: {
                finalUrl: redirectUrl,
                statusCode: status,
                cacheHit: false,
                rawSize: 0,
                markdownSize: 0,
              },
            };
          }

          // Same-host redirect: follow it
          redirectCount++;
          if (redirectCount > maxRedirects) {
            return {
              content: [{ type: 'text', text: `Too many redirects (${maxRedirects}) for ${urlStr}` }],
              details: { finalUrl: currentUrl, statusCode: status, cacheHit: false, rawSize: 0, markdownSize: 0 },
            };
          }
          currentUrl = redirectUrl;
          continue;
        }

        // Not a redirect, break out of the loop
        break;
      }

      const finalUrl = currentUrl;
      const statusCode = response!.status;

      // Handle HTTP errors
      if (statusCode === 404) {
        return {
          content: [{ type: 'text', text: `Page not found: ${urlStr}` }],
          details: { finalUrl, statusCode, cacheHit: false, rawSize: 0, markdownSize: 0 },
        };
      }
      if (statusCode === 403) {
        return {
          content: [{ type: 'text', text: `Access forbidden: ${urlStr}. This may require authentication. Check if an MCP tool provides access.` }],
          details: { finalUrl, statusCode, cacheHit: false, rawSize: 0, markdownSize: 0 },
        };
      }
      if (statusCode >= 500) {
        return {
          content: [{ type: 'text', text: `Server error (${statusCode}): ${urlStr}` }],
          details: { finalUrl, statusCode, cacheHit: false, rawSize: 0, markdownSize: 0 },
        };
      }

      // Read body
      const rawBody = await response.text();
      const rawSize = rawBody.length;

      // Determine content type
      const contentType = response.headers.get('content-type') ?? '';
      let markdown: string;

      if (contentType.includes('application/json')) {
        // JSON: return as-is
        markdown = rawBody;
      } else if (contentType.includes('text/plain')) {
        // Plain text: return as-is
        markdown = rawBody;
      } else {
        // HTML: strip boilerplate and convert
        const cleaned = stripBoilerplateHtml(rawBody);
        markdown = htmlToText(cleaned);
      }

      // Check for JavaScript-only pages
      if (markdown.trim().length < 100 && rawBody.includes('<script')) {
        return {
          content: [{ type: 'text', text: 'The page appears to require JavaScript to render. No extractable content found.' }],
          details: { finalUrl, statusCode, cacheHit: false, rawSize, markdownSize: markdown.length },
        };
      }

      // Cache the result
      cache.set(urlStr, {
        content: markdown,
        fetchedAt: Date.now(),
        statusCode,
        finalUrl,
      });

      // Summarize with utility model
      const summary = await summarize(markdown, params.prompt, config.utilityComplete);

      return {
        content: [{ type: 'text', text: summary }],
        details: {
          finalUrl,
          statusCode,
          cacheHit: false,
          rawSize,
          markdownSize: markdown.length,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

/**
 * Summarize page content using the utility model.
 * Falls back to truncated content if the utility model is unavailable.
 */
async function summarize(
  content: string,
  prompt: string,
  utilityComplete?: (context: unknown) => Promise<unknown>,
): Promise<string> {
  const truncated = truncateToTokens(content, MAX_CONTENT_TOKENS);

  if (!utilityComplete) {
    // No utility model available; return truncated content directly
    return `[WebFetch: utility model not available. Returning raw content.]\n\n${truncated}`;
  }

  try {
    const result = await utilityComplete({
      systemPrompt: 'You are a web content analyst. Answer the user\'s question based on the provided web page content. Be concise and focused. If the content doesn\'t contain the answer, say so.',
      messages: [
        {
          role: 'user',
          content: `Question: ${prompt}\n\nWeb page content:\n${truncated}`,
        },
      ],
    });

    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && 'text' in result) {
      const textValue = (result as Record<string, unknown>)['text'];
      if (typeof textValue === 'string') return textValue;
    }

    return `[Summarization produced unexpected result type]\n\n${truncated.slice(0, 2000)}`;
  } catch {
    // Summarization failed, return truncated content
    return `[WebFetch: summarization failed. Returning raw content.]\n\n${truncated}`;
  }
}
