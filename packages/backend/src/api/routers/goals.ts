/**
 * Goals Router — tRPC procedures for goals, seeds, and plans.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb } from '../../db/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import { getEventBus } from '../../lib/event-bus.js';
import type { Goal, GoalSeed } from '@animus/shared';

export const goalsRouter = router({
  /**
   * Get goals by status.
   */
  getGoals: protectedProcedure
    .input(
      z.object({
        status: z.enum(['proposed', 'active', 'paused', 'completed', 'abandoned']).optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      if (input?.status) {
        return heartbeatStore.getGoalsByStatus(db, input.status);
      }
      // Return active goals by default
      return heartbeatStore.getActiveGoals(db, 50);
    }),

  /**
   * Get a single goal by ID.
   */
  getGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getGoal(db, input.goalId);
    }),

  /**
   * Get seeds by status (defaults to active).
   */
  getSeeds: protectedProcedure
    .input(
      z.object({
        status: z.enum(['active', 'graduated', 'decayed']).optional(),
      }).optional()
    )
    .query(({ input }) => {
      const db = getHeartbeatDb();
      if (input?.status) {
        return heartbeatStore.getSeedsByStatus(db, input.status);
      }
      return heartbeatStore.getActiveSeeds(db);
    }),

  /**
   * Get plans for a specific goal.
   */
  getPlansByGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getPlansByGoal(db, input.goalId);
    }),

  /**
   * Get the active plan for a goal.
   */
  getActivePlan: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      const db = getHeartbeatDb();
      return heartbeatStore.getActivePlan(db, input.goalId);
    }),

  /**
   * Subscribe to goal changes (created or updated).
   */
  onGoalChange: protectedProcedure.subscription(() => {
    return observable<Goal>((emit) => {
      const eventBus = getEventBus();
      const handler = (goal: Goal) => emit.next(goal);
      eventBus.on('goal:created', handler);
      eventBus.on('goal:updated', handler);
      return () => {
        eventBus.off('goal:created', handler);
        eventBus.off('goal:updated', handler);
      };
    });
  }),

  /**
   * Subscribe to seed changes (created or updated).
   */
  onSeedChange: protectedProcedure.subscription(() => {
    return observable<GoalSeed>((emit) => {
      const eventBus = getEventBus();
      const handler = (seed: GoalSeed) => emit.next(seed);
      eventBus.on('seed:created', handler);
      eventBus.on('seed:updated', handler);
      return () => {
        eventBus.off('seed:created', handler);
        eventBus.off('seed:updated', handler);
      };
    });
  }),
});
