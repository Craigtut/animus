/**
 * Goals Router - tRPC procedures for goals, seeds, and plans.
 */

import { z } from 'zod/v3';
import { observable } from '@trpc/server/observable';
import { router, protectedProcedure } from '../trpc.js';
import { getEventBus } from '../../lib/event-bus.js';
import { getGoalService } from '../../services/goal-service.js';
import type { Goal, GoalSeed } from '@animus-labs/shared';

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
      return getGoalService().getGoals(input?.status);
    }),

  /**
   * Get a single goal by ID.
   */
  getGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      return getGoalService().getGoal(input.goalId);
    }),

  /**
   * Get seeds by status (defaults to active).
   */
  getSeeds: protectedProcedure
    .input(
      z.object({
        status: z.enum(['active', 'graduated', 'graduating', 'decayed']).optional(),
      }).optional()
    )
    .query(({ input }) => {
      return getGoalService().getSeeds(input?.status);
    }),

  /**
   * Get plans for a specific goal.
   */
  getPlansByGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      return getGoalService().getPlansByGoal(input.goalId);
    }),

  /**
   * Get the active plan for a goal.
   */
  getActivePlan: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ input }) => {
      return getGoalService().getActivePlan(input.goalId);
    }),

  /**
   * Activate a proposed or paused goal.
   */
  activateGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      return getGoalService().activateGoal(input.goalId);
    }),

  /**
   * Pause an active goal.
   */
  pauseGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      return getGoalService().pauseGoal(input.goalId);
    }),

  /**
   * Resume a paused goal.
   */
  resumeGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      return getGoalService().resumeGoal(input.goalId);
    }),

  /**
   * Abandon a goal (any status except completed or already abandoned).
   */
  abandonGoal: protectedProcedure
    .input(z.object({ goalId: z.string(), reason: z.string().optional() }))
    .mutation(({ input }) => {
      return getGoalService().abandonGoal(input.goalId, input.reason);
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
