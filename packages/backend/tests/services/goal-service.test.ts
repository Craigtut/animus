/**
 * Tests for GoalService — business logic for goal, seed, and plan management.
 *
 * Uses a real in-memory SQLite database with migrations applied,
 * mocking only the DB getter and event bus to isolate the service layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import type { Goal } from '@animus/shared';

// ============================================================================
// Mocks — must be set up before dynamically importing the service
// ============================================================================

let testDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getHeartbeatDb: () => testDb,
}));

const mockEmit = vi.fn();
vi.mock('../../src/lib/event-bus.js', () => ({
  getEventBus: () => ({
    emit: mockEmit,
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  }),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Dynamic import after mocks are registered
// ============================================================================

const { getGoalService, resetGoalService } = await import(
  '../../src/services/goal-service.js'
);

// ============================================================================
// Helpers
// ============================================================================

/** Create a goal in the test DB with a specific status. */
function createGoalWithStatus(
  status: 'proposed' | 'active' | 'paused' | 'completed' | 'abandoned',
): Goal {
  const goal = heartbeatStore.createGoal(testDb, {
    title: `Test Goal (${status})`,
    description: 'A test goal',
    origin: 'user_directed',
  });

  if (status !== 'proposed') {
    heartbeatStore.updateGoal(testDb, goal.id, { status });
    if (status === 'active') {
      heartbeatStore.updateGoal(testDb, goal.id, {
        activatedAt: new Date().toISOString(),
      });
    }
  }

  return heartbeatStore.getGoal(testDb, goal.id)!;
}

// ============================================================================
// Tests
// ============================================================================

