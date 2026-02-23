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

const getWsUrl = () => {
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

// Create WebSocket client for subscriptions
const wsClient = createWSClient({
  url: getWsUrl(),
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
