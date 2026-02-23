/**
 * Goals Router — tRPC procedures for goals, seeds, and plans.
 */

import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getHeartbeatDb } from '../../db/index.js';
import * as heartbeatStore from '../../db/stores/heartbeat-store.js';
import { getEventBus } from '../../lib/event-bus.js';
import { now } from '@animus-labs/shared';
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
        status: z.enum(['active', 'graduated', 'graduating', 'decayed']).optional(),
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
   * Activate a proposed or paused goal.
   */
  activateGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const goal = heartbeatStore.getGoal(db, input.goalId);
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      }
      if (goal.status !== 'proposed' && goal.status !== 'paused') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot activate a goal with status '${goal.status}'. Must be 'proposed' or 'paused'.`,
        });
      }
      heartbeatStore.updateGoal(db, input.goalId, {
        status: 'active',
        activatedAt: now(),
      });
      const updated = heartbeatStore.getGoal(db, input.goalId)!;
      getEventBus().emit('goal:updated', updated);
      return updated;
    }),

  /**
   * Pause an active goal.
   */
  pauseGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const goal = heartbeatStore.getGoal(db, input.goalId);
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      }
      if (goal.status !== 'active') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot pause a goal with status '${goal.status}'. Must be 'active'.`,
        });
      }
      heartbeatStore.updateGoal(db, input.goalId, { status: 'paused' });
      const updated = heartbeatStore.getGoal(db, input.goalId)!;
      getEventBus().emit('goal:updated', updated);
      return updated;
    }),

  /**
   * Resume a paused goal.
   */
  resumeGoal: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const goal = heartbeatStore.getGoal(db, input.goalId);
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      }
      if (goal.status !== 'paused') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot resume a goal with status '${goal.status}'. Must be 'paused'.`,
        });
      }
      heartbeatStore.updateGoal(db, input.goalId, {
        status: 'active',
        activatedAt: now(),
      });
      const updated = heartbeatStore.getGoal(db, input.goalId)!;
      getEventBus().emit('goal:updated', updated);
      return updated;
    }),

  /**
   * Abandon a goal (any status except completed or already abandoned).
   */
  abandonGoal: protectedProcedure
    .input(z.object({ goalId: z.string(), reason: z.string().optional() }))
    .mutation(({ input }) => {
      const db = getHeartbeatDb();
      const goal = heartbeatStore.getGoal(db, input.goalId);
      if (!goal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      }
      if (goal.status === 'completed' || goal.status === 'abandoned') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot abandon a goal with status '${goal.status}'.`,
        });
      }
      heartbeatStore.updateGoal(db, input.goalId, {
        status: 'abandoned',
        abandonedAt: now(),
        abandonedReason: input.reason ?? null,
      });
      const updated = heartbeatStore.getGoal(db, input.goalId)!;
      getEventBus().emit('goal:updated', updated);
      return updated;
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
