import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoalManager } from './goal-manager.js';
import * as goalStore from '../db/stores/goal-store.js';
import * as taskStore from '../db/stores/task-store.js';

let db: Database.Database;
let manager: GoalManager;

function applyHeartbeatMigration(name: string): void {
  db.exec(readFileSync(new URL(`../db/migrations/heartbeat/${name}`, import.meta.url), 'utf8'));
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyHeartbeatMigration('001_initial.sql');
  applyHeartbeatMigration('004_goal_planning_prompts.sql');
  applyHeartbeatMigration('007_rename_session_token_count.sql');
  applyHeartbeatMigration('009_task_journals.sql');
  applyHeartbeatMigration('010_goal_strategy_layer.sql');
  manager = new GoalManager(db);
});

afterEach(() => {
  db.close();
});

describe('GoalManager strategy lifecycle', () => {
  it('creates durable plan versions, supersedes the old plan, and updates the snapshot', () => {
    const goal = manager.createGoal({
      title: 'Ship the new app',
      description: 'Build toward a launchable application.',
      origin: 'user_directed',
      status: 'active',
    });

    const plan1 = manager.createPlanVersion(goal.id, {
      strategy: 'Discover constraints, then build.',
      milestones: [
        { title: 'Discovery', acceptanceCriteria: 'The constraints are known.' },
        { title: 'Build', acceptanceCriteria: 'The app runs end to end.' },
      ],
      createdBy: 'mind',
      reasonCreated: 'Initial strategy.',
      assumptions: ['The scope is still flexible.'],
    });

    expect(plan1.version).toBe(1);
    expect(plan1.milestones?.[0]?.status).toBe('pending');

    const firstMilestone = goalStore.getCurrentMilestone(db, goal.id);
    expect(firstMilestone).toMatchObject({
      title: 'Discovery',
      status: 'in_progress',
    });

    const plan2 = manager.createPlanVersion(goal.id, {
      strategy: 'Lock the brief first, then scaffold.',
      milestones: [
        { title: 'Brief', acceptanceCriteria: 'The v1 brief is written.' },
      ],
      createdBy: 'mind',
      revisionReason: 'The first strategy was too broad.',
    });

    expect(goalStore.getPlan(db, plan1.id)?.status).toBe('superseded');
    expect(goalStore.getActivePlan(db, goal.id)?.id).toBe(plan2.id);

    const snapshot = goalStore.getGoalSnapshot(db, goal.id);
    expect(snapshot).toMatchObject({
      currentPlanId: plan2.id,
      recentProgress: 'Created plan v2.',
    });
    expect(snapshot?.currentMilestoneId).toBeTruthy();
    expect(goalStore.getPendingGoalReviewRequests(db, goal.id).map((request) => request.scope))
      .not.toContain('plan_missing');
  });

  it('records task completion as goal progress and queues review cues instead of auto-completing milestones', () => {
    const goal = manager.createGoal({
      title: 'Prepare launch',
      origin: 'user_directed',
      status: 'active',
    });
    const plan = manager.createPlanVersion(goal.id, {
      strategy: 'Complete a launch checklist.',
      milestones: [{ title: 'Checklist', acceptanceCriteria: 'All checklist tasks are done.' }],
      createdBy: 'mind',
    });
    const milestone = goalStore.getCurrentMilestone(db, goal.id);
    expect(milestone).toBeTruthy();

    const task = taskStore.createTask(db, {
      title: 'Write launch checklist',
      scheduleType: 'deferred',
      status: 'scheduled',
      createdBy: 'mind',
      goalId: goal.id,
      planId: plan.id,
      milestoneId: milestone!.id,
    });

    taskStore.updateTask(db, task.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    manager.recordTaskCompleted(task, 'Checklist drafted.', {
      remainingOpenTasksForGoal: taskStore.countOpenTasksByGoal(db, goal.id),
      remainingOpenTasksForMilestone: taskStore.countOpenTasksByMilestone(db, milestone!.id),
    });

    expect(goalStore.getGoal(db, goal.id)?.lastProgressAt).toBeTruthy();
    expect(goalStore.getMilestone(db, milestone!.id)?.status).toBe('in_progress');

    const reviewScopes = goalStore.getPendingGoalReviewRequests(db, goal.id).map((request) => request.scope);
    expect(reviewScopes).toContain('milestone_acceptance');
    expect(reviewScopes).toContain('next_tasks');

    const events = goalStore.getRecentGoalEvents(db, goal.id, 5).map((event) => event.type);
    expect(events).toContain('task.completed');
  });
});
