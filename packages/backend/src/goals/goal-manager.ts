/**
 * Goal Manager — owns goal, plan, milestone, snapshot, and review lifecycle.
 *
 * The manager records factual progress deterministically and asks the mind for
 * judgment only through explicit review requests. Goal snapshots are a compact
 * strategic surface for the next heartbeat, not a journal of every action.
 *
 * See docs/architecture/goals.md
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type {
  EmotionName,
  EmotionState,
  Goal,
  GoalEvent,
  GoalEventSource,
  GoalReviewRequest,
  GoalReviewScope,
  GoalReviewUrgency,
  GoalSnapshot,
  GoalSnapshotUpdatedBy,
  Milestone,
  MilestoneStatus,
  Plan,
  Task,
} from '@animus-labs/shared';
import * as heartbeatStore from '../db/stores/heartbeat-store.js';
import { computeSalience, GOAL_VISIBILITY_THRESHOLD, MAX_GOALS_IN_CONTEXT } from './salience.js';
import type { SalienceResult } from './salience.js';
import { getEventBus } from '../lib/event-bus.js';

type MilestoneDraft = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  status?: MilestoneStatus;
  confidence?: number;
  evidence?: Milestone['evidence'];
  blockerNotes?: string | null;
  completionRationale?: string | null;
  completedAt?: string | null;
};

type SnapshotPatch = {
  summary?: string;
  currentPlanId?: string | null;
  currentMilestoneId?: string | null;
  recentProgress?: string;
  knownBlockers?: string[];
  openQuestions?: string[];
  nextBestMove?: string;
  planConfidence?: number;
  completionConfidence?: number;
  updatedFromEventId?: string | null;
  updatedBy?: GoalSnapshotUpdatedBy;
};

const OPEN_MILESTONE_STATUSES = new Set<MilestoneStatus>(['pending', 'in_progress', 'blocked']);

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

    heartbeatStore.updateSeed(this.db, seedId, {
      status: 'graduated',
      graduatedToGoalId: goal.id,
    });

    this.ensureSnapshot(goal);
    this.recordEvent({
      goalId: goal.id,
      type: 'goal.created',
      summary: `Goal proposed from seed: ${goal.title}`,
      source: 'mind',
      data: { seedId },
    });

    const eventBus = getEventBus();
    eventBus.emit('goal:created', goal);
    const updatedSeed = heartbeatStore.getSeed(this.db, seedId);
    if (updatedSeed) eventBus.emit('seed:updated', updatedSeed);

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
    const storeData = data.status === 'active'
      ? { ...data, activatedAtTick: this.currentTickNumber() }
      : data;
    const goal = heartbeatStore.createGoal(this.db, storeData);

    this.ensureSnapshot(goal);
    this.recordEvent({
      goalId: goal.id,
      type: 'goal.created',
      summary: `Goal created: ${goal.title}`,
      source: data.origin === 'user_directed' ? 'user' : 'mind',
    });

    if (goal.status === 'active') {
      this.recordEvent({
        goalId: goal.id,
        type: 'goal.activated',
        summary: `Goal activated: ${goal.title}`,
        source: data.origin === 'user_directed' ? 'user' : 'mind',
      });
      this.queueGoalReview({
        goalId: goal.id,
        scope: 'plan_missing',
        urgency: 'normal',
        reason: 'This active goal needs a plan version before tasks can stay aligned to milestones.',
        requestedBy: 'system',
      });
    }

    getEventBus().emit('goal:created', goal);
    return goal;
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
   * Records the current tick number for planning prompt escalation.
   */
  activateGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'active',
      activatedAt: now(),
      activatedAtTick: this.currentTickNumber(),
    });
    this.recordEvent({
      goalId,
      type: 'goal.activated',
      summary: 'Goal activated.',
      source: 'mind',
    });
    this.queueGoalReview({
      goalId,
      scope: 'plan_missing',
      urgency: 'normal',
      reason: 'This goal is active and needs a current plan version.',
      requestedBy: 'system',
    });
    this.emitGoalUpdated(goalId);
  }

  /**
   * Pause a goal (remove from active rotation).
   */
  pauseGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, { status: 'paused' });
    this.recordEvent({
      goalId,
      type: 'goal.paused',
      summary: 'Goal paused.',
      source: 'mind',
    });
    this.emitGoalUpdated(goalId);
  }

  /**
   * Resume a paused goal.
   * Resets the activated_at_tick for planning prompt escalation.
   */
  resumeGoal(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'active',
      activatedAt: now(),
      activatedAtTick: this.currentTickNumber(),
    });
    this.recordEvent({
      goalId,
      type: 'goal.resumed',
      summary: 'Goal resumed.',
      source: 'mind',
    });
    if (!heartbeatStore.getActivePlan(this.db, goalId)) {
      this.queueGoalReview({
        goalId,
        scope: 'plan_missing',
        urgency: 'normal',
        reason: 'This resumed goal has no active plan version.',
        requestedBy: 'system',
      });
    }
    this.emitGoalUpdated(goalId);
  }

  /**
   * Complete a goal.
   */
  completeGoal(goalId: string, rationale?: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      status: 'completed',
      completedAt: now(),
      lastProgressAt: now(),
    });
    const event = this.recordEvent({
      goalId,
      type: 'goal.completed',
      summary: rationale ? `Goal completed: ${rationale}` : 'Goal completed.',
      source: 'mind',
    });
    this.updateGoalSnapshot(goalId, {
      recentProgress: rationale ?? 'The goal was completed.',
      completionConfidence: 1,
      updatedFromEventId: event.id,
      updatedBy: 'mind',
    });
    this.emitGoalUpdated(goalId);
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
    const event = this.recordEvent({
      goalId,
      type: 'goal.abandoned',
      summary: reason ? `Goal abandoned: ${reason}` : 'Goal abandoned.',
      source: 'mind',
    });
    this.updateGoalSnapshot(goalId, {
      recentProgress: reason ?? 'The goal was abandoned.',
      updatedFromEventId: event.id,
      updatedBy: 'mind',
    });
    this.emitGoalUpdated(goalId);
  }

  /**
   * Update goal progress timestamp.
   */
  updateGoalProgress(goalId: string): void {
    heartbeatStore.updateGoal(this.db, goalId, {
      lastProgressAt: now(),
    });
    this.emitGoalUpdated(goalId);
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

      heartbeatStore.updateGoal(this.db, goal.id, {
        currentSalience: result.salience,
      });

      heartbeatStore.logSalience(this.db, {
        goalId: goal.id,
        salience: result.salience,
        ...result.components,
      });

      if (result.salience >= GOAL_VISIBILITY_THRESHOLD) {
        salientGoals.push({ goal: { ...goal, currentSalience: result.salience }, result });
      }
    }

    salientGoals.sort((a, b) => b.result.salience - a.result.salience);
    return salientGoals.slice(0, MAX_GOALS_IN_CONTEXT);
  }

  /**
   * Create a plan version for a goal.
   *
   * Existing active plans are superseded. The first unfinished milestone
   * becomes the current milestone in the goal snapshot.
   */
  createPlan(goalId: string, data: {
    strategy: string;
    milestones?: MilestoneDraft[];
    createdBy: 'mind' | 'planning_agent';
    revisionReason?: string | null;
    reasonCreated?: string | null;
    assumptions?: string[] | null;
  }): Plan {
    return this.createPlanVersion(goalId, data);
  }

  createPlanVersion(goalId: string, data: {
    strategy: string;
    milestones?: MilestoneDraft[];
    createdBy: 'mind' | 'planning_agent';
    revisionReason?: string | null;
    reasonCreated?: string | null;
    assumptions?: string[] | null;
  }): Plan {
    const previous = heartbeatStore.getActivePlan(this.db, goalId);
    if (previous) {
      heartbeatStore.updatePlan(this.db, previous.id, {
        status: 'superseded',
        supersededAt: now(),
      });
      this.recordEvent({
        goalId,
        type: 'plan.superseded',
        summary: `Plan v${previous.version} superseded.`,
        source: data.createdBy === 'mind' ? 'mind' : 'agent',
        planId: previous.id,
      });
    }

    const plan = heartbeatStore.createPlan(this.db, {
      goalId,
      strategy: data.strategy,
      milestones: data.milestones ?? null,
      createdBy: data.createdBy,
      revisionReason: data.revisionReason ?? null,
      reasonCreated: data.reasonCreated ?? data.revisionReason ?? null,
      assumptions: data.assumptions ?? [],
      supersedesPlanId: previous?.id ?? null,
    });

    const currentMilestone = this.ensureCurrentMilestone(plan);
    const event = this.recordEvent({
      goalId,
      type: 'plan.created',
      summary: `Plan v${plan.version} created.`,
      source: data.createdBy === 'mind' ? 'mind' : 'agent',
      planId: plan.id,
      milestoneId: currentMilestone?.id ?? null,
      data: {
        version: plan.version,
        supersedesPlanId: previous?.id ?? null,
        assumptionCount: plan.assumptions.length,
      },
    });

    this.updateGoalSnapshot(goalId, {
      summary: this.defaultGoalSummary(goalId),
      currentPlanId: plan.id,
      currentMilestoneId: currentMilestone?.id ?? null,
      recentProgress: `Created plan v${plan.version}.`,
      nextBestMove: currentMilestone
        ? `Advance milestone "${currentMilestone.title}".`
        : 'Create concrete tasks for this plan.',
      planConfidence: 0.6,
      updatedFromEventId: event.id,
      updatedBy: data.createdBy === 'mind' ? 'mind' : 'system',
    });

    this.resolvePendingReviews(goalId, ['plan_missing', 'plan_revision'], `Created plan v${plan.version}.`);
    getEventBus().emit('goal:plan_created', plan);
    this.emitGoalUpdated(goalId);
    return plan;
  }

  updateMilestone(milestoneId: string, data: {
    title?: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    status?: MilestoneStatus;
    confidence?: number;
    evidence?: Milestone['evidence'];
    blockerNotes?: string | null;
    completionRationale?: string | null;
  }): Milestone | null {
    const before = heartbeatStore.getMilestone(this.db, milestoneId);
    if (!before) return null;

    const completedAt = data.status === 'completed' && !before.completedAt ? now() : undefined;
    heartbeatStore.updateMilestone(this.db, milestoneId, {
      ...data,
      ...(completedAt ? { completedAt } : {}),
    });
    const milestone = heartbeatStore.getMilestone(this.db, milestoneId);
    if (!milestone) return null;

    const eventType =
      data.status === 'completed' ? 'milestone.completed' :
      data.status === 'blocked' ? 'milestone.blocked' :
      data.status === 'in_progress' && before.status !== 'in_progress' ? 'milestone.started' :
      'milestone.updated';

    const event = this.recordEvent({
      goalId: milestone.goalId,
      type: eventType,
      summary: this.milestoneEventSummary(milestone, data.status),
      source: 'mind',
      planId: milestone.planId,
      milestoneId: milestone.id,
      data: {
        previousStatus: before.status,
        status: milestone.status,
      },
    });

    const next = this.nextOpenMilestone(milestone.goalId, milestone.planId);
    const blockers = this.snapshotBlockers(milestone.goalId);
    const blockerText = milestone.status === 'blocked' && milestone.blockerNotes
      ? [...blockers, milestone.blockerNotes]
      : blockers;

    this.updateGoalSnapshot(milestone.goalId, {
      currentPlanId: milestone.planId,
      currentMilestoneId: milestone.status === 'completed' || milestone.status === 'skipped'
        ? next?.id ?? null
        : milestone.id,
      recentProgress: data.completionRationale
        ?? (data.status === 'completed' ? `Completed milestone "${milestone.title}".` : `Updated milestone "${milestone.title}".`),
      knownBlockers: [...new Set(blockerText)].slice(-5),
      nextBestMove: this.nextMoveForMilestone(next ?? milestone),
      completionConfidence: this.estimateCompletionConfidence(milestone.goalId),
      updatedFromEventId: event.id,
      updatedBy: 'mind',
    });

    if (milestone.status === 'completed') {
      this.resolvePendingReviews(milestone.goalId, ['milestone_acceptance'], `Milestone "${milestone.title}" was marked complete.`);
      if (next) {
        this.queueGoalReview({
          goalId: milestone.goalId,
          scope: 'next_tasks',
          urgency: 'normal',
          reason: `Milestone "${milestone.title}" is complete. Decide the next concrete tasks for "${next.title}".`,
          evidenceRefs: [`milestone:${milestone.id}`, `milestone:${next.id}`],
          requestedBy: 'system',
        });
      } else {
        this.queueGoalReview({
          goalId: milestone.goalId,
          scope: 'completion_check',
          urgency: 'normal',
          reason: 'All milestones in the active plan are complete or skipped. Decide whether the goal itself is complete.',
          evidenceRefs: [`plan:${milestone.planId}`],
          requestedBy: 'system',
        });
      }
    }

    if (milestone.status === 'blocked') {
      this.queueGoalReview({
        goalId: milestone.goalId,
        scope: 'blocker',
        urgency: 'high',
        reason: milestone.blockerNotes ?? `Milestone "${milestone.title}" is blocked and needs a decision.`,
        evidenceRefs: [`milestone:${milestone.id}`],
        requestedBy: 'system',
      });
    }

    getEventBus().emit('goal:milestone_updated', milestone);
    this.emitGoalUpdated(milestone.goalId);
    return milestone;
  }

  updateGoalSnapshot(goalId: string, patch: SnapshotPatch): GoalSnapshot {
    const snapshot = heartbeatStore.updateGoalSnapshot(this.db, {
      goalId,
      ...patch,
    });
    const event = this.recordEvent({
      goalId,
      type: 'snapshot.updated',
      summary: 'Goal snapshot updated.',
      source: patch.updatedBy === 'mind' ? 'mind' : 'system',
      planId: snapshot.currentPlanId,
      milestoneId: snapshot.currentMilestoneId,
      data: {
        planConfidence: snapshot.planConfidence,
        completionConfidence: snapshot.completionConfidence,
      },
    });

    if (!snapshot.updatedFromEventId) {
      heartbeatStore.updateGoalSnapshot(this.db, {
        goalId,
        updatedFromEventId: event.id,
      });
      const updated = heartbeatStore.getGoalSnapshot(this.db, goalId) ?? snapshot;
      getEventBus().emit('goal:snapshot_updated', updated);
      return updated;
    }

    getEventBus().emit('goal:snapshot_updated', snapshot);
    return snapshot;
  }

  queueGoalReview(data: {
    goalId: string;
    scope: GoalReviewScope;
    urgency?: GoalReviewUrgency;
    reason: string;
    evidenceRefs?: string[];
    requestedBy?: 'system' | 'mind';
  }): GoalReviewRequest {
    const request = heartbeatStore.createGoalReviewRequest(this.db, {
      goalId: data.goalId,
      scope: data.scope,
      urgency: data.urgency ?? 'normal',
      reason: data.reason,
      evidenceRefs: data.evidenceRefs ?? [],
      requestedBy: data.requestedBy ?? 'system',
      createdTickNumber: this.currentTickNumber(),
    });
    this.recordEvent({
      goalId: data.goalId,
      type: 'review.requested',
      summary: `Review requested (${request.scope}): ${request.reason}`,
      source: data.requestedBy ?? 'system',
      data: { reviewRequestId: request.id, urgency: request.urgency },
    });
    getEventBus().emit('goal:review_requested', request);
    this.emitGoalUpdated(data.goalId);
    return request;
  }

  resolveGoalReview(requestId: string, resolution?: string, status: 'resolved' | 'dismissed' = 'resolved'): GoalReviewRequest | null {
    const request = heartbeatStore.getGoalReviewRequest(this.db, requestId);
    if (!request) return null;
    heartbeatStore.resolveGoalReviewRequest(this.db, requestId, {
      status,
      resolvedTickNumber: this.currentTickNumber(),
      resolution: resolution ?? null,
    });
    const updated = heartbeatStore.getGoalReviewRequest(this.db, requestId);
    this.recordEvent({
      goalId: request.goalId,
      type: 'review.resolved',
      summary: resolution ?? `Review ${status}.`,
      source: 'mind',
      data: { reviewRequestId: request.id, status },
    });
    if (updated) getEventBus().emit('goal:review_updated', updated);
    this.emitGoalUpdated(request.goalId);
    return updated;
  }

  recordTaskCreated(task: Task): void {
    if (!task.goalId) return;
    const event = this.recordEvent({
      goalId: task.goalId,
      type: 'task.created',
      summary: `Task created: ${task.title}`,
      source: 'mind',
      taskId: task.id,
      planId: task.planId,
      milestoneId: task.milestoneId,
    });
    this.updateGoalSnapshot(task.goalId, {
      ...(task.planId ? { currentPlanId: task.planId } : {}),
      ...(task.milestoneId ? { currentMilestoneId: task.milestoneId } : {}),
      nextBestMove: `Work on task "${task.title}".`,
      updatedFromEventId: event.id,
      updatedBy: 'system',
    });
    this.emitGoalUpdated(task.goalId);
  }

  recordTaskStarted(task: Task): void {
    if (!task.goalId) return;
    const event = this.recordEvent({
      goalId: task.goalId,
      type: 'task.started',
      summary: `Task started: ${task.title}`,
      source: 'task',
      taskId: task.id,
      planId: task.planId,
      milestoneId: task.milestoneId,
    });
    this.updateGoalSnapshot(task.goalId, {
      recentProgress: `Started task "${task.title}".`,
      ...(task.planId ? { currentPlanId: task.planId } : {}),
      ...(task.milestoneId ? { currentMilestoneId: task.milestoneId } : {}),
      updatedFromEventId: event.id,
      updatedBy: 'system',
    });
    this.emitGoalUpdated(task.goalId);
  }

  recordTaskCompleted(task: Task, result: string | null, counts: {
    remainingOpenTasksForGoal: number;
    remainingOpenTasksForMilestone: number | null;
  }): void {
    if (!task.goalId) return;
    heartbeatStore.updateGoal(this.db, task.goalId, { lastProgressAt: now() });
    const event = this.recordEvent({
      goalId: task.goalId,
      type: 'task.completed',
      summary: `Task completed: ${task.title}`,
      source: 'task',
      taskId: task.id,
      planId: task.planId,
      milestoneId: task.milestoneId,
      data: result ? { result } : {},
    });
    this.updateGoalSnapshot(task.goalId, {
      recentProgress: result ? `Completed "${task.title}": ${result}` : `Completed task "${task.title}".`,
      ...(task.planId ? { currentPlanId: task.planId } : {}),
      ...(task.milestoneId ? { currentMilestoneId: task.milestoneId } : {}),
      completionConfidence: this.estimateCompletionConfidence(task.goalId),
      updatedFromEventId: event.id,
      updatedBy: 'system',
    });

    if (task.milestoneId && counts.remainingOpenTasksForMilestone === 0) {
      this.queueGoalReview({
        goalId: task.goalId,
        scope: 'milestone_acceptance',
        urgency: 'normal',
        reason: 'All open tasks linked to the current milestone are complete. Decide whether the milestone is actually complete, blocked, or needs more tasks.',
        evidenceRefs: [`task:${task.id}`, `milestone:${task.milestoneId}`],
        requestedBy: 'system',
      });
    }

    if (counts.remainingOpenTasksForGoal === 0) {
      this.queueGoalReview({
        goalId: task.goalId,
        scope: 'next_tasks',
        urgency: 'normal',
        reason: 'There are no open tasks left for this goal. Decide the next concrete task, revise the plan, or check completion.',
        evidenceRefs: [`task:${task.id}`],
        requestedBy: 'system',
      });
    }

    this.emitGoalUpdated(task.goalId);
  }

  recordTaskCancelled(task: Task, reason?: string): void {
    this.recordTerminalTaskEvent(task, 'task.cancelled', reason ?? `Task cancelled: ${task.title}`);
  }

  recordTaskSkipped(task: Task, reason?: string): void {
    this.recordTerminalTaskEvent(task, 'task.skipped', reason ?? `Task skipped: ${task.title}`);
  }

  recordTaskFailed(task: Task, reason?: string): void {
    this.recordTerminalTaskEvent(task, 'task.failed', reason ?? `Task failed: ${task.title}`);
  }

  getActivePlan(goalId: string): Plan | null {
    return heartbeatStore.getActivePlan(this.db, goalId);
  }

  getPlan(planId: string): Plan | null {
    return heartbeatStore.getPlan(this.db, planId);
  }

  getPlansByGoal(goalId: string): Plan[] {
    return heartbeatStore.getPlansByGoal(this.db, goalId);
  }

  getMilestone(milestoneId: string): Milestone | null {
    return heartbeatStore.getMilestone(this.db, milestoneId);
  }

  getMilestonesByPlan(planId: string): Milestone[] {
    return heartbeatStore.getMilestonesByPlan(this.db, planId);
  }

  getMilestoneByPlanPosition(planId: string, position: number): Milestone | null {
    return heartbeatStore.getMilestoneByPlanPosition(this.db, planId, position);
  }

  getCurrentMilestone(goalId: string): Milestone | null {
    return heartbeatStore.getCurrentMilestone(this.db, goalId);
  }

  getGoalSnapshot(goalId: string): GoalSnapshot | null {
    return heartbeatStore.getGoalSnapshot(this.db, goalId);
  }

  getPendingReviewRequests(goalId: string): GoalReviewRequest[] {
    return heartbeatStore.getPendingGoalReviewRequests(this.db, goalId);
  }

  getRecentEvents(goalId: string, limit: number = 8): GoalEvent[] {
    return heartbeatStore.getRecentGoalEvents(this.db, goalId, limit);
  }

  private ensureSnapshot(goal: Goal): GoalSnapshot {
    return heartbeatStore.ensureGoalSnapshot(this.db, {
      goalId: goal.id,
      summary: goal.description ?? goal.motivation ?? '',
      recentProgress: '',
      nextBestMove: goal.status === 'active'
        ? 'Create a plan version with milestones.'
        : 'Wait for conversational approval or a change in commitment.',
      planConfidence: 0.5,
      completionConfidence: 0,
      updatedBy: 'system',
    });
  }

  private ensureCurrentMilestone(plan: Plan): Milestone | null {
    const milestones = heartbeatStore.getMilestonesByPlan(this.db, plan.id);
    const existing = milestones.find((milestone) => milestone.status === 'in_progress' || milestone.status === 'blocked');
    if (existing) return existing;

    const firstOpen = milestones.find((milestone) => milestone.status === 'pending');
    if (!firstOpen) return null;

    heartbeatStore.updateMilestone(this.db, firstOpen.id, { status: 'in_progress' });
    const updated = heartbeatStore.getMilestone(this.db, firstOpen.id);
    if (updated) {
      this.recordEvent({
        goalId: updated.goalId,
        type: 'milestone.started',
        summary: `Milestone started: ${updated.title}`,
        source: 'system',
        planId: updated.planId,
        milestoneId: updated.id,
      });
    }
    return updated;
  }

  private recordTerminalTaskEvent(task: Task, type: 'task.cancelled' | 'task.skipped' | 'task.failed', summary: string): void {
    if (!task.goalId) return;
    const event = this.recordEvent({
      goalId: task.goalId,
      type,
      summary,
      source: 'task',
      taskId: task.id,
      planId: task.planId,
      milestoneId: task.milestoneId,
    });
    this.updateGoalSnapshot(task.goalId, {
      recentProgress: summary,
      updatedFromEventId: event.id,
      updatedBy: 'system',
    });
    this.queueGoalReview({
      goalId: task.goalId,
      scope: type === 'task.failed' ? 'blocker' : 'next_tasks',
      urgency: type === 'task.failed' ? 'high' : 'normal',
      reason: summary,
      evidenceRefs: [`task:${task.id}`],
      requestedBy: 'system',
    });
    this.emitGoalUpdated(task.goalId);
  }

  private recordEvent(data: {
    goalId: string;
    type: Parameters<typeof heartbeatStore.createGoalEvent>[1]['type'];
    summary: string;
    source?: GoalEventSource;
    taskId?: string | null;
    planId?: string | null;
    milestoneId?: string | null;
    data?: Record<string, unknown>;
  }): GoalEvent {
    const event = heartbeatStore.createGoalEvent(this.db, {
      ...data,
      tickNumber: this.currentTickNumber(),
    });
    getEventBus().emit('goal:event_created', event);
    return event;
  }

  private currentTickNumber(): number {
    return heartbeatStore.getHeartbeatState(this.db).tickNumber;
  }

  private emitGoalUpdated(goalId: string): void {
    const goal = heartbeatStore.getGoal(this.db, goalId);
    if (goal) getEventBus().emit('goal:updated', goal);
  }

  private defaultGoalSummary(goalId: string): string {
    const goal = heartbeatStore.getGoal(this.db, goalId);
    return goal?.description ?? goal?.motivation ?? '';
  }

  private resolvePendingReviews(goalId: string, scopes: GoalReviewScope[], resolution: string): void {
    const pending = heartbeatStore.getPendingGoalReviewRequests(this.db, goalId)
      .filter((request) => scopes.includes(request.scope));
    for (const request of pending) {
      heartbeatStore.resolveGoalReviewRequest(this.db, request.id, {
        status: 'resolved',
        resolvedTickNumber: this.currentTickNumber(),
        resolution,
      });
      const updated = heartbeatStore.getGoalReviewRequest(this.db, request.id);
      if (updated) getEventBus().emit('goal:review_updated', updated);
      this.recordEvent({
        goalId,
        type: 'review.resolved',
        summary: resolution,
        source: 'system',
        data: { reviewRequestId: request.id },
      });
    }
  }

  private nextOpenMilestone(goalId: string, planId: string): Milestone | null {
    const milestones = heartbeatStore.getMilestonesByPlan(this.db, planId);
    return milestones.find((milestone) => milestone.goalId === goalId && OPEN_MILESTONE_STATUSES.has(milestone.status)) ?? null;
  }

  private snapshotBlockers(goalId: string): string[] {
    return heartbeatStore.getGoalSnapshot(this.db, goalId)?.knownBlockers ?? [];
  }

  private nextMoveForMilestone(milestone: Milestone | null): string {
    if (!milestone) return 'Review whether the goal is complete.';
    if (milestone.status === 'blocked') return `Resolve blocker for milestone "${milestone.title}".`;
    return `Advance milestone "${milestone.title}".`;
  }

  private milestoneEventSummary(milestone: Milestone, requestedStatus?: MilestoneStatus): string {
    switch (requestedStatus) {
      case 'completed':
        return `Milestone completed: ${milestone.title}`;
      case 'blocked':
        return `Milestone blocked: ${milestone.title}`;
      case 'in_progress':
        return `Milestone started: ${milestone.title}`;
      case 'skipped':
        return `Milestone skipped: ${milestone.title}`;
      default:
        return `Milestone updated: ${milestone.title}`;
    }
  }

  private estimateCompletionConfidence(goalId: string): number {
    const plan = heartbeatStore.getActivePlan(this.db, goalId);
    if (!plan?.milestones || plan.milestones.length === 0) return 0;
    const completeWeight = plan.milestones.reduce((sum, milestone) => {
      if (milestone.status === 'completed' || milestone.status === 'skipped') return sum + 1;
      if (milestone.status === 'in_progress') return sum + 0.35;
      if (milestone.status === 'blocked') return sum + 0.15;
      return sum;
    }, 0);
    return Math.max(0, Math.min(1, completeWeight / plan.milestones.length));
  }
}