describe('GoalService', () => {
  beforeEach(() => {
    testDb = createTestHeartbeatDb();
    resetGoalService();
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // getGoals
  // --------------------------------------------------------------------------

  describe('getGoals', () => {
    it('returns active goals by default', () => {
      createGoalWithStatus('active');
      createGoalWithStatus('active');
      createGoalWithStatus('proposed');
      createGoalWithStatus('paused');

      const service = getGoalService();
      const goals = service.getGoals();

      expect(goals).toHaveLength(2);
      expect(goals.every((g: Goal) => g.status === 'active')).toBe(true);
    });

    it('returns goals filtered by status when provided', () => {
      createGoalWithStatus('proposed');
      createGoalWithStatus('proposed');
      createGoalWithStatus('active');

      const service = getGoalService();
      const proposed = service.getGoals('proposed');

      expect(proposed).toHaveLength(2);
      expect(proposed.every((g: Goal) => g.status === 'proposed')).toBe(true);
    });

    it('returns empty array when no goals match', () => {
      createGoalWithStatus('active');

      const service = getGoalService();
      const paused = service.getGoals('paused');

      expect(paused).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getGoal
  // --------------------------------------------------------------------------

  describe('getGoal', () => {
    it('returns a goal by id', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.getGoal(goal.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(goal.id);
      expect(result!.title).toBe(goal.title);
    });

    it('returns null for a missing goal', () => {
      const service = getGoalService();
      const result = service.getGoal('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getSeeds
  // --------------------------------------------------------------------------

  describe('getSeeds', () => {
    it('returns active seeds by default', () => {
      heartbeatStore.createSeed(testDb, {
        content: 'Learn music',
        source: 'internal',
      });
      heartbeatStore.createSeed(testDb, {
        content: 'Explore art',
        source: 'internal',
      });
      const decayedSeed = heartbeatStore.createSeed(testDb, {
        content: 'Old idea',
        source: 'internal',
      });
      heartbeatStore.updateSeed(testDb, decayedSeed.id, { status: 'decayed' });

      const service = getGoalService();
      const seeds = service.getSeeds();

      expect(seeds).toHaveLength(2);
      expect(seeds.every((s) => s.status === 'active')).toBe(true);
    });

    it('returns seeds filtered by status when provided', () => {
      heartbeatStore.createSeed(testDb, {
        content: 'Active seed',
        source: 'internal',
      });
      const graduatingSeed = heartbeatStore.createSeed(testDb, {
        content: 'Graduating seed',
        source: 'internal',
      });
      heartbeatStore.updateSeed(testDb, graduatingSeed.id, {
        status: 'graduating',
      });

      const service = getGoalService();
      const graduating = service.getSeeds('graduating');

      expect(graduating).toHaveLength(1);
      expect(graduating[0]!.content).toBe('Graduating seed');
    });
  });

  // --------------------------------------------------------------------------
  // getPlansByGoal
  // --------------------------------------------------------------------------

  describe('getPlansByGoal', () => {
    it('returns plans for a goal', () => {
      const goal = createGoalWithStatus('active');
      heartbeatStore.createPlan(testDb, {
        goalId: goal.id,
        strategy: 'Step 1',
        createdBy: 'mind',
      });
      heartbeatStore.createPlan(testDb, {
        goalId: goal.id,
        strategy: 'Step 2',
        createdBy: 'mind',
      });

      const service = getGoalService();
      const plans = service.getPlansByGoal(goal.id);

      expect(plans).toHaveLength(2);
    });

    it('returns empty array when goal has no plans', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const plans = service.getPlansByGoal(goal.id);

      expect(plans).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getActivePlan
  // --------------------------------------------------------------------------

  describe('getActivePlan', () => {
    it('returns the active plan for a goal', () => {
      const goal = createGoalWithStatus('active');
      heartbeatStore.createPlan(testDb, {
        goalId: goal.id,
        strategy: 'v1',
        createdBy: 'mind',
      });
      const plan2 = heartbeatStore.createPlan(testDb, {
        goalId: goal.id,
        strategy: 'v2',
        createdBy: 'mind',
      });

      const service = getGoalService();
      const active = service.getActivePlan(goal.id);

      expect(active).not.toBeNull();
      expect(active!.id).toBe(plan2.id);
      expect(active!.strategy).toBe('v2');
    });

    it('returns null when no active plan exists', () => {
      const service = getGoalService();
      const active = service.getActivePlan('nonexistent-id');

      expect(active).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // activateGoal
  // --------------------------------------------------------------------------

  describe('activateGoal', () => {
    it('transitions a proposed goal to active', () => {
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();
      const result = service.activateGoal(goal.id);

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('transitions a paused goal to active', () => {
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();
      const result = service.activateGoal(goal.id);

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('sets activatedAtTick from heartbeat state', () => {
      heartbeatStore.updateHeartbeatState(testDb, { tickNumber: 42 });
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();
      const result = service.activateGoal(goal.id);

      expect(result.activatedAtTick).toBe(42);
    });

    it('throws NOT_FOUND for a missing goal', () => {
      const service = getGoalService();

      expect(() => service.activateGoal('nonexistent-id')).toThrow(
        'Goal not found',
      );

      try {
        service.activateGoal('nonexistent-id');
      } catch (err: any) {
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('throws BAD_REQUEST for an active goal', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();

      expect(() => service.activateGoal(goal.id)).toThrow(
        "Cannot activate a goal with status 'active'",
      );

      try {
        service.activateGoal(goal.id);
      } catch (err: any) {
        expect(err.code).toBe('BAD_REQUEST');
      }
    });

    it('throws BAD_REQUEST for a completed goal', () => {
      const goal = createGoalWithStatus('completed');

      const service = getGoalService();

      expect(() => service.activateGoal(goal.id)).toThrow(
        "Cannot activate a goal with status 'completed'",
      );
    });

    it('throws BAD_REQUEST for an abandoned goal', () => {
      const goal = createGoalWithStatus('abandoned');

      const service = getGoalService();

      expect(() => service.activateGoal(goal.id)).toThrow(
        "Cannot activate a goal with status 'abandoned'",
      );
    });

    it('emits goal:updated event', () => {
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();
      const result = service.activateGoal(goal.id);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        'goal:updated',
        expect.objectContaining({
          id: goal.id,
          status: 'active',
        }),
      );
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // pauseGoal
  // --------------------------------------------------------------------------

  describe('pauseGoal', () => {
    it('transitions an active goal to paused', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.pauseGoal(goal.id);

      expect(result.status).toBe('paused');
    });

    it('throws NOT_FOUND for a missing goal', () => {
      const service = getGoalService();

      expect(() => service.pauseGoal('nonexistent-id')).toThrow(
        'Goal not found',
      );

      try {
        service.pauseGoal('nonexistent-id');
      } catch (err: any) {
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('throws BAD_REQUEST for a proposed goal', () => {
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();

      expect(() => service.pauseGoal(goal.id)).toThrow(
        "Cannot pause a goal with status 'proposed'",
      );
    });

    it('throws BAD_REQUEST for a paused goal', () => {
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();

      expect(() => service.pauseGoal(goal.id)).toThrow(
        "Cannot pause a goal with status 'paused'",
      );
    });

    it('throws BAD_REQUEST for a completed goal', () => {
      const goal = createGoalWithStatus('completed');

      const service = getGoalService();

      expect(() => service.pauseGoal(goal.id)).toThrow(
        "Cannot pause a goal with status 'completed'",
      );
    });

    it('throws BAD_REQUEST for an abandoned goal', () => {
      const goal = createGoalWithStatus('abandoned');

      const service = getGoalService();

      expect(() => service.pauseGoal(goal.id)).toThrow(
        "Cannot pause a goal with status 'abandoned'",
      );
    });

    it('emits goal:updated event', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.pauseGoal(goal.id);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        'goal:updated',
        expect.objectContaining({
          id: goal.id,
          status: 'paused',
        }),
      );
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // resumeGoal
  // --------------------------------------------------------------------------

  describe('resumeGoal', () => {
    it('transitions a paused goal to active', () => {
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();
      const result = service.resumeGoal(goal.id);

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('sets activatedAtTick from heartbeat state', () => {
      heartbeatStore.updateHeartbeatState(testDb, { tickNumber: 99 });
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();
      const result = service.resumeGoal(goal.id);

      expect(result.activatedAtTick).toBe(99);
    });

    it('throws NOT_FOUND for a missing goal', () => {
      const service = getGoalService();

      expect(() => service.resumeGoal('nonexistent-id')).toThrow(
        'Goal not found',
      );

      try {
        service.resumeGoal('nonexistent-id');
      } catch (err: any) {
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('throws BAD_REQUEST for a proposed goal', () => {
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();

      expect(() => service.resumeGoal(goal.id)).toThrow(
        "Cannot resume a goal with status 'proposed'",
      );
    });

    it('throws BAD_REQUEST for an active goal', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();

      expect(() => service.resumeGoal(goal.id)).toThrow(
        "Cannot resume a goal with status 'active'",
      );
    });

    it('throws BAD_REQUEST for a completed goal', () => {
      const goal = createGoalWithStatus('completed');

      const service = getGoalService();

      expect(() => service.resumeGoal(goal.id)).toThrow(
        "Cannot resume a goal with status 'completed'",
      );
    });

    it('throws BAD_REQUEST for an abandoned goal', () => {
      const goal = createGoalWithStatus('abandoned');

      const service = getGoalService();

      expect(() => service.resumeGoal(goal.id)).toThrow(
        "Cannot resume a goal with status 'abandoned'",
      );
    });

    it('emits goal:updated event', () => {
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();
      const result = service.resumeGoal(goal.id);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        'goal:updated',
        expect.objectContaining({
          id: goal.id,
          status: 'active',
        }),
      );
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // abandonGoal
  // --------------------------------------------------------------------------

  describe('abandonGoal', () => {
    it('transitions a proposed goal to abandoned', () => {
      const goal = createGoalWithStatus('proposed');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id);

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('transitions an active goal to abandoned', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id);

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('transitions a paused goal to abandoned', () => {
      const goal = createGoalWithStatus('paused');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id);

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('saves reason when provided', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id, 'No longer relevant');

      expect(result.status).toBe('abandoned');
      expect(result.abandonedReason).toBe('No longer relevant');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('sets abandonedReason to null when reason not provided', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id);

      expect(result.abandonedReason).toBeNull();
    });

    it('throws NOT_FOUND for a missing goal', () => {
      const service = getGoalService();

      expect(() => service.abandonGoal('nonexistent-id')).toThrow(
        'Goal not found',
      );

      try {
        service.abandonGoal('nonexistent-id');
      } catch (err: any) {
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('throws BAD_REQUEST for a completed goal', () => {
      const goal = createGoalWithStatus('completed');

      const service = getGoalService();

      expect(() => service.abandonGoal(goal.id)).toThrow(
        "Cannot abandon a goal with status 'completed'",
      );

      try {
        service.abandonGoal(goal.id);
      } catch (err: any) {
        expect(err.code).toBe('BAD_REQUEST');
      }
    });

    it('throws BAD_REQUEST for an already abandoned goal', () => {
      const goal = createGoalWithStatus('abandoned');

      const service = getGoalService();

      expect(() => service.abandonGoal(goal.id)).toThrow(
        "Cannot abandon a goal with status 'abandoned'",
      );

      try {
        service.abandonGoal(goal.id);
      } catch (err: any) {
        expect(err.code).toBe('BAD_REQUEST');
      }
    });

    it('emits goal:updated event', () => {
      const goal = createGoalWithStatus('active');

      const service = getGoalService();
      const result = service.abandonGoal(goal.id, 'Testing');

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith(
        'goal:updated',
        expect.objectContaining({
          id: goal.id,
          status: 'abandoned',
          abandonedReason: 'Testing',
        }),
      );
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });
});
