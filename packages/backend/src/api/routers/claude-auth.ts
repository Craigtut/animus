/**
 * Claude Auth Router — tRPC procedures for Claude CLI OAuth flow.
 *
 * Orchestrates `claude auth login` to provide browser-based authentication
 * for desktop users with Anthropic Pro/Max subscriptions.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import {
  initiateClaudeAuth,
  subscribeToStatus,
  cancelFlow,
  logoutClaude,
  type ClaudeAuthStatusUpdate,
} from '../../services/claude-oauth.js';
import { removeCredential } from '../../services/credential-service.js';

export const claudeAuthRouter = router({
  /**
   * Initiate the Claude auth flow.
   * Spawns `claude auth login` which opens a browser for authentication.
   */
  initiate: protectedProcedure.mutation(() => {
    const result = initiateClaudeAuth(getSystemDb());
    return { sessionId: result.sessionId };
  }),

  /**
   * Subscribe to real-time status updates for an active auth flow.
   * Emits ClaudeAuthStatusUpdate events via WebSocket.
   */
  status: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<ClaudeAuthStatusUpdate>((emit) => {
        const unsubscribe = subscribeToStatus(input.sessionId, (status) => {
          emit.next(status);

          // Auto-complete the observable on terminal states.
          // Wrapped in try-catch because the frontend may disconnect after
          // receiving the terminal status, closing the controller before
          // this timeout fires.
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
   * Sign out: run `claude auth logout` and remove stored credentials.
   */
  logout: protectedProcedure.mutation(async () => {
    const db = getSystemDb();
    await logoutClaude(db);
    // Also remove any stored credentials to fully reset state
    removeCredential(db, 'claude', 'cli_detected');
    return { success: true };
  }),
});
