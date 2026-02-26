/**
 * Codex Auth Router — tRPC procedures for Codex OAuth device code flow.
 *
 * Provides real-time device code flow with WebSocket subscription for status updates.
 * @see docs/agents/codex/oauth.md
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getSystemDb } from '../../db/index.js';
import * as systemStore from '../../db/stores/system-store.js';
import {
  initiateDeviceCodeFlow,
  getSessionStatus,
  subscribeToStatus,
  cancelFlow,
  type AuthStatusUpdate,
} from '../../services/codex-oauth.js';
import { removeCredential } from '../../services/credential-service.js';

export const codexAuthRouter = router({
  /**
   * Initiate the Codex OAuth device code flow.
   * Returns a user code and verification URL for the frontend to display.
   */
  initiate: protectedProcedure.mutation(async () => {
    const result = await initiateDeviceCodeFlow(getSystemDb());
    return {
      userCode: result.userCode,
      verificationUrl: result.verificationUrl,
      expiresIn: result.expiresIn,
      sessionId: result.sessionId,
    };
  }),

  /**
   * Subscribe to real-time status updates for an active device code flow.
   * Emits AuthStatusUpdate events via WebSocket.
   */
  status: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<AuthStatusUpdate>((emit) => {
        const unsubscribe = subscribeToStatus(input.sessionId, (status) => {
          emit.next(status);

          // Auto-complete the observable on terminal states.
          // Wrapped in try-catch because the frontend may disconnect after
          // receiving the terminal status, closing the controller before
          // this timeout fires.
          if (status.status === 'success' || status.status === 'error' || status.status === 'expired' || status.status === 'cancelled') {
            setTimeout(() => {
              try { emit.complete(); } catch { /* controller already closed */ }
            }, 100);
          }
        });

        return unsubscribe;
      });
    }),

  /**
   * Cancel an in-progress device code flow.
   */
  cancel: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const cancelled = cancelFlow(input.sessionId);
      return { cancelled };
    }),

  /**
   * Check if Codex OAuth credentials are stored.
   * Returns status without decrypting tokens (uses metadata).
   */
  checkStatus: protectedProcedure.query(() => {
    const db = getSystemDb();
    const metas = systemStore.getCredentialMetadata(db, 'codex');
    const oauthMeta = metas.find((m) => m.credentialType === 'codex_oauth');

    if (!oauthMeta || !oauthMeta.metadata) {
      return {
        authenticated: false,
        expiresAt: null,
        accountId: null,
        needsRefresh: false,
      };
    }

    const meta = oauthMeta.metadata as Record<string, unknown>;
    const expiresAt = meta['expiresAt'] as string | undefined;
    const needsRefresh = expiresAt
      ? new Date(expiresAt).getTime() - Date.now() < 5 * 60 * 1000
      : false;

    return {
      authenticated: true,
      expiresAt: expiresAt ?? null,
      accountId: (meta['accountId'] as string) ?? null,
      needsRefresh,
    };
  }),

  /**
   * Remove stored Codex OAuth credentials (sign out).
   */
  logout: protectedProcedure.mutation(() => {
    removeCredential(getSystemDb(), 'codex', 'codex_oauth');
    return { success: true };
  }),
});
