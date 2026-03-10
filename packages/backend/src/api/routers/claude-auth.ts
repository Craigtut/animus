/**
 * Claude Auth Router -- tRPC procedures for Claude CLI OAuth flow.
 *
 * Delegates to the ClaudeAuthProvider from @animus-labs/agents,
 * with credential persistence via CredentialStoreAdapter.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import { createCredentialStore } from '../../services/credential-store-adapter.js';
import { removeCredential } from '../../services/credential-service.js';
import { ClaudeAuthProvider, type AuthFlowStatusUpdate } from '@animus-labs/agents';

const authProvider = new ClaudeAuthProvider();

export const claudeAuthRouter = router({
  /**
   * Initiate the Claude auth flow.
   * Spawns `claude auth login` which opens a browser for authentication.
   */
  initiate: protectedProcedure.mutation(async () => {
    const store = createCredentialStore(getSystemDb());
    return await authProvider.initiateAuth(store, 'cli');
  }),

  /**
   * Subscribe to real-time status updates for an active auth flow.
   * Emits AuthFlowStatusUpdate events via WebSocket.
   */
  status: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<AuthFlowStatusUpdate>((emit) => {
        const unsubscribe = authProvider.subscribeToAuthStatus(input.sessionId, (status) => {
          emit.next(status);

          if (status.status === 'success' || status.status === 'error' || status.status === 'cancelled') {
            setTimeout(() => {
              try { emit.complete(); } catch { /* controller already closed */ }
            }, 100);
          }
        });

        return unsubscribe;
      });
    }),

  /**
   * Cancel an in-progress auth flow.
   */
  cancel: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const cancelled = authProvider.cancelAuthFlow(input.sessionId);
      return { cancelled };
    }),

  /**
   * Sign out: run `claude auth logout` and remove stored credentials.
   */
  logout: protectedProcedure.mutation(async () => {
    const db = getSystemDb();
    const store = createCredentialStore(db);
    await authProvider.logout(store);
    removeCredential(db, 'claude', 'cli_detected');
    return { success: true };
  }),
});
