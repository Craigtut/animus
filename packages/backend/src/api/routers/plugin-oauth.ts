/**
 * Plugin OAuth Router — tRPC procedures for plugin OAuth authorization code flow.
 *
 * Provides initiation, real-time status subscription, connection check,
 * and disconnect for plugin OAuth fields.
 *
 * @see docs/architecture/credential-passing.md
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import {
  initiateOAuthFlow,
  subscribeToStatus,
  getOAuthStatus,
  disconnect,
  type OAuthStatusUpdate,
} from '../../services/plugin-oauth.js';

export { type OAuthStatusUpdate } from '../../services/plugin-oauth.js';

export const pluginOAuthRouter = router({
  /**
   * Initiate the OAuth authorization code flow for a plugin's OAuth config field.
   * Returns the authorization URL for the frontend to open in a new tab,
   * and a sessionId for tracking the flow via the status subscription.
   */
  initiate: protectedProcedure
    .input(z.object({
      pluginName: z.string().min(1),
      configKey: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const result = initiateOAuthFlow(input.pluginName, input.configKey);
      return {
        authorizationUrl: result.authorizationUrl,
        sessionId: result.sessionId,
      };
    }),

  /**
   * Subscribe to real-time status updates for an active OAuth flow.
   * Emits OAuthStatusUpdate events via WebSocket.
   */
  status: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .subscription(({ input }) => {
      return observable<OAuthStatusUpdate>((emit) => {
        const unsubscribe = subscribeToStatus(input.sessionId, (status) => {
          emit.next(status);

          // Auto-complete the observable on terminal states
          if (status.status === 'success' || status.status === 'error') {
            setTimeout(() => emit.complete(), 100);
          }
        });

        return unsubscribe;
      });
    }),

  /**
   * Check current OAuth connection status for a plugin's config field.
   * Does not decrypt tokens; checks the stored object for the __oauth sentinel.
   */
  checkStatus: protectedProcedure
    .input(z.object({
      pluginName: z.string().min(1),
      configKey: z.string().min(1),
    }))
    .query(({ input }) => {
      return getOAuthStatus(input.pluginName, input.configKey);
    }),

  /**
   * Disconnect OAuth (clear tokens) for a plugin's config field.
   */
  disconnect: protectedProcedure
    .input(z.object({
      pluginName: z.string().min(1),
      configKey: z.string().min(1),
    }))
    .mutation(({ input }) => {
      disconnect(input.pluginName, input.configKey);
      return { success: true };
    }),
});
