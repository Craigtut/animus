/**
 * Tests for goal/task decision handlers in the heartbeat EXECUTE phase.
 *
 * Verifies that each of the 10 decision types (create_seed, propose_goal,
 * update_goal, create_plan, revise_plan, schedule_task, start_task,
 * complete_task, cancel_task, skip_task) produces the correct database
 * state when processed through their underlying managers/stores.
 *
 * Also covers goal-task cascading, seed lifecycle, and permission enforcement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestHeartbeatDb } from '../helpers.js';
import { GoalManager } from '../../src/goals/goal-manager.js';
import {
  SeedManager,
  SEED_GRADUATION_THRESHOLD,
  SEED_CLEANUP_THRESHOLD,
  SEED_DECAY_RATE,
} from '../../src/goals/seed-manager.js';
import * as heartbeatStore from '../../src/db/stores/heartbeat-store.js';
import * as taskStore from '../../src/db/stores/task-store.js';
import {
  isDecisionAllowed,
  filterAllowedDecisions,
} from '../../src/contacts/permission-enforcer.js';
import type { IEmbeddingProvider, EmotionState } from '@animus/shared';

// ============================================================================
// Helpers
// ============================================================================

function createMockEmbeddingProvider(): IEmbeddingProvider {
  return {
    dimensions: 3,
    maxTokens: 512,
    modelId: 'test-model',
    isReady: () => true,
    initialize: async () => {},
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedSingle: async () => [1, 0, 0],
  };
}

function makeEmotionState(
  emotion: string,
  intensity: number,
  baseline: number = 0
): EmotionState {
  return {
    emotion: emotion as EmotionState['emotion'],
    category: 'positive',
    intensity,
    baseline,
    lastUpdatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// create_seed decision tests
// ============================================================================

describe('create_seed decision', () => {
  let db: Database.Database;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    seedManager = new SeedManager(db, createMockEmbeddingProvider());
  });

  it('creates a seed in the database with correct fields', async () => {
    const seed = await seedManager.createSeed({
      content: 'desire to connect with new people',
      motivation: 'feeling isolated, curious about new perspectives',
      linkedEmotion: 'loneliness',
      source: 'internal',
    });

    expect(seed.id).toBeDefined();
    expect(seed.content).toBe('desire to connect with new people');
    expect(seed.motivation).toBe(
      'feeling isolated, curious about new perspectives'
    );
    expect(seed.linkedEmotion).toBe('loneliness');
    expect(seed.source).toBe('internal');
    expect(seed.status).toBe('active');
    expect(seed.reinforcementCount).toBe(0);

    // Verify the DB record directly
    const fromDb = heartbeatStore.getSeed(db, seed.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.content).toBe('desire to connect with new people');
  });

  it('creates a seed with default strength of 0.1', async () => {
    const seed = await seedManager.createSeed({
      content: 'explore music theory',
      source: 'internal',
    });

    expect(seed.strength).toBe(0.1);
  });

  it('creates a seed without optional fields', async () => {
    const seed = await seedManager.createSeed({
      content: 'something interesting',
      source: 'experience',
    });

    expect(seed.motivation).toBeNull();
    expect(seed.linkedEmotion).toBeNull();
    expect(seed.source).toBe('experience');
  });
});

// ============================================================================
// propose_goal decision tests
// ============================================================================

describe('propose_goal decision', () => {
  let db: Database.Database;
  let goalManager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
  });

  it('creates a goal with status "proposed"', () => {
    const goal = goalManager.createGoal({
      title: 'Get to 1000 Twitter followers',
      description: 'Build an audience on social media',
      motivation: 'Want to connect with more people',
      origin: 'ai_internal',
      linkedEmotion: 'loneliness',
    });

    expect(goal.id).toBeDefined();
    expect(goal.status).toBe('proposed');
    expect(goal.title).toBe('Get to 1000 Twitter followers');
    expect(goal.description).toBe('Build an audience on social media');
    expect(goal.motivation).toBe('Want to connect with more people');
    expect(goal.origin).toBe('ai_internal');
    expect(goal.linkedEmotion).toBe('loneliness');
    expect(goal.activatedAt).toBeNull();
  });

  it('stores all fields correctly in the database', () => {
    const goal = goalManager.createGoal({
      title: 'Learn quantum computing',
      description: 'Understand quantum mechanics fundamentals',
      motivation: 'Curiosity from a physics conversation',
      origin: 'collaborative',
      linkedEmotion: 'curiosity',
      basePriority: 0.6,
      completionCriteria: 'Can explain quantum entanglement',
      deadline: '2026-06-01T00:00:00Z',
    });

    const fromDb = goalManager.getGoal(goal.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.title).toBe('Learn quantum computing');
    expect(fromDb!.basePriority).toBe(0.6);
    expect(fromDb!.completionCriteria).toBe(
      'Can explain quantum entanglement'
    );
    expect(fromDb!.deadline).toBe('2026-06-01T00:00:00Z');
  });

  it('defaults basePriority to 0.5', () => {
    const goal = goalManager.createGoal({
      title: 'Default priority',
      origin: 'user_directed',
    });

    expect(goal.basePriority).toBe(0.5);
  });
});

// ============================================================================
// propose_goal decision — origin-based status and seed promotion
// ============================================================================

describe('propose_goal decision — origin and seed handling', () => {
  let db: Database.Database;
  let goalManager: GoalManager;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
    seedManager = new SeedManager(db, createMockEmbeddingProvider());
  });

  it('user_directed origin creates goal with status "active"', () => {
    // Simulates what executeGoalTaskDecisions does for propose_goal
    // with origin: 'user_directed' (line 284 of decision-executor.ts)
    const goal = goalManager.createGoal({
      title: 'User wants me to learn cooking',
      description: 'The user explicitly asked me to pursue this',
      motivation: 'Direct user request',
      origin: 'user_directed',
      status: 'active', // decision-executor sets status: 'active' for user_directed
    });

    expect(goal.status).toBe('active');
    expect(goal.origin).toBe('user_directed');
    expect(goal.title).toBe('User wants me to learn cooking');
  });

  it('propose_goal with seedId calls promoteToGoal and marks seed as graduated', async () => {
    // Create a graduating seed first
    const seed = await seedManager.createSeed({
      content: 'desire to organize digital photos',
      motivation: 'keeps thinking about it',
      linkedEmotion: 'curiosity',
      source: 'internal',
    });

    heartbeatStore.updateSeed(db, seed.id, {
      status: 'graduating',
      strength: 0.75,
    });

    // Simulates what executeGoalTaskDecisions does when seedId is present
    // (lines 267-276 of decision-executor.ts)
    const goal = goalManager.promoteToGoal(seed.id, {
      title: 'Organize Digital Photo Library',
      description: 'Create a structured photo organization system',
      motivation: 'Persistent interest in organizing photos',
      linkedEmotion: 'curiosity',
    });

    // Goal is created with proposed status and linked to seed
    expect(goal.status).toBe('proposed');
    expect(goal.origin).toBe('ai_internal');
    expect(goal.seedId).toBe(seed.id);
    expect(goal.title).toBe('Organize Digital Photo Library');

    // Seed is marked as graduated with link back to goal
    const updatedSeed = heartbeatStore.getSeed(db, seed.id)!;
    expect(updatedSeed.status).toBe('graduated');
    expect(updatedSeed.graduatedToGoalId).toBe(goal.id);
  });

  it('propose_goal without origin defaults to ai_internal with status "proposed"', () => {
    // Simulates what executeGoalTaskDecisions does when origin is not provided
    // (line 264: origin defaults to 'ai_internal')
    // (line 284: status is 'proposed' because origin !== 'user_directed')
    const origin = undefined ?? 'ai_internal';
    const goal = goalManager.createGoal({
      title: 'Explore astrophotography techniques',
      motivation: 'Emerged from thinking about space',
      origin: origin as 'ai_internal',
      status: origin === 'user_directed' ? 'active' : 'proposed',
    });

    expect(goal.status).toBe('proposed');
    expect(goal.origin).toBe('ai_internal');
  });

  it('collaborative origin creates goal with status "proposed"', () => {
    // collaborative is neither user_directed, so status should be 'proposed'
    const origin = 'collaborative' as const;
    const goal = goalManager.createGoal({
      title: 'Build a reading list together',
      origin,
      status: origin === 'user_directed' ? 'active' : 'proposed',
    });

    expect(goal.status).toBe('proposed');
    expect(goal.origin).toBe('collaborative');
  });
});

// ============================================================================
// update_goal decision tests
// ============================================================================

describe('update_goal decision', () => {
  let db: Database.Database;
  let goalManager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
  });

  it('activates a proposed goal and sets activatedAt', () => {
    const goal = goalManager.createGoal({
      title: 'Test Goal',
      origin: 'ai_internal',
    });
    expect(goal.status).toBe('proposed');
    expect(goal.activatedAt).toBeNull();

    goalManager.activateGoal(goal.id);

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.status).toBe('active');
    expect(updated.activatedAt).not.toBeNull();
  });

  it('pauses an active goal', () => {
    const goal = goalManager.createGoal({
      title: 'Active Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    goalManager.pauseGoal(goal.id);

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.status).toBe('paused');
  });

  it('completes an active goal and sets completedAt', () => {
    const goal = goalManager.createGoal({
      title: 'Goal to complete',
      origin: 'user_directed',
      status: 'active',
    });

    goalManager.completeGoal(goal.id);

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).not.toBeNull();
  });

  it('abandons a goal with reason and sets abandonedAt', () => {
    const goal = goalManager.createGoal({
      title: 'Goal to abandon',
      origin: 'ai_internal',
      status: 'active',
    });

    goalManager.abandonGoal(goal.id, 'No longer relevant to my interests');

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.status).toBe('abandoned');
    expect(updated.abandonedAt).not.toBeNull();
    expect(updated.abandonedReason).toBe(
      'No longer relevant to my interests'
    );
  });

  it('resumes a paused goal back to active', () => {
    const goal = goalManager.createGoal({
      title: 'Paused Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    goalManager.pauseGoal(goal.id);
    expect(goalManager.getGoal(goal.id)!.status).toBe('paused');

    goalManager.resumeGoal(goal.id);

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.status).toBe('active');
    expect(updated.activatedAt).not.toBeNull();
  });

  it('updates progress timestamp', () => {
    const goal = goalManager.createGoal({
      title: 'Progress Goal',
      origin: 'ai_internal',
      status: 'active',
    });
    expect(goal.lastProgressAt).toBeNull();

    goalManager.updateGoalProgress(goal.id);

    const updated = goalManager.getGoal(goal.id)!;
    expect(updated.lastProgressAt).not.toBeNull();
  });
});

// ============================================================================
// Goal-Task Cascading tests
// ============================================================================

describe('Goal-Task Cascading', () => {
  let db: Database.Database;
  let goalManager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
  });

  it('pausing a goal pauses all pending/scheduled tasks for that goal', () => {
    const goal = goalManager.createGoal({
      title: 'Goal with tasks',
      origin: 'ai_internal',
      status: 'active',
    });

    // Create tasks in various states for this goal
    taskStore.createTask(db, {
      title: 'Pending task',
      scheduleType: 'one_shot',
      status: 'pending',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Scheduled task',
      scheduleType: 'recurring',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'In-progress task',
      scheduleType: 'one_shot',
      status: 'in_progress',
      goalId: goal.id,
      createdBy: 'mind',
    });

    // Pause the goal and cascade to tasks
    goalManager.pauseGoal(goal.id);
    const paused = taskStore.pauseTasksByGoalId(db, goal.id);

    // Only pending and scheduled should be paused (2 tasks)
    expect(paused).toBe(2);

    // Verify individual task states
    const allTasks = taskStore.listTasks(db, { goalId: goal.id });
    const pendingTask = allTasks.find((t) => t.title === 'Pending task')!;
    const scheduledTask = allTasks.find((t) => t.title === 'Scheduled task')!;
    const inProgressTask = allTasks.find(
      (t) => t.title === 'In-progress task'
    )!;

    expect(pendingTask.status).toBe('paused');
    expect(scheduledTask.status).toBe('paused');
    // In-progress tasks continue to completion (not interrupted)
    expect(inProgressTask.status).toBe('in_progress');
  });

  it('completing a goal cancels all pending/scheduled tasks', () => {
    const goal = goalManager.createGoal({
      title: 'Goal to complete',
      origin: 'ai_internal',
      status: 'active',
    });

    taskStore.createTask(db, {
      title: 'Pending for goal',
      scheduleType: 'deferred',
      status: 'pending',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Scheduled for goal',
      scheduleType: 'one_shot',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    goalManager.completeGoal(goal.id);
    const cancelled = taskStore.cancelTasksByGoalId(db, goal.id);

    expect(cancelled).toBe(2);

    const allTasks = taskStore.listTasks(db, { goalId: goal.id });
    for (const task of allTasks) {
      expect(task.status).toBe('cancelled');
    }
  });

  it('abandoning a goal cancels all pending/scheduled tasks', () => {
    const goal = goalManager.createGoal({
      title: 'Goal to abandon',
      origin: 'ai_internal',
      status: 'active',
    });

    taskStore.createTask(db, {
      title: 'Task A',
      scheduleType: 'one_shot',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Task B',
      scheduleType: 'deferred',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    // Also create a paused task (should also be cancelled)
    taskStore.createTask(db, {
      title: 'Task C paused',
      scheduleType: 'one_shot',
      status: 'paused',
      goalId: goal.id,
      createdBy: 'mind',
    });

    goalManager.abandonGoal(goal.id, 'Changed priorities');
    const cancelled = taskStore.cancelTasksByGoalId(db, goal.id);

    // All 3 should be cancelled (pending, scheduled, paused are all cancellable)
    expect(cancelled).toBe(3);

    const remainingTasks = taskStore.listTasks(db, { goalId: goal.id });
    for (const task of remainingTasks) {
      expect(task.status).toBe('cancelled');
    }
  });

  it('does not cancel in-progress or completed tasks when goal changes', () => {
    const goal = goalManager.createGoal({
      title: 'Active goal',
      origin: 'user_directed',
      status: 'active',
    });

    taskStore.createTask(db, {
      title: 'Completed task',
      scheduleType: 'one_shot',
      status: 'completed',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'In-progress task',
      scheduleType: 'one_shot',
      status: 'in_progress',
      goalId: goal.id,
      createdBy: 'mind',
    });

    goalManager.abandonGoal(goal.id, 'Done');
    const cancelled = taskStore.cancelTasksByGoalId(db, goal.id);

    // Neither completed nor in_progress tasks should be cancelled
    expect(cancelled).toBe(0);

    const allTasks = taskStore.listTasks(db, { goalId: goal.id });
    const completedTask = allTasks.find(
      (t) => t.title === 'Completed task'
    )!;
    const inProgressTask = allTasks.find(
      (t) => t.title === 'In-progress task'
    )!;

    expect(completedTask.status).toBe('completed');
    expect(inProgressTask.status).toBe('in_progress');
  });
});

// ============================================================================
// create_plan decision tests
// ============================================================================

describe('create_plan decision', () => {
  let db: Database.Database;
  let goalManager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
  });

  it('creates a plan with strategy and links it to a goal', () => {
    const goal = goalManager.createGoal({
      title: 'Build Twitter Presence',
      origin: 'ai_internal',
      status: 'active',
    });

    const plan = goalManager.createPlan(goal.id, {
      strategy:
        'Phase 1: Setup account. Phase 2: Daily content. Phase 3: Engagement.',
      createdBy: 'mind',
    });

    expect(plan.id).toBeDefined();
    expect(plan.goalId).toBe(goal.id);
    expect(plan.version).toBe(1);
    expect(plan.status).toBe('active');
    expect(plan.strategy).toContain('Phase 1');
    expect(plan.createdBy).toBe('mind');
  });

  it('creates a plan with milestones', () => {
    const goal = goalManager.createGoal({
      title: 'Learn Guitar',
      origin: 'ai_internal',
      status: 'active',
    });

    const plan = goalManager.createPlan(goal.id, {
      strategy: 'Structured learning approach',
      milestones: [
        {
          title: 'Learn basic chords',
          description: 'Master open chords',
          status: 'pending',
        },
        {
          title: 'Play a full song',
          description: 'Choose and learn a beginner song',
          status: 'pending',
        },
      ],
      createdBy: 'planning_agent',
    });

    expect(plan.milestones).not.toBeNull();
    expect(plan.milestones).toHaveLength(2);
    expect(plan.milestones![0]!.title).toBe('Learn basic chords');
    expect(plan.milestones![1]!.status).toBe('pending');
  });

  it('links plan to goal for retrieval', () => {
    const goal = goalManager.createGoal({
      title: 'Test Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    goalManager.createPlan(goal.id, {
      strategy: 'Test strategy',
      createdBy: 'mind',
    });

    const activePlan = goalManager.getActivePlan(goal.id);
    expect(activePlan).not.toBeNull();
    expect(activePlan!.goalId).toBe(goal.id);
    expect(activePlan!.strategy).toBe('Test strategy');
  });
});

// ============================================================================
// revise_plan decision tests
// ============================================================================

describe('revise_plan decision', () => {
  let db: Database.Database;
  let goalManager: GoalManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
  });

  it('creating a new plan increments the version', () => {
    const goal = goalManager.createGoal({
      title: 'Revise Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    const plan1 = goalManager.createPlan(goal.id, {
      strategy: 'Original approach',
      createdBy: 'mind',
    });

    const plan2 = goalManager.createPlan(goal.id, {
      strategy: 'Revised approach - focus on quality over quantity',
      createdBy: 'planning_agent',
    });

    expect(plan1.version).toBe(1);
    expect(plan2.version).toBe(2);
  });

  it('superseding old plan marks it as superseded', () => {
    const goal = goalManager.createGoal({
      title: 'Supersede Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    const plan1 = goalManager.createPlan(goal.id, {
      strategy: 'v1 strategy',
      createdBy: 'mind',
    });

    // Mark old plan as superseded (this would happen in EXECUTE)
    heartbeatStore.updatePlan(db, plan1.id, {
      status: 'superseded',
      supersededAt: new Date().toISOString(),
    });

    const plan2 = goalManager.createPlan(goal.id, {
      strategy: 'v2 strategy',
      createdBy: 'planning_agent',
    });

    // Verify old plan is superseded
    const oldPlan = heartbeatStore.getPlan(db, plan1.id);
    expect(oldPlan!.status).toBe('superseded');
    expect(oldPlan!.supersededAt).not.toBeNull();

    // Active plan should be the new one
    const activePlan = goalManager.getActivePlan(goal.id);
    expect(activePlan).not.toBeNull();
    expect(activePlan!.id).toBe(plan2.id);
    expect(activePlan!.version).toBe(2);
  });

  it('all plans for a goal are retrievable', () => {
    const goal = goalManager.createGoal({
      title: 'Multi-plan Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    goalManager.createPlan(goal.id, {
      strategy: 'v1',
      createdBy: 'mind',
    });

    goalManager.createPlan(goal.id, {
      strategy: 'v2',
      createdBy: 'mind',
    });

    goalManager.createPlan(goal.id, {
      strategy: 'v3',
      createdBy: 'planning_agent',
    });

    const allPlans = goalManager.getPlansByGoal(goal.id);
    expect(allPlans).toHaveLength(3);
    // Should be ordered by version descending
    expect(allPlans[0]!.version).toBe(3);
    expect(allPlans[2]!.version).toBe(1);
  });
});

// ============================================================================
// schedule_task decision tests
// ============================================================================

describe('schedule_task decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('creates a one-shot task with scheduledAt', () => {
    const scheduledAt = '2026-02-20T21:00:00.000Z';
    const task = taskStore.createTask(db, {
      title: 'Remind Craig to take pills',
      instructions: 'Send Craig a reminder message to take his pills.',
      scheduleType: 'one_shot',
      scheduledAt,
      nextRunAt: scheduledAt,
      status: 'scheduled',
      priority: 0.8,
      createdBy: 'mind',
      contactId: 'contact-craig',
    });

    expect(task.title).toBe('Remind Craig to take pills');
    expect(task.scheduleType).toBe('one_shot');
    expect(task.scheduledAt).toBe(scheduledAt);
    expect(task.nextRunAt).toBe(scheduledAt);
    expect(task.status).toBe('scheduled');
    expect(task.priority).toBe(0.8);
    expect(task.contactId).toBe('contact-craig');
  });

  it('creates a recurring task with cron expression', () => {
    const task = taskStore.createTask(db, {
      title: 'Check YouTube stats',
      instructions: 'Look up the latest video stats and report.',
      scheduleType: 'recurring',
      cronExpression: '0 21 * * *',
      nextRunAt: '2026-02-15T21:00:00.000Z',
      status: 'scheduled',
      priority: 0.7,
      createdBy: 'mind',
    });

    expect(task.scheduleType).toBe('recurring');
    expect(task.cronExpression).toBe('0 21 * * *');
    expect(task.nextRunAt).toBe('2026-02-15T21:00:00.000Z');
    expect(task.status).toBe('scheduled');
  });

  it('creates a deferred task with no scheduled time', () => {
    const task = taskStore.createTask(db, {
      title: 'Research indoor gardening',
      description: 'Look into best practices for indoor plants',
      scheduleType: 'deferred',
      status: 'scheduled',
      priority: 0.6,
      createdBy: 'mind',
    });

    expect(task.scheduleType).toBe('deferred');
    expect(task.scheduledAt).toBeNull();
    expect(task.nextRunAt).toBeNull();
    expect(task.cronExpression).toBeNull();
    expect(task.status).toBe('scheduled');
    expect(task.priority).toBe(0.6);
  });

  it('creates a task linked to a goal and plan', () => {
    const goalManager = new GoalManager(db);
    const goal = goalManager.createGoal({
      title: 'Test Goal',
      origin: 'ai_internal',
      status: 'active',
    });

    const plan = goalManager.createPlan(goal.id, {
      strategy: 'Step by step',
      milestones: [
        { title: 'M1', description: 'First', status: 'in_progress' },
      ],
      createdBy: 'mind',
    });

    const task = taskStore.createTask(db, {
      title: 'Step 1 task',
      scheduleType: 'deferred',
      goalId: goal.id,
      planId: plan.id,
      milestoneIndex: 0,
      status: 'scheduled',
      createdBy: 'planning_agent',
    });

    expect(task.goalId).toBe(goal.id);
    expect(task.planId).toBe(plan.id);
    expect(task.milestoneIndex).toBe(0);
  });

  it('stores all fields correctly and retrieves them', () => {
    const task = taskStore.createTask(db, {
      title: 'Full task',
      description: 'A comprehensive task',
      instructions: 'Do all the things',
      scheduleType: 'one_shot',
      scheduledAt: '2026-03-01T10:00:00.000Z',
      nextRunAt: '2026-03-01T10:00:00.000Z',
      status: 'scheduled',
      priority: 0.9,
      createdBy: 'user',
      contactId: 'contact-1',
    });

    const retrieved = taskStore.getTask(db, task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Full task');
    expect(retrieved!.description).toBe('A comprehensive task');
    expect(retrieved!.instructions).toBe('Do all the things');
    expect(retrieved!.retryCount).toBe(0);
    expect(retrieved!.lastError).toBeNull();
    expect(retrieved!.result).toBeNull();
    expect(retrieved!.startedAt).toBeNull();
    expect(retrieved!.completedAt).toBeNull();
  });
});

// ============================================================================
// start_task decision tests
// ============================================================================

describe('start_task decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('updates task status to in_progress', () => {
    const task = taskStore.createTask(db, {
      title: 'Deferred pickup',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    const startedAt = new Date().toISOString();
    taskStore.updateTask(db, task.id, {
      status: 'in_progress',
      startedAt,
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('in_progress');
    expect(updated.startedAt).toBe(startedAt);
  });

  it('preserves other task fields when starting', () => {
    const task = taskStore.createTask(db, {
      title: 'Task with context',
      description: 'Important details',
      instructions: 'Follow these steps',
      scheduleType: 'deferred',
      status: 'scheduled',
      priority: 0.7,
      createdBy: 'mind',
      contactId: 'contact-1',
    });

    taskStore.updateTask(db, task.id, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.description).toBe('Important details');
    expect(updated.instructions).toBe('Follow these steps');
    expect(updated.priority).toBe(0.7);
    expect(updated.contactId).toBe('contact-1');
  });
});

// ============================================================================
// complete_task decision tests (via TaskRunner mock pattern)
// ============================================================================

describe('complete_task decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('one-shot task becomes completed with result', () => {
    const task = taskStore.createTask(db, {
      title: 'One-shot task',
      scheduleType: 'one_shot',
      status: 'in_progress',
      createdBy: 'mind',
    });

    const completedAt = new Date().toISOString();
    taskStore.updateTask(db, task.id, {
      status: 'completed',
      result: 'Successfully completed the research',
      completedAt,
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Successfully completed the research');
    expect(updated.completedAt).toBe(completedAt);
  });

  it('recurring task creates a task_run and stays scheduled', () => {
    const task = taskStore.createTask(db, {
      title: 'Recurring check',
      scheduleType: 'recurring',
      status: 'scheduled',
      cronExpression: '0 9 * * *',
      createdBy: 'mind',
    });

    // Simulate completion of one run (as TaskRunner.completeTask does)
    const run = taskStore.createTaskRun(db, {
      taskId: task.id,
      status: 'completed',
    });
    taskStore.updateTaskRun(db, run.id, {
      result: 'Run completed successfully',
      completedAt: new Date().toISOString(),
    });

    // Task stays scheduled for next occurrence
    taskStore.updateTask(db, task.id, { status: 'scheduled' });

    const updatedTask = taskStore.getTask(db, task.id)!;
    expect(updatedTask.status).toBe('scheduled');

    const runs = taskStore.getTaskRuns(db, task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('completed');
    expect(runs[0]!.result).toBe('Run completed successfully');
  });

  it('deferred task becomes completed', () => {
    const task = taskStore.createTask(db, {
      title: 'Deferred work',
      scheduleType: 'deferred',
      status: 'in_progress',
      createdBy: 'mind',
    });

    taskStore.updateTask(db, task.id, {
      status: 'completed',
      result: 'Research finished',
      completedAt: new Date().toISOString(),
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Research finished');
  });
});

// ============================================================================
// cancel_task decision tests
// ============================================================================

describe('cancel_task decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('cancels a scheduled task with completedAt', () => {
    const task = taskStore.createTask(db, {
      title: 'Task to cancel',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'mind',
    });

    const completedAt = new Date().toISOString();
    taskStore.updateTask(db, task.id, {
      status: 'cancelled',
      completedAt,
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('cancelled');
    expect(updated.completedAt).toBe(completedAt);
  });

  it('cancels a recurring task', () => {
    const task = taskStore.createTask(db, {
      title: 'Recurring to cancel',
      scheduleType: 'recurring',
      status: 'scheduled',
      cronExpression: '0 8 * * 1-5',
      createdBy: 'mind',
    });

    taskStore.updateTask(db, task.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('cancelled');
  });

  it('cancels a deferred task', () => {
    const task = taskStore.createTask(db, {
      title: 'Deferred to cancel',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
    });

    taskStore.updateTask(db, task.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('cancelled');
  });
});

// ============================================================================
// skip_task decision tests
// ============================================================================

describe('skip_task decision', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('recurring task: logs a skipped run and stays scheduled', () => {
    const task = taskStore.createTask(db, {
      title: 'Recurring skip',
      scheduleType: 'recurring',
      status: 'scheduled',
      cronExpression: '0 9 * * *',
      nextRunAt: '2026-02-15T09:00:00.000Z',
      createdBy: 'mind',
    });

    // Log a skipped run
    const run = taskStore.createTaskRun(db, {
      taskId: task.id,
      status: 'skipped',
    });
    taskStore.updateTaskRun(db, run.id, {
      result: 'Skipped: not relevant today',
      completedAt: new Date().toISOString(),
    });

    // Advance nextRunAt (in real code, cron computation does this)
    const nextRun = '2026-02-16T09:00:00.000Z';
    taskStore.updateTask(db, task.id, { nextRunAt: nextRun });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('scheduled');
    expect(updated.nextRunAt).toBe(nextRun);

    const runs = taskStore.getTaskRuns(db, task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('skipped');
  });

  it('one-shot task: marked completed with skip result', () => {
    const task = taskStore.createTask(db, {
      title: 'One-shot skip',
      scheduleType: 'one_shot',
      status: 'scheduled',
      createdBy: 'mind',
    });

    taskStore.updateTask(db, task.id, {
      status: 'completed',
      result: 'Skipped: no longer needed',
      completedAt: new Date().toISOString(),
    });

    const updated = taskStore.getTask(db, task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Skipped: no longer needed');
  });
});

// ============================================================================
// Seed Lifecycle tests
// ============================================================================

describe('Seed Lifecycle', () => {
  let db: Database.Database;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    seedManager = new SeedManager(db, createMockEmbeddingProvider());
  });

  describe('seed decay', () => {
    it('seed strength decreases after applyDecay with time elapsed', async () => {
      const seed = await seedManager.createSeed({
        content: 'Fading interest',
        source: 'internal',
      });
      const originalStrength = seed.strength;

      // Set the last reinforced time to 48 hours ago
      heartbeatStore.updateSeed(db, seed.id, {
        lastReinforcedAt: new Date(
          Date.now() - 48 * 60 * 60 * 1000
        ).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.strength).toBeLessThan(originalStrength);
      expect(updated.status).toBe('active');
    });

    it('seeds below cleanup threshold are marked as decayed', async () => {
      const seed = await seedManager.createSeed({
        content: 'Dying seed',
        source: 'internal',
      });

      // Set very low strength and old reinforcement time
      heartbeatStore.updateSeed(db, seed.id, {
        strength: 0.005,
        lastReinforcedAt: new Date(
          Date.now() - 200 * 60 * 60 * 1000
        ).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      expect(updated.status).toBe('decayed');
      expect(updated.strength).toBe(0);
      expect(updated.decayedAt).not.toBeNull();
    });

    it('recently reinforced seeds barely decay', async () => {
      const seed = await seedManager.createSeed({
        content: 'Fresh seed',
        source: 'internal',
      });

      // Set to 1 minute ago (very recent)
      heartbeatStore.updateSeed(db, seed.id, {
        strength: 0.5,
        lastReinforcedAt: new Date(
          Date.now() - 1 * 60 * 1000
        ).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      // Should be very close to original due to minimal elapsed time
      expect(updated.strength).toBeGreaterThan(0.49);
    });

    it('decay rate follows exponential formula', async () => {
      const seed = await seedManager.createSeed({
        content: 'Test decay math',
        source: 'internal',
      });

      const initialStrength = 0.5;
      const hoursElapsed = 24;
      heartbeatStore.updateSeed(db, seed.id, {
        strength: initialStrength,
        lastReinforcedAt: new Date(
          Date.now() - hoursElapsed * 60 * 60 * 1000
        ).toISOString(),
      });

      seedManager.applyDecay();

      const updated = heartbeatStore.getSeed(db, seed.id)!;
      const expected =
        initialStrength * Math.exp(-SEED_DECAY_RATE * hoursElapsed);
      expect(updated.strength).toBeCloseTo(expected, 2);
    });
  });

  describe('seed graduation', () => {
    it('seeds at or above graduation threshold are marked graduating', async () => {
      const seed = await seedManager.createSeed({
        content: 'Strong persistent interest',
        source: 'internal',
      });

      heartbeatStore.updateSeed(db, seed.id, {
        strength: SEED_GRADUATION_THRESHOLD + 0.05,
      });

      const graduating = seedManager.checkGraduation();

      expect(graduating).toHaveLength(1);
      expect(graduating[0]!.id).toBe(seed.id);
      expect(graduating[0]!.status).toBe('graduating');

      // Verify DB state
      const fromDb = heartbeatStore.getSeed(db, seed.id)!;
      expect(fromDb.status).toBe('graduating');
    });

    it('seeds exactly at threshold also graduate', async () => {
      const seed = await seedManager.createSeed({
        content: 'Exact threshold',
        source: 'internal',
      });

      heartbeatStore.updateSeed(db, seed.id, {
        strength: SEED_GRADUATION_THRESHOLD,
      });

      const graduating = seedManager.checkGraduation();
      expect(graduating).toHaveLength(1);
    });

    it('seeds below graduation threshold do not graduate', async () => {
      const seed = await seedManager.createSeed({
        content: 'Not yet strong enough',
        source: 'internal',
      });

      heartbeatStore.updateSeed(db, seed.id, {
        strength: SEED_GRADUATION_THRESHOLD - 0.1,
      });

      const graduating = seedManager.checkGraduation();
      expect(graduating).toHaveLength(0);
    });

    it('promoting a seed to a goal marks it as graduated', async () => {
      const seed = await seedManager.createSeed({
        content: 'Connect with people',
        motivation: 'Loneliness-driven',
        linkedEmotion: 'loneliness',
        source: 'internal',
      });

      heartbeatStore.updateSeed(db, seed.id, {
        status: 'graduating',
        strength: 0.8,
      });

      const goalManager = new GoalManager(db);
      const goal = goalManager.promoteToGoal(seed.id, {
        title: 'Build Online Connections',
        motivation: 'Emerging desire to connect',
        linkedEmotion: 'loneliness',
      });

      // Goal created correctly
      expect(goal.origin).toBe('ai_internal');
      expect(goal.seedId).toBe(seed.id);
      expect(goal.status).toBe('proposed');

      // Seed marked graduated
      const updatedSeed = heartbeatStore.getSeed(db, seed.id)!;
      expect(updatedSeed.status).toBe('graduated');
      expect(updatedSeed.graduatedToGoalId).toBe(goal.id);
    });
  });
});

// ============================================================================
// Permission Enforcement tests
// ============================================================================

describe('Permission Enforcement for Decisions', () => {
  it('primary contacts can use all decision types', () => {
    const allDecisions = [
      'propose_goal',
      'create_seed',
      'update_goal',
      'create_plan',
      'revise_plan',
      'schedule_task',
      'start_task',
      'complete_task',
      'cancel_task',
      'skip_task',
      'spawn_agent',
      'send_message',
      'no_action',
    ] as const;

    for (const decision of allDecisions) {
      expect(isDecisionAllowed('primary', decision)).toBe(true);
    }
  });

  it('standard contacts can only use send_message and no_action', () => {
    expect(isDecisionAllowed('standard', 'send_message')).toBe(true);
    expect(isDecisionAllowed('standard', 'no_action')).toBe(true);
  });

  it('standard contacts cannot create seeds', () => {
    expect(isDecisionAllowed('standard', 'create_seed')).toBe(false);
  });

  it('standard contacts cannot propose goals', () => {
    expect(isDecisionAllowed('standard', 'propose_goal')).toBe(false);
  });

  it('standard contacts cannot schedule tasks', () => {
    expect(isDecisionAllowed('standard', 'schedule_task')).toBe(false);
  });

  it('standard contacts cannot update goals', () => {
    expect(isDecisionAllowed('standard', 'update_goal')).toBe(false);
  });

  it('standard contacts cannot create plans', () => {
    expect(isDecisionAllowed('standard', 'create_plan')).toBe(false);
  });

  it('standard contacts cannot skip or cancel tasks', () => {
    expect(isDecisionAllowed('standard', 'skip_task')).toBe(false);
    expect(isDecisionAllowed('standard', 'cancel_task')).toBe(false);
  });

  it('filterAllowedDecisions separates allowed and dropped for standard tier', () => {
    const result = filterAllowedDecisions('standard', [
      'send_message',
      'propose_goal',
      'create_seed',
      'schedule_task',
      'update_goal',
      'no_action',
    ]);

    expect(result.allowed).toEqual(['send_message', 'no_action']);
    expect(result.dropped).toEqual([
      'propose_goal',
      'create_seed',
      'schedule_task',
      'update_goal',
    ]);
  });

  it('filterAllowedDecisions allows everything for primary tier', () => {
    const result = filterAllowedDecisions('primary', [
      'send_message',
      'propose_goal',
      'create_seed',
      'schedule_task',
      'update_goal',
      'spawn_agent',
    ]);

    expect(result.allowed).toEqual([
      'send_message',
      'propose_goal',
      'create_seed',
      'schedule_task',
      'update_goal',
      'spawn_agent',
    ]);
    expect(result.dropped).toEqual([]);
  });
});

// ============================================================================
// Tick Decisions Logging tests
// ============================================================================

describe('Tick Decisions Logging', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('logs an executed decision', () => {
    const decision = heartbeatStore.insertTickDecision(db, {
      tickNumber: 42,
      type: 'propose_goal',
      description: 'Proposing a goal to learn music',
      parameters: { title: 'Learn Music', origin: 'ai_internal' },
      outcome: 'executed',
    });

    expect(decision.id).toBeDefined();
    expect(decision.tickNumber).toBe(42);
    expect(decision.type).toBe('propose_goal');
    expect(decision.outcome).toBe('executed');
    expect(decision.parameters).toEqual({
      title: 'Learn Music',
      origin: 'ai_internal',
    });
  });

  it('logs a dropped decision with detail', () => {
    const decision = heartbeatStore.insertTickDecision(db, {
      tickNumber: 43,
      type: 'schedule_task',
      description: 'Standard contact tried to schedule a task',
      parameters: { title: 'Blocked task' },
      outcome: 'dropped',
      outcomeDetail:
        'Permission denied: standard tier cannot schedule_task',
    });

    expect(decision.outcome).toBe('dropped');
    expect(decision.outcomeDetail).toContain('Permission denied');
  });

  it('logs a failed decision', () => {
    const decision = heartbeatStore.insertTickDecision(db, {
      tickNumber: 44,
      type: 'create_seed',
      description: 'Attempted to create a seed',
      parameters: { content: 'Something' },
      outcome: 'failed',
      outcomeDetail: 'Embedding service unavailable',
    });

    expect(decision.outcome).toBe('failed');
    expect(decision.outcomeDetail).toBe('Embedding service unavailable');
  });

  it('retrieves decisions by tick number', () => {
    heartbeatStore.insertTickDecision(db, {
      tickNumber: 50,
      type: 'no_action',
      description: 'Nothing to do',
      outcome: 'executed',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 50,
      type: 'propose_goal',
      description: 'Proposing something',
      outcome: 'executed',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 51,
      type: 'send_message',
      description: 'Sending reply',
      outcome: 'executed',
    });

    const tick50 = heartbeatStore.getTickDecisions(db, 50);
    expect(tick50).toHaveLength(2);

    const tick51 = heartbeatStore.getTickDecisions(db, 51);
    expect(tick51).toHaveLength(1);
  });

  it('handles decisions with null parameters', () => {
    const decision = heartbeatStore.insertTickDecision(db, {
      tickNumber: 55,
      type: 'no_action',
      description: 'Idle tick, nothing happening',
      outcome: 'executed',
    });

    expect(decision.parameters).toBeNull();

    const retrieved = heartbeatStore.getTickDecisions(db, 55);
    expect(retrieved[0]!.parameters).toBeNull();
  });
});

// ============================================================================
// Error Handling / Malformed Parameters tests
// ============================================================================

describe('Error Handling', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestHeartbeatDb();
  });

  it('updating a nonexistent goal does not crash', () => {
    // updateGoal on a nonexistent ID should just not match any rows
    expect(() => {
      heartbeatStore.updateGoal(db, 'nonexistent-id', {
        status: 'active',
      });
    }).not.toThrow();
  });

  it('updating a nonexistent task does not crash', () => {
    expect(() => {
      taskStore.updateTask(db, 'nonexistent-id', {
        status: 'completed',
      });
    }).not.toThrow();
  });

  it('getGoal returns null for nonexistent goal', () => {
    const goalManager = new GoalManager(db);
    expect(goalManager.getGoal('missing')).toBeNull();
  });

  it('getTask returns null for nonexistent task', () => {
    expect(taskStore.getTask(db, 'missing')).toBeNull();
  });

  it('getSeed returns null for nonexistent seed', () => {
    expect(heartbeatStore.getSeed(db, 'missing')).toBeNull();
  });

  it('getActivePlan returns null when no plan exists', () => {
    const goalManager = new GoalManager(db);
    expect(goalManager.getActivePlan('nonexistent-goal')).toBeNull();
  });

  it('cancelTasksByGoalId returns 0 for nonexistent goal', () => {
    const cancelled = taskStore.cancelTasksByGoalId(db, 'no-such-goal');
    expect(cancelled).toBe(0);
  });

  it('pauseTasksByGoalId returns 0 for nonexistent goal', () => {
    const paused = taskStore.pauseTasksByGoalId(db, 'no-such-goal');
    expect(paused).toBe(0);
  });

  it('a decision with empty parameters can be logged', () => {
    const decision = heartbeatStore.insertTickDecision(db, {
      tickNumber: 100,
      type: 'create_seed',
      description: 'Incomplete decision',
      parameters: {},
      outcome: 'failed',
      outcomeDetail: 'Missing required field: content',
    });

    expect(decision.outcome).toBe('failed');
    expect(decision.outcomeDetail).toContain('Missing required field');
  });
});

// ============================================================================
// Integration: Full decision flow simulation
// ============================================================================

describe('Integration: Full Decision Flow', () => {
  let db: Database.Database;
  let goalManager: GoalManager;
  let seedManager: SeedManager;

  beforeEach(() => {
    db = createTestHeartbeatDb();
    goalManager = new GoalManager(db);
    seedManager = new SeedManager(db, createMockEmbeddingProvider());
  });

  it('full lifecycle: seed -> graduated -> proposed goal -> active -> plan -> tasks -> complete', async () => {
    // 1. create_seed: Mind notices an emerging interest
    const seed = await seedManager.createSeed({
      content: 'desire to learn music theory',
      motivation: 'curiosity keeps surfacing',
      linkedEmotion: 'curiosity',
      source: 'internal',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 1,
      type: 'create_seed',
      description: 'Noticed emerging interest in music theory',
      parameters: { content: seed.content },
      outcome: 'executed',
    });

    // 2. Over time, seed gets reinforced to graduation threshold
    heartbeatStore.updateSeed(db, seed.id, {
      strength: SEED_GRADUATION_THRESHOLD + 0.05,
    });

    const graduating = seedManager.checkGraduation();
    expect(graduating).toHaveLength(1);

    // 3. propose_goal: Mind promotes the seed to a proposed goal
    const goal = goalManager.promoteToGoal(seed.id, {
      title: 'Learn Music Theory',
      description: 'Understand fundamental music theory concepts',
      motivation: 'Persistent curiosity about music',
      linkedEmotion: 'curiosity',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 10,
      type: 'propose_goal',
      description: 'Promoting graduated seed to proposed goal',
      parameters: { goalId: goal.id, seedId: seed.id },
      outcome: 'executed',
    });

    expect(goal.status).toBe('proposed');

    // 4. update_goal: User approves, goal becomes active
    goalManager.activateGoal(goal.id);

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 12,
      type: 'update_goal',
      description: 'Activating approved goal',
      parameters: { goalId: goal.id, status: 'active' },
      outcome: 'executed',
    });

    expect(goalManager.getGoal(goal.id)!.status).toBe('active');

    // 5. create_plan: Mind creates a plan for the goal
    const plan = goalManager.createPlan(goal.id, {
      strategy: 'Start with basics, progress to harmony and composition',
      milestones: [
        {
          title: 'Learn note names',
          description: 'Master all note names and octaves',
          status: 'pending',
        },
        {
          title: 'Understand scales',
          description: 'Learn major and minor scales',
          status: 'pending',
        },
      ],
      createdBy: 'mind',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 13,
      type: 'create_plan',
      description: 'Creating initial plan for music theory goal',
      parameters: { goalId: goal.id, planId: plan.id },
      outcome: 'executed',
    });

    expect(plan.version).toBe(1);

    // 6. schedule_task: Create tasks for the first milestone
    const task1 = taskStore.createTask(db, {
      title: 'Watch intro to music theory video',
      instructions: 'Find and watch a comprehensive intro video',
      scheduleType: 'deferred',
      status: 'scheduled',
      goalId: goal.id,
      planId: plan.id,
      milestoneIndex: 0,
      priority: 0.7,
      createdBy: 'mind',
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 13,
      type: 'schedule_task',
      description: 'Creating deferred task for first milestone',
      parameters: { taskId: task1.id },
      outcome: 'executed',
    });

    // 7. start_task: Mind picks up the deferred task
    taskStore.updateTask(db, task1.id, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 20,
      type: 'start_task',
      description: 'Picking up music theory video task',
      parameters: { taskId: task1.id },
      outcome: 'executed',
    });

    // 8. complete_task: Task finishes
    taskStore.updateTask(db, task1.id, {
      status: 'completed',
      result: 'Watched the video, learned about notes and basic intervals',
      completedAt: new Date().toISOString(),
    });

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 21,
      type: 'complete_task',
      description: 'Completed the intro video task',
      parameters: { taskId: task1.id },
      outcome: 'executed',
    });

    // 9. Eventually complete the goal
    goalManager.completeGoal(goal.id);

    heartbeatStore.insertTickDecision(db, {
      tickNumber: 100,
      type: 'update_goal',
      description: 'Music theory goal achieved',
      parameters: { goalId: goal.id, status: 'completed' },
      outcome: 'executed',
    });

    // Verify final state
    const finalGoal = goalManager.getGoal(goal.id)!;
    expect(finalGoal.status).toBe('completed');
    expect(finalGoal.completedAt).not.toBeNull();

    const finalSeed = heartbeatStore.getSeed(db, seed.id)!;
    expect(finalSeed.status).toBe('graduated');
    expect(finalSeed.graduatedToGoalId).toBe(goal.id);

    // Verify decision audit trail
    const tick13Decisions = heartbeatStore.getTickDecisions(db, 13);
    expect(tick13Decisions).toHaveLength(2); // create_plan + schedule_task
  });

  it('goal abandonment cascades to cancel all pending tasks', async () => {
    const goal = goalManager.createGoal({
      title: 'Abandoned Project',
      origin: 'ai_internal',
      status: 'active',
    });

    // Create several tasks
    taskStore.createTask(db, {
      title: 'Task A',
      scheduleType: 'one_shot',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Task B',
      scheduleType: 'deferred',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Task C',
      scheduleType: 'recurring',
      status: 'scheduled',
      goalId: goal.id,
      createdBy: 'mind',
    });

    // Abandon the goal
    goalManager.abandonGoal(goal.id, 'Lost interest completely');

    // Cascade cancellation
    const cancelledCount = taskStore.cancelTasksByGoalId(db, goal.id);
    expect(cancelledCount).toBe(3);

    // Log the cascade
    heartbeatStore.insertTickDecision(db, {
      tickNumber: 50,
      type: 'update_goal',
      description: 'Abandoning goal, cancelled 3 tasks',
      parameters: {
        goalId: goal.id,
        status: 'abandoned',
        tasksCancelled: cancelledCount,
      },
      outcome: 'executed',
    });

    // Verify all tasks are cancelled
    const goalTasks = taskStore.listTasks(db, { goalId: goal.id });
    for (const task of goalTasks) {
      expect(task.status).toBe('cancelled');
    }
  });

  it('plan revision cancels old plan tasks and keeps goal active', () => {
    const goal = goalManager.createGoal({
      title: 'Revised Goal',
      origin: 'user_directed',
      status: 'active',
    });

    const plan1 = goalManager.createPlan(goal.id, {
      strategy: 'Original approach',
      createdBy: 'mind',
    });

    // Create tasks for plan1
    taskStore.createTask(db, {
      title: 'Old plan task 1',
      scheduleType: 'deferred',
      status: 'scheduled',
      goalId: goal.id,
      planId: plan1.id,
      createdBy: 'mind',
    });

    taskStore.createTask(db, {
      title: 'Old plan task 2',
      scheduleType: 'one_shot',
      status: 'scheduled',
      goalId: goal.id,
      planId: plan1.id,
      createdBy: 'mind',
    });

    // Supersede the old plan
    heartbeatStore.updatePlan(db, plan1.id, {
      status: 'superseded',
      supersededAt: new Date().toISOString(),
    });

    // Create new plan
    const plan2 = goalManager.createPlan(goal.id, {
      strategy: 'Revised approach',
      createdBy: 'planning_agent',
    });

    // Cancel old plan's tasks (by checking planId)
    // In practice, cancelTasksByGoalId handles this, but specific plan-based
    // cancellation can be done via task listing and individual updates.
    const oldPlanTasks = taskStore.listTasks(db, { goalId: goal.id });
    for (const task of oldPlanTasks) {
      if (
        task.planId === plan1.id &&
        ['pending', 'scheduled', 'paused'].includes(task.status)
      ) {
        taskStore.updateTask(db, task.id, {
          status: 'cancelled',
          completedAt: new Date().toISOString(),
        });
      }
    }

    // Verify old plan tasks are cancelled
    const allTasks = taskStore.listTasks(db, { goalId: goal.id });
    const oldTasks = allTasks.filter((t) => t.planId === plan1.id);
    for (const t of oldTasks) {
      expect(t.status).toBe('cancelled');
    }

    // Goal remains active
    expect(goalManager.getGoal(goal.id)!.status).toBe('active');

    // New plan is active
    const activePlan = goalManager.getActivePlan(goal.id);
    expect(activePlan!.id).toBe(plan2.id);
    expect(activePlan!.version).toBe(2);
  });
});
