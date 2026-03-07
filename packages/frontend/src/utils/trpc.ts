/**
 * tRPC Client Configuration
 *
 * Sets up the tRPC client with React Query integration.
 */

import { createTRPCReact } from '@trpc/react-query';
import type { CreateTRPCReact } from '@trpc/react-query';
import { createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
import type { AppRouter } from '@animus-labs/backend/src/api';

declare global {
  interface Window {
    __ANIMUS_API_URL__?: string;
  }
}

// Create the tRPC React hooks
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

// Determine the API URL based on environment
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // Tauri or custom API URL override (e.g. dynamic sidecar port)
    const override = window.__ANIMUS_API_URL__;
    if (override) return override;
    // Browser: use relative path (will be proxied in dev, same origin in prod)
    return '';
  }
  // SSR: use localhost
  return 'http://localhost:3000';
};

const getWsUrl = (): string => {
  if (typeof window !== 'undefined') {
    // Tauri or custom API URL override
    const override = window.__ANIMUS_API_URL__;
    if (override) {
      const url = new URL(override);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/api/trpc`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/trpc`;
  }
  return 'ws://localhost:3000/api/trpc';
};

// ── WebSocket auth token ──
// WKWebView on macOS doesn't reliably send HTTP cookies with WebSocket
// upgrade requests. tRPC's connectionParams sends the auth token as the
// first WebSocket message (not in the URL), so it never leaks to logs
// or proxies. The server waits for this message before creating the
// context, making it available via info.connectionParams.
let _wsAuthToken: string | null = null;

/** Set the JWT token for WebSocket authentication via connectionParams. */
export function setWsAuthToken(token: string | null) {
  _wsAuthToken = token;
}

// Create WebSocket client for subscriptions.
// connectionParams sends the auth token as the first message after
// connecting, which the server uses to authenticate the WS session.
// This works across all platforms (browser, Docker, Tauri/WKWebView).
const wsClient = createWSClient({
  url: getWsUrl,
  lazy: {
    enabled: true,
    closeMs: 0,
  },
  connectionParams: async () => {
    if (_wsAuthToken) {
      return { token: _wsAuthToken };
    }
    return null;
  },
});

// Create the tRPC client
export const trpcClient = trpc.createClient({
  links: [
    // Use splitLink to route subscriptions to WebSocket, everything else to HTTP
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
        // Include credentials for authentication
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: 'include' as const,
          } as RequestInit);
        },
      }),
    }),
  ],
});
