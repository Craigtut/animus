/**
 * Tests for the goals tRPC router mutation endpoints:
 * activateGoal, pauseGoal, resumeGoal, abandonGoal.
 *
 * Uses real in-memory SQLite databases with migrations applied,
 * and mocks the DB getter + event bus to test through the tRPC layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import type { Goal } from '@animus/shared';

// ============================================================================
// Mocks — must be set up before importing the router
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

// ============================================================================
// tRPC caller setup (imported after mocks are registered)
// ============================================================================

import { goalsRouter } from '../../src/api/routers/goals.js';
import { router } from '../../src/api/trpc.js';
import { initTRPC } from '@trpc/server';
import type { TRPCContext } from '../../src/api/trpc.js';

const testRouter = router({ goals: goalsRouter });
const t = initTRPC.context<TRPCContext>().create();
const createCaller = t.createCallerFactory(testRouter);

function getAuthedCaller() {
  return createCaller({
    req: {} as any,
    res: {} as any,
    userId: 'test-user-id',
  });
}

// ============================================================================
// Helpers
// ============================================================================

/** Create a goal in the test DB with a specific status. */
function createGoalWithStatus(
  status: 'proposed' | 'active' | 'paused' | 'completed' | 'abandoned',
): Goal {
  // Create as proposed first, then update if needed
  const goal = heartbeatStore.createGoal(testDb, {
    title: `Test Goal (${status})`,
    description: 'A test goal',
    origin: 'user_directed',
  });

  if (status !== 'proposed') {
    heartbeatStore.updateGoal(testDb, goal.id, { status });
    if (status === 'active') {
      heartbeatStore.updateGoal(testDb, goal.id, { activatedAt: new Date().toISOString() });
    }
  }

  return heartbeatStore.getGoal(testDb, goal.id)!;
}

// ============================================================================
// Tests
// ============================================================================

