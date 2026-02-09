/**
 * Heartbeat Router — tRPC procedures for heartbeat state, emotions, and control.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb } from '../../db/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import {
  startHeartbeat,
  stopHeartbeat,
  getHeartbeatStatus,
  triggerTick,
  updateHeartbeatInterval,
  recompilePersona,
} from '../../heartbeat/index.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { HeartbeatState, EmotionState } from '@animus/shared';

export const heartbeatRouter = router({
  /**
   * Get current heartbeat state.
   */
  getState: protectedProcedure.query(() => {
    return getHeartbeatStatus();
  }),

  /**
   * Get current emotion states.
   */
  getEmotions: protectedProcedure.query(() => {
    const db = getHeartbeatDb();
    return heartbeatStore.getEmotionStates(db);
  }),

  /**
   * Get recent thoughts.
   */
  getRecentThoughts: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentThoughts(db, input?.limit ?? 20);
    }),

  /**
   * Get recent experiences.
   */
  getRecentExperiences: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentExperiences(db, input?.limit ?? 20);
    }),

  /**
   * Get tick decisions for a specific tick.
   */
  getTickDecisions: protectedProcedure
    .input(z.object({ tickNumber: z.number().int().nonnegative() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getTickDecisions(db, input.tickNumber);
    }),

  /**
   * Start the heartbeat system.
   */
  start: protectedProcedure.mutation(() => {
    startHeartbeat();
    return getHeartbeatStatus();
  }),

  /**
   * Stop the heartbeat system.
   */
  stop: protectedProcedure.mutation(() => {
    stopHeartbeat();
    return getHeartbeatStatus();
  }),

  /**
   * Manually trigger a heartbeat tick (for testing).
   */
  triggerTick: protectedProcedure.mutation(async () => {
    await triggerTick();
    return getHeartbeatStatus();
  }),

  /**
   * Update heartbeat interval.
   */
  updateInterval: protectedProcedure
    .input(z.object({ intervalMs: z.number().int().positive().min(30000).max(3600000) }))
    .mutation(({ input }) => {
      updateHeartbeatInterval(input.intervalMs);
      return { intervalMs: input.intervalMs };
    }),

  /**
   * Subscribe to heartbeat state changes (real-time updates).
   */
  onStateChange: protectedProcedure.subscription(() => {
    return observable<HeartbeatState>((emit) => {
      const eventBus = getEventBus();
      const handler = (state: HeartbeatState) => {
        emit.next(state);
      };
      eventBus.on('heartbeat:state_change', handler);

      // Emit current state immediately
      emit.next(getHeartbeatStatus());

      return () => {
        eventBus.off('heartbeat:state_change', handler);
      };
    });
  }),

  /**
   * Subscribe to emotion state updates.
   */
  onEmotionChange: protectedProcedure.subscription(() => {
    return observable<EmotionState>((emit) => {
      const eventBus = getEventBus();
      const handler = (emotion: EmotionState) => {
        emit.next(emotion);
      };
      eventBus.on('emotion:updated', handler);

      return () => {
        eventBus.off('emotion:updated', handler);
      };
    });
  }),
});
