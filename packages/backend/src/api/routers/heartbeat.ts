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
import type { HeartbeatState, EmotionState, Thought, Experience } from '@animus/shared';

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
   * Get recent decisions across all ticks (for the Mind page).
   */
  getRecentDecisions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
        since: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getRecentDecisions(db, {
        limit: input?.limit ?? 50,
        since: input?.since,
      });
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
  stop: protectedProcedure.mutation(async () => {
    await stopHeartbeat();
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

  /**
   * Subscribe to new thoughts.
   */
  onThoughts: protectedProcedure.subscription(() => {
    return observable<Thought>((emit) => {
      const eventBus = getEventBus();
      const handler = (thought: Thought) => {
        emit.next(thought);
      };
      eventBus.on('thought:created', handler);

      return () => {
        eventBus.off('thought:created', handler);
      };
    });
  }),

  /**
   * Subscribe to new experiences.
   */
  onExperience: protectedProcedure.subscription(() => {
    return observable<Experience>((emit) => {
      const eventBus = getEventBus();
      const handler = (experience: Experience) => {
        emit.next(experience);
      };
      eventBus.on('experience:created', handler);

      return () => {
        eventBus.off('experience:created', handler);
      };
    });
  }),

  /**
   * Subscribe to agent lifecycle events.
   */
  onAgentStatus: protectedProcedure.subscription(() => {
    return observable<{
      type: 'spawned' | 'completed' | 'failed';
      taskId: string;
      detail?: string;
    }>((emit) => {
      const eventBus = getEventBus();

      const onSpawned = (data: { taskId: string; provider: string }) => {
        emit.next({ type: 'spawned', taskId: data.taskId, detail: data.provider });
      };
      const onCompleted = (data: { taskId: string; result: string | null }) => {
        const event: { type: 'completed'; taskId: string; detail?: string } = {
          type: 'completed',
          taskId: data.taskId,
        };
        if (data.result !== null) event.detail = data.result;
        emit.next(event);
      };
      const onFailed = (data: { taskId: string; error: string }) => {
        emit.next({ type: 'failed', taskId: data.taskId, detail: data.error });
      };

      eventBus.on('agent:spawned', onSpawned);
      eventBus.on('agent:completed', onCompleted);
      eventBus.on('agent:failed', onFailed);

      return () => {
        eventBus.off('agent:spawned', onSpawned);
        eventBus.off('agent:completed', onCompleted);
        eventBus.off('agent:failed', onFailed);
      };
    });
  }),

  /**
   * Get emotion history for sparklines/charts.
   */
  getEmotionHistory: protectedProcedure
    .input(
      z.object({
        emotion: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().max(500).default(100),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      const opts: { emotion?: import('@animus/shared').EmotionName; since?: string; limit?: number } = {};
      if (input?.emotion) opts.emotion = input.emotion as import('@animus/shared').EmotionName;
      if (input?.since) opts.since = input.since;
      opts.limit = input?.limit ?? 100;
      return heartbeatStore.getEmotionHistory(db, opts);
    }),

  /**
   * Subscribe to real-time reply streaming from the mind.
   * Emits reply chunks as the agent generates them, and a complete event when done.
   */
  onReply: protectedProcedure.subscription(() => {
    return observable<{ type: 'chunk' | 'complete'; content: string; tickNumber?: number }>((emit) => {
      const eventBus = getEventBus();

      const chunkHandler = (data: { content: string; accumulated: string }) => {
        emit.next({ type: 'chunk', content: data.content });
      };

      const completeHandler = (data: { content: string; tickNumber: number }) => {
        emit.next({ type: 'complete', content: data.content, tickNumber: data.tickNumber });
      };

      eventBus.on('reply:chunk', chunkHandler);
      eventBus.on('reply:complete', completeHandler);

      return () => {
        eventBus.off('reply:chunk', chunkHandler);
        eventBus.off('reply:complete', completeHandler);
      };
    });
  }),
});
