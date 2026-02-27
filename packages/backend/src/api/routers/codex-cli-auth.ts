/**
 * Codex CLI Auth Router -- tRPC procedures for Codex CLI auth flow.
 *
 * Orchestrates `codex login` to provide browser-based authentication
 * for desktop users with ChatGPT Plus/Pro/Team subscriptions.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import {
  initiateCodexCliAuth,
  subscribeToStatus,
  cancelFlow,
  logoutCodex,
  type CodexCliAuthStatusUpdate,
} from '../../services/codex-cli-auth.js';
import { removeCredential } from '../../services/credential-service.js';

export const codexCliAuthRouter = router({
  /**
   * Initiate the Codex CLI auth flow.
   * Spawns `codex login` which opens a browser for authentication.
   */
  initiate: protectedProcedure.mutation(() => {
    const result = initiateCodexCliAuth(getSystemDb());
    return { sessionId: result.sessionId };
  }),

  /**
   * Subscribe to real-time status updates for an active auth flow.
   * Emits CodexCliAuthStatusUpdate events via WebSocket.
   */
  status: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<CodexCliAuthStatusUpdate>((emit) => {
        const unsubscribe = subscribeToStatus(input.sessionId, (status) => {
          emit.next(status);

          // Auto-complete the observable on terminal states.
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
      const cancelled = cancelFlow(input.sessionId);
      return { cancelled };
    }),

  /**
   * Sign out: run `codex logout` and remove stored credentials.
   */
  logout: protectedProcedure.mutation(async () => {
    const db = getSystemDb();
    await logoutCodex(db);
    // Also remove any stored credentials to fully reset state
    removeCredential(db, 'codex', 'cli_detected');
    return { success: true };
  }),
});
