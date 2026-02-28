/**
 * Goal Service - business logic for goal, seed, and plan management.
 *
 * Encapsulates status transitions, event emission, and store access.
 * The router layer handles auth and input validation; this layer owns the logic.
 */

import { TRPCError } from '@trpc/server';
import { createLogger } from '../lib/logger.js';
import { getHeartbeatDb } from '../db/index.js';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import { getEventBus } from '../lib/event-bus.js';
import { now } from '@animus-labs/shared';
import type { Goal, GoalSeed, Plan } from '@animus-labs/shared';

const log = createLogger('GoalService', 'heartbeat');

// ============================================================================
// Service
// ============================================================================

class GoalService {
  /**
   * Get goals filtered by status, or active goals by default.
   */
  getGoals(status?: string): Goal[] {
    const db = getHeartbeatDb();
    if (status) {
      return heartbeatStore.getGoalsByStatus(db, status);
    }
    return heartbeatStore.getActiveGoals(db, 50);
  }

  /**
   * Get a single goal by ID.
   */
  getGoal(goalId: string): Goal | null {
    return heartbeatStore.getGoal(getHeartbeatDb(), goalId);
  }

  /**
   * Get seeds filtered by status, or active seeds by default.
   */
  getSeeds(status?: string): GoalSeed[] {
    const db = getHeartbeatDb();
    if (status) {
      return heartbeatStore.getSeedsByStatus(db, status);
    }
    return heartbeatStore.getActiveSeeds(db);
  }

  /**
   * Get plans for a specific goal.
   */
  getPlansByGoal(goalId: string): Plan[] {
    return heartbeatStore.getPlansByGoal(getHeartbeatDb(), goalId);
  }

  /**
   * Get the active plan for a goal.
   */
  getActivePlan(goalId: string): Plan | null {
    return heartbeatStore.getActivePlan(getHeartbeatDb(), goalId);
  }

  /**
   * Activate a proposed or paused goal.
   */
  activateGoal(goalId: string): Goal {
    const db = getHeartbeatDb();
    const goal = heartbeatStore.getGoal(db, goalId);
    if (!goal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    }
    if (goal.status !== 'proposed' && goal.status !== 'paused') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot activate a goal with status '${goal.status}'. Must be 'proposed' or 'paused'.`,
      });
    }
    const state = heartbeatStore.getHeartbeatState(db);
    heartbeatStore.updateGoal(db, goalId, {
      status: 'active',
      activatedAt: now(),
      activatedAtTick: state.tickNumber,
    });
    const updated = heartbeatStore.getGoal(db, goalId)!;
    getEventBus().emit('goal:updated', updated);
    log.info(`Activated goal "${updated.title}" (${goalId})`);
    return updated;
  }

  /**
   * Pause an active goal.
   */
  pauseGoal(goalId: string): Goal {
    const db = getHeartbeatDb();
    const goal = heartbeatStore.getGoal(db, goalId);
    if (!goal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    }
    if (goal.status !== 'active') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot pause a goal with status '${goal.status}'. Must be 'active'.`,
      });
    }
    heartbeatStore.updateGoal(db, goalId, { status: 'paused' });
    const updated = heartbeatStore.getGoal(db, goalId)!;
    getEventBus().emit('goal:updated', updated);
    log.info(`Paused goal "${updated.title}" (${goalId})`);
    return updated;
  }

  /**
   * Resume a paused goal (re-activates it).
   */
  resumeGoal(goalId: string): Goal {
    const db = getHeartbeatDb();
    const goal = heartbeatStore.getGoal(db, goalId);
    if (!goal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    }
    if (goal.status !== 'paused') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot resume a goal with status '${goal.status}'. Must be 'paused'.`,
      });
    }
    const state = heartbeatStore.getHeartbeatState(db);
    heartbeatStore.updateGoal(db, goalId, {
      status: 'active',
      activatedAt: now(),
      activatedAtTick: state.tickNumber,
    });
    const updated = heartbeatStore.getGoal(db, goalId)!;
    getEventBus().emit('goal:updated', updated);
    log.info(`Resumed goal "${updated.title}" (${goalId})`);
    return updated;
  }

  /**
   * Abandon a goal (any status except completed or already abandoned).
   */
  abandonGoal(goalId: string, reason?: string): Goal {
    const db = getHeartbeatDb();
    const goal = heartbeatStore.getGoal(db, goalId);
    if (!goal) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    }
    if (goal.status === 'completed' || goal.status === 'abandoned') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot abandon a goal with status '${goal.status}'.`,
      });
    }
    heartbeatStore.updateGoal(db, goalId, {
      status: 'abandoned',
      abandonedAt: now(),
      abandonedReason: reason ?? null,
    });
    const updated = heartbeatStore.getGoal(db, goalId)!;
    getEventBus().emit('goal:updated', updated);
    log.info(`Abandoned goal "${updated.title}" (${goalId})`);
    return updated;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GoalService | null = null;

export function getGoalService(): GoalService {
  if (!instance) instance = new GoalService();
  return instance;
}

export function resetGoalService(): void {
  instance = null;
}
