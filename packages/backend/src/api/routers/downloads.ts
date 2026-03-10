/**
 * Downloads Router — tRPC procedures for download management.
 *
 * Exposes download state, missing asset detection, manual triggers,
 * and a real-time progress subscription via EventBus.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getDownloadManager, getSpeechAssets } from '../../downloads/index.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { AnimusEventMap } from '@animus-labs/shared';

// Discriminated union of all download events for the subscription
type DownloadUpdate =
  | { type: 'started'; assetId: string; label: string; category: string }
  | { type: 'progress'; assetId: string; label: string; category: string; bytesDownloaded: number; totalBytes: number; percent: number; phase: 'downloading' | 'extracting' }
  | { type: 'completed'; assetId: string; label: string; category: string }
  | { type: 'failed'; assetId: string; label: string; category: string; error: string; retriesRemaining: number };

export const downloadsRouter = router({
  /** Get all current download states. */
  getAll: protectedProcedure.query(() => {
    return getDownloadManager().getAll();
  }),

  /** Get missing speech assets (not yet downloaded). */
  getMissingSpeechAssets: protectedProcedure.query(() => {
    const dm = getDownloadManager();
    return getSpeechAssets().filter((a) => !dm.isAssetPresent(a)).map((a) => ({
      id: a.id,
      label: a.label,
      category: a.category,
      estimatedBytes: a.estimatedBytes,
    }));
  }),

  /** Manually start downloading speech assets. */
  startSpeechDownloads: protectedProcedure.mutation(() => {
    const dm = getDownloadManager();
    const missing = getSpeechAssets().filter((a) => !dm.isAssetPresent(a));
    if (missing.length === 0) return { started: 0 };
    dm.enqueue(missing);
    return { started: missing.length };
  }),

  /** Cancel a specific download. */
  cancel: protectedProcedure
    .input(z.object({ assetId: z.string() }))
    .mutation(({ input }) => {
      getDownloadManager().cancel(input.assetId);
      return { success: true };
    }),

  /** Real-time download progress subscription. */
  onProgress: protectedProcedure.subscription(() => {
    return observable<DownloadUpdate>((emit) => {
      const eventBus = getEventBus();

      const onStarted = (payload: AnimusEventMap['download:started']) => {
        emit.next({ type: 'started', ...payload });
      };
      const onProgress = (payload: AnimusEventMap['download:progress']) => {
        emit.next({ type: 'progress', ...payload });
      };
      const onCompleted = (payload: AnimusEventMap['download:completed']) => {
        emit.next({ type: 'completed', ...payload });
      };
      const onFailed = (payload: AnimusEventMap['download:failed']) => {
        emit.next({ type: 'failed', ...payload });
      };

      eventBus.on('download:started', onStarted);
      eventBus.on('download:progress', onProgress);
      eventBus.on('download:completed', onCompleted);
      eventBus.on('download:failed', onFailed);

      // Catch-up: emit current in-progress states for late-joining clients
      const current = getDownloadManager().getAll();
      for (const s of current) {
        if (s.phase === 'downloading' || s.phase === 'extracting') {
          emit.next({
            type: 'progress',
            assetId: s.assetId,
            label: s.label,
            category: s.category,
            bytesDownloaded: s.bytesDownloaded,
            totalBytes: s.totalBytes,
            percent: s.percent,
            phase: s.phase,
          });
        }
      }

      return () => {
        eventBus.off('download:started', onStarted);
        eventBus.off('download:progress', onProgress);
        eventBus.off('download:completed', onCompleted);
        eventBus.off('download:failed', onFailed);
      };
    });
  }),
});
