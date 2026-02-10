/**
 * Goals Router — tRPC procedures for goals, seeds, and plans.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb } from '../../db/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';

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
});
