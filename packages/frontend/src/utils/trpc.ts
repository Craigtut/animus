/**
 * tRPC Client Configuration
 *
 * Sets up the tRPC client with React Query integration.
 */

import { createTRPCReact } from '@trpc/react-query';
import { createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
import type { AppRouter } from '@animus/backend/src/api';

// Create the tRPC React hooks
export const trpc = createTRPCReact<AppRouter>();

// Determine the API URL based on environment
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // Browser: use relative path (will be proxied in dev, same origin in prod)
    return '';
  }
  // SSR: use localhost
  return 'http://localhost:3000';
};

const getWsUrl = () => {
  if (typeof window !== 'undefined') {
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
            credentials: 'include',
          });
        },
      }),
    }),
  ],
});
