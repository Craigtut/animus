/**
 * Goal Manager — manages goal lifecycle (create, activate, pause, complete, abandon).
 *
 * See docs/architecture/goals.md
 */

import type Database from 'better-sqlite3';
import { now } from '@animus/shared';
import type { Goal, EmotionName, EmotionState, Plan } from '@animus/shared';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import { computeSalience, GOAL_VISIBILITY_THRESHOLD, MAX_GOALS_IN_CONTEXT } from './salience.js';
import type { SalienceResult } from './salience.js';

// ============================================================================
// Goal Manager
// ============================================================================

export class GoalManager {
  constructor(
    private readonly db: Database.Database,
  ) {}

  /**
   * Promote a seed to a goal.
   */
  promoteToGoal(
    seedId: string,
    data: {
      title: string;
      description?: string;
      motivation?: string;
      linkedEmotion?: EmotionName;
      basePriority?: number;
      completionCriteria?: string;
      deadline?: string;
    }
  ): Goal {
    const goal = heartbeatStore.createGoal(this.db, {
      title: data.title,
      description: data.description ?? null,
      motivation: data.motivation ?? null,
      origin: 'ai_internal',
      seedId,
      linkedEmotion: data.linkedEmotion ?? null,
      status: 'proposed',
      basePriority: data.basePriority ?? 0.4,
      completionCriteria: data.completionCriteria ?? null,
      deadline: data.deadline ?? null,
    });

    // Mark seed as graduated
    heartbeatStore.updateSeed(this.db, seedId, {
      status: 'graduated',
      graduatedToGoalId: goal.id,
    });

    return goal;
  }

  /**
   * Create a goal directly (user-directed or collaborative).
   */
  createGoal(data: {
    title: string;
    description?: string;
    motivation?: string;
    origin: 'user_directed' | 'ai_internal' | 'collaborative';
    linkedEmotion?: EmotionName;
    createdByContactId?: string;
    status?: 'proposed' | 'active';
    basePriority?: number;
    completionCriteria?: string;
    deadline?: string;
  }): Goal {
    return heartbeatStore.createGoal(this.db, data);
  }

  /**
   * Get a goal by ID.
   */
  getGoal(goalId: string): Goal | null {
    return heartbeatStore.getGoal(this.db, goalId);
  }

  /**
   * Get active goals sorted by salience.
   */
  getActiveGoals(limit: number = 10): Goal[] {
    return heartbeatStore.getActiveGoals(this.db, limit);
  }

  /**
   * Get goals by status.
   */
  getGoalsByStatus(status: string): Goal[] {
    return heartbeatStore.getGoalsByStatus(this.db, status);
  }

  /**
   * Activate a proposed goal.
   */
  activateGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'active',
      activatedAt: now(),
    });
  }

  /**
   * Pause a goal (remove from active rotation).
   */
  pauseGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, { status: 'paused' });
  }

  /**
   * Resume a paused goal.
   */
  resumeGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'active',
      activatedAt: now(),
    });
  }

  /**
   * Complete a goal.
   */
  completeGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'completed',
      completedAt: now(),
    });
  }

  /**
   * Abandon a goal.
   */
  abandonGoal(goalId: string, reason?: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'abandoned',
      abandonedAt: now(),
      abandonedReason: reason ?? null,
    });
  }

  /**
   * Update goal progress timestamp.
   */
  updateGoalProgress(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      lastProgressAt: now(),
    });
  }

  /**
   * Compute salience for all active goals and update cached values.
   * Returns goals above the visibility threshold, sorted by salience.
   */
  computeAndUpdateSalience(
    emotionStates: EmotionState[],
  ): Array<{ goal: Goal; result: SalienceResult }> {
    const activeGoals = this.getActiveGoals(50);
    const salientGoals: Array<{ goal: Goal; result: SalienceResult }> = [];

    for (const goal of activeGoals) {
      const result = computeSalience(goal, emotionStates);

      // Update cached salience
      heartbeatStore.updateGoal(this.db, goal.id, {
        currentSalience: result.salience,
      });

      // Log salience
      heartbeatStore.logSalience(this.db, {
        goalId: goal.id,
        salience: result.salience,
        ...result.components,
      });

      if (result.salience >= GOAL_VISIBILITY_THRESHOLD) {
        salientGoals.push({ goal: { ...goal, currentSalience: result.salience }, result });
      }
    }

    // Sort by salience descending, take top N
    salientGoals.sort((a, b) => b.result.salience - a.result.salience);
    return salientGoals.slice(0, MAX_GOALS_IN_CONTEXT);
  }

  /**
   * Create a plan for a goal.
   */
  createPlan(goalId: string, data: {
    strategy: string;
    milestones?: Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' }>;
    createdBy: 'mind' | 'planning_agent';
  }): Plan {
    return heartbeatStore.createPlan(this.db, {
      goalId,
      strategy: data.strategy,
      milestones: data.milestones ?? null,
      createdBy: data.createdBy,
    });
  }

  /**
   * Get the active plan for a goal.
   */
  getActivePlan(goalId: string): Plan | null {
    return heartbeatStore.getActivePlan(this.db, goalId);
  }

  /**
   * Get all plans for a goal.
   */
  getPlansByGoal(goalId: string): Plan[] {
    return heartbeatStore.getPlansByGoal(this.db, goalId);
  }
}
