/**
 * SDK Router — tRPC procedures for SDK installation management.
 *
 * Exposes SDK status, installation trigger, and real-time progress subscription.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { getSdkManager } from '../../services/sdk-manager.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { AnimusEventMap } from '@animus-labs/shared';

type SdkInstallUpdate = AnimusEventMap['sdk:install_progress'];

export const sdkRouter = router({
  /** Check SDK installation status. */
  status: publicProcedure.query(() => {
    return getSdkManager().getStatus();
  }),

  /** Trigger SDK installation. Returns immediately; progress via subscription. */
  install: protectedProcedure
    .input(z.object({ version: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const manager = getSdkManager();
      // Fire and forget — progress comes via subscription
      manager.install(input?.version).catch(() => {
        // Error already emitted via event bus
      });
      return { started: true };
    }),

  /** Real-time SDK installation progress subscription. */
  onInstallProgress: publicProcedure.subscription(() => {
    return observable<SdkInstallUpdate>((emit) => {
      const eventBus = getEventBus();

      const onProgress = (payload: SdkInstallUpdate) => {
        emit.next(payload);
      };

      eventBus.on('sdk:install_progress', onProgress);

      return () => {
        eventBus.off('sdk:install_progress', onProgress);
      };
    });
  }),
});