describe('goals router mutations', () => {
  beforeEach(() => {
    testDb = createTestHeartbeatDb();
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // activateGoal
  // --------------------------------------------------------------------------

  describe('activateGoal', () => {
    it('should activate a proposed goal', async () => {
      const goal = createGoalWithStatus('proposed');
      const caller = getAuthedCaller();

      const result = await caller.goals.activateGoal({ goalId: goal.id });

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('should activate a paused goal', async () => {
      const goal = createGoalWithStatus('paused');
      const caller = getAuthedCaller();

      const result = await caller.goals.activateGoal({ goalId: goal.id });

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('should throw NOT_FOUND when goal does not exist', async () => {
      const caller = getAuthedCaller();

      await expect(
        caller.goals.activateGoal({ goalId: 'nonexistent-id' })
      ).rejects.toThrow('Goal not found');
    });

    it('should throw BAD_REQUEST when goal is already active', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.activateGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot activate a goal with status 'active'");
    });

    it('should throw BAD_REQUEST when goal is completed', async () => {
      const goal = createGoalWithStatus('completed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.activateGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot activate a goal with status 'completed'");
    });

    it('should throw BAD_REQUEST when goal is abandoned', async () => {
      const goal = createGoalWithStatus('abandoned');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.activateGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot activate a goal with status 'abandoned'");
    });

    it('should emit goal:updated event', async () => {
      const goal = createGoalWithStatus('proposed');
      const caller = getAuthedCaller();

      const result = await caller.goals.activateGoal({ goalId: goal.id });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('goal:updated', expect.objectContaining({
        id: goal.id,
        status: 'active',
      }));
      // Verify the emitted goal matches the returned goal
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // pauseGoal
  // --------------------------------------------------------------------------

  describe('pauseGoal', () => {
    it('should pause an active goal', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.pauseGoal({ goalId: goal.id });

      expect(result.status).toBe('paused');
    });

    it('should throw NOT_FOUND when goal does not exist', async () => {
      const caller = getAuthedCaller();

      await expect(
        caller.goals.pauseGoal({ goalId: 'nonexistent-id' })
      ).rejects.toThrow('Goal not found');
    });

    it('should throw BAD_REQUEST when goal is proposed', async () => {
      const goal = createGoalWithStatus('proposed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.pauseGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot pause a goal with status 'proposed'");
    });

    it('should throw BAD_REQUEST when goal is already paused', async () => {
      const goal = createGoalWithStatus('paused');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.pauseGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot pause a goal with status 'paused'");
    });

    it('should throw BAD_REQUEST when goal is completed', async () => {
      const goal = createGoalWithStatus('completed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.pauseGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot pause a goal with status 'completed'");
    });

    it('should throw BAD_REQUEST when goal is abandoned', async () => {
      const goal = createGoalWithStatus('abandoned');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.pauseGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot pause a goal with status 'abandoned'");
    });

    it('should emit goal:updated event', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.pauseGoal({ goalId: goal.id });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('goal:updated', expect.objectContaining({
        id: goal.id,
        status: 'paused',
      }));
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // resumeGoal
  // --------------------------------------------------------------------------

  describe('resumeGoal', () => {
    it('should resume a paused goal and set activatedAt', async () => {
      const goal = createGoalWithStatus('paused');
      const caller = getAuthedCaller();

      const result = await caller.goals.resumeGoal({ goalId: goal.id });

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeTruthy();
    });

    it('should throw NOT_FOUND when goal does not exist', async () => {
      const caller = getAuthedCaller();

      await expect(
        caller.goals.resumeGoal({ goalId: 'nonexistent-id' })
      ).rejects.toThrow('Goal not found');
    });

    it('should throw BAD_REQUEST when goal is proposed', async () => {
      const goal = createGoalWithStatus('proposed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.resumeGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot resume a goal with status 'proposed'");
    });

    it('should throw BAD_REQUEST when goal is active', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.resumeGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot resume a goal with status 'active'");
    });

    it('should throw BAD_REQUEST when goal is completed', async () => {
      const goal = createGoalWithStatus('completed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.resumeGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot resume a goal with status 'completed'");
    });

    it('should throw BAD_REQUEST when goal is abandoned', async () => {
      const goal = createGoalWithStatus('abandoned');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.resumeGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot resume a goal with status 'abandoned'");
    });

    it('should emit goal:updated event', async () => {
      const goal = createGoalWithStatus('paused');
      const caller = getAuthedCaller();

      const result = await caller.goals.resumeGoal({ goalId: goal.id });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('goal:updated', expect.objectContaining({
        id: goal.id,
        status: 'active',
      }));
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });

  // --------------------------------------------------------------------------
  // abandonGoal
  // --------------------------------------------------------------------------

  describe('abandonGoal', () => {
    it('should abandon a proposed goal', async () => {
      const goal = createGoalWithStatus('proposed');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({ goalId: goal.id });

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('should abandon an active goal', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({ goalId: goal.id });

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('should abandon a paused goal', async () => {
      const goal = createGoalWithStatus('paused');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({ goalId: goal.id });

      expect(result.status).toBe('abandoned');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('should set abandonedReason when provided', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({
        goalId: goal.id,
        reason: 'No longer relevant',
      });

      expect(result.status).toBe('abandoned');
      expect(result.abandonedReason).toBe('No longer relevant');
      expect(result.abandonedAt).toBeTruthy();
    });

    it('should set abandonedReason to null when not provided', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({ goalId: goal.id });

      expect(result.abandonedReason).toBeNull();
    });

    it('should throw NOT_FOUND when goal does not exist', async () => {
      const caller = getAuthedCaller();

      await expect(
        caller.goals.abandonGoal({ goalId: 'nonexistent-id' })
      ).rejects.toThrow('Goal not found');
    });

    it('should throw BAD_REQUEST when goal is already completed', async () => {
      const goal = createGoalWithStatus('completed');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.abandonGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot abandon a goal with status 'completed'");
    });

    it('should throw BAD_REQUEST when goal is already abandoned', async () => {
      const goal = createGoalWithStatus('abandoned');
      const caller = getAuthedCaller();

      await expect(
        caller.goals.abandonGoal({ goalId: goal.id })
      ).rejects.toThrow("Cannot abandon a goal with status 'abandoned'");
    });

    it('should emit goal:updated event', async () => {
      const goal = createGoalWithStatus('active');
      const caller = getAuthedCaller();

      const result = await caller.goals.abandonGoal({
        goalId: goal.id,
        reason: 'Testing',
      });

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('goal:updated', expect.objectContaining({
        id: goal.id,
        status: 'abandoned',
        abandonedReason: 'Testing',
      }));
      expect(mockEmit.mock.calls[0]![1]).toEqual(result);
    });
  });
});
