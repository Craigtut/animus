/**
 * Codex CLI Auth Router -- tRPC procedures for Codex CLI auth flow.
 *
 * Delegates to the CodexAuthProvider from @animus-labs/agents,
 * with credential persistence via CredentialStoreAdapter.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import { createCredentialStore } from '../../services/credential-store-adapter.js';
import { removeCredential } from '../../services/credential-service.js';
import { CodexAuthProvider, type AuthFlowStatusUpdate } from '@animus-labs/agents';

const authProvider = new CodexAuthProvider();

export const codexCliAuthRouter = router({
  /**
   * Initiate the Codex CLI auth flow.
   * Spawns `codex login` which opens a browser for authentication.
   */
  initiate: protectedProcedure.mutation(async () => {
    const store = createCredentialStore(getSystemDb());
    const result = await authProvider.initiateAuth(store, 'cli');
    return { sessionId: result.sessionId };
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
   * Sign out: run `codex logout` and remove stored credentials.
   */
  logout: protectedProcedure.mutation(async () => {
    const db = getSystemDb();
    const store = createCredentialStore(db);
    await authProvider.logout(store);
    removeCredential(db, 'codex', 'cli_detected');
    return { success: true };
  }),
});
