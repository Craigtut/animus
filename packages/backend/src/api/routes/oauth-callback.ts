/**
 * OAuth Callback Route — Native Fastify route for plugin OAuth redirect handling.
 *
 * Bypasses tRPC because OAuth providers redirect the browser here with
 * query parameters (code, state). This must be a standard HTTP GET endpoint.
 *
 *   GET /api/oauth/callback?code=...&state=...
 *
 * Renders the shared Animus-branded callback page (see lib/oauth-callback-page.ts),
 * the same template used for model-provider OAuth, so plugin and provider
 * sign-in look identical.
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../lib/logger.js';
import { renderOAuthCallbackPage } from '../../lib/oauth-callback-page.js';

const log = createLogger('OAuthCallback', 'auth');

export async function registerOAuthCallbackRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/oauth/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query as Record<string, string>;

    if (error) {
      const errorMsg = error_description || error;
      log.warn(`OAuth callback received error: ${errorMsg}`);
      return reply.type('text/html').send(
        renderOAuthCallbackPage({
          status: 'error',
          title: 'Authorization failed',
          message: 'The provider returned an error while connecting.',
          details: errorMsg,
        }),
      );
    }

    if (!code || !state) {
      log.warn('OAuth callback missing code or state parameter');
      return reply.type('text/html').send(
        renderOAuthCallbackPage({
          status: 'error',
          title: 'Invalid callback',
          message: 'Missing code or state parameter. Please try connecting again from Animus.',
        }),
      );
    }

    try {
      const { handleCallback } = await import('../../services/plugin-oauth.js');
      await handleCallback(state, code);
      return reply.type('text/html').send(
        renderOAuthCallbackPage({ status: 'success' }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('OAuth callback handler failed:', err);
      return reply.type('text/html').send(
        renderOAuthCallbackPage({
          status: 'error',
          title: 'Connection failed',
          message: 'Animus could not complete the connection.',
          details: message,
        }),
      );
    }
  });
}
