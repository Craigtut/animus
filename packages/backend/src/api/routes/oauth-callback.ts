/**
 * OAuth Callback Route — Native Fastify route for OAuth redirect handling.
 *
 * Bypasses tRPC because OAuth providers redirect the browser here with
 * query parameters (code, state). This must be a standard HTTP GET endpoint.
 *
 *   GET /api/oauth/callback?code=...&state=...
 *
 * On success, renders a simple HTML page telling the user to close the tab.
 * On failure, renders an error page with details.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('OAuthCallback', 'auth');

/**
 * Render a simple styled HTML page for the OAuth callback result.
 *
 * Uses dark theme colors matching Animus (dark background, warm accents).
 * On success, auto-closes the window after 3 seconds.
 */
function renderPage(title: string, message: string, isError: boolean): string {
  const bgColor = '#0f0f11';
  const textColor = '#e8e6e3';
  const accentColor = isError ? '#e55353' : '#7ec47e';
  const subtitleColor = '#8a8a8a';

  const autoCloseScript = isError
    ? ''
    : `<script>setTimeout(function() { window.close(); }, 3000);</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Animus</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${bgColor};
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      text-align: center;
      max-width: 420px;
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: ${accentColor};
      margin-bottom: 0.75rem;
    }
    p {
      font-size: 1rem;
      line-height: 1.5;
      color: ${subtitleColor};
    }
    .hint {
      margin-top: 1.5rem;
      font-size: 0.85rem;
      color: ${subtitleColor};
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${isError ? '&#10007;' : '&#10003;'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${isError ? '' : '<p class="hint">This window will close automatically.</p>'}
  </div>
  ${autoCloseScript}
</body>
</html>`;
}

/**
 * Basic HTML escaping to prevent XSS from error messages or query params.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function registerOAuthCallbackRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/oauth/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query as Record<string, string>;

    if (error) {
      const errorMsg = error_description || error;
      log.warn(`OAuth callback received error: ${errorMsg}`);
      return reply.type('text/html').send(
        renderPage('Authorization Failed', `The provider returned an error: ${errorMsg}`, true)
      );
    }

    if (!code || !state) {
      log.warn('OAuth callback missing code or state parameter');
      return reply.type('text/html').send(
        renderPage('Invalid Callback', 'Missing code or state parameter. Please try connecting again.', true)
      );
    }

    try {
      const { handleCallback } = await import('../../services/plugin-oauth.js');
      await handleCallback(state, code);
      return reply.type('text/html').send(
        renderPage('Connected!', 'You can close this tab and return to Animus.', false)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('OAuth callback handler failed:', err);
      return reply.type('text/html').send(
        renderPage('Connection Failed', message, true)
      );
    }
  });
}
