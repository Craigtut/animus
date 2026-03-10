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
//
// The token is set asynchronously (after an HTTP query completes), but
// tRPC's lazy WebSocket may open before the token is available (due to
// React StrictMode double-mount effects). We use a promise to make the
// connectionParams callback wait for the token.
let _wsAuthToken: string | null = null;
let _tokenResolve: ((token: string) => void) | null = null;
let _tokenPromise: Promise<string> | null = new Promise<string>((resolve) => {
  _tokenResolve = resolve;
});

/** Set the JWT token for WebSocket authentication via connectionParams. */
export function setWsAuthToken(token: string | null) {
  _wsAuthToken = token;
  if (token && _tokenResolve) {
    _tokenResolve(token);
    _tokenResolve = null;
    _tokenPromise = null;
  }
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
    // If the token is already available, return it immediately.
    // Otherwise, wait for setWsAuthToken() to be called. This handles
    // the race where React StrictMode effects trigger the WS connection
    // before the auth token query has completed.
    if (_wsAuthToken) {
      return { token: _wsAuthToken };
    }
    if (_tokenPromise) {
      const token = await _tokenPromise;
      return { token };
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
