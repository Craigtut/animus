/**
 * Goal Decision Handlers
 *
 * Registers handlers for goal-related decisions. Goal decisions update
 * strategic state, not low-level task progress. Deterministic task events
 * are recorded by the task handlers.
 */

import { registerDecisionHandler } from '../heartbeat/decision-registry.js';
import * as taskStore from '../db/stores/task-store.js';
import type { EmotionName, GoalReviewScope, GoalReviewUrgency, MilestoneStatus } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('GoalDecisions', 'heartbeat');

type MilestoneDecisionInput = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  status?: MilestoneStatus;
  confidence?: number;
};

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function milestoneInputs(params: Record<string, unknown>): MilestoneDecisionInput[] | undefined {
  const value = params['milestones'];
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      title: String(item['title'] ?? 'Untitled milestone'),
      ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
      ...(typeof item['acceptanceCriteria'] === 'string' ? { acceptanceCriteria: item['acceptanceCriteria'] } : {}),
      ...(typeof item['status'] === 'string' ? { status: item['status'] as MilestoneStatus } : {}),
      ...(typeof item['confidence'] === 'number' ? { confidence: item['confidence'] } : {}),
    }));
}

registerDecisionHandler('create_seed', async (params, _decision, ctx) => {
  if (!ctx.seedManager) return;
  await ctx.seedManager.createSeed({
    content: String(params['content'] ?? ''),
    ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
    ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
    source: (params['source'] as 'internal' | 'user_observation' | 'experience') ?? 'internal',
  });
});

registerDecisionHandler('propose_goal', async (params, decision, ctx) => {
  if (!ctx.goalManager) return;
  const origin = (params['origin'] as 'user_directed' | 'ai_internal' | 'collaborative') ?? 'ai_internal';
  const seedId = stringParam(params, 'seedId');

  if (seedId) {
    const basePriority = numberParam(params, 'basePriority');
    const input: {
      title: string;
      description?: string;
      motivation?: string;
      linkedEmotion?: EmotionName;
      basePriority?: number;
      completionCriteria?: string;
    } = {
      title: String(params['title'] ?? decision.description),
    };
    if (params['description']) input.description = String(params['description']);
    if (params['motivation']) input.motivation = String(params['motivation']);
    if (params['linkedEmotion']) input.linkedEmotion = params['linkedEmotion'] as EmotionName;
    if (basePriority !== undefined) input.basePriority = basePriority;
    if (params['completionCriteria']) input.completionCriteria = String(params['completionCriteria']);
    ctx.goalManager.promoteToGoal(seedId, input);
    return;
  }

  const basePriority = numberParam(params, 'basePriority');
  const input: {
    title: string;
    description?: string;
    motivation?: string;
    origin: 'user_directed' | 'ai_internal' | 'collaborative';
    linkedEmotion?: EmotionName;
    status?: 'proposed' | 'active';
    basePriority?: number;
    completionCriteria?: string;
  } = {
    title: String(params['title'] ?? decision.description),
    origin,
    status: origin === 'user_directed' ? 'active' : 'proposed',
  };
  if (params['description']) input.description = String(params['description']);
  if (params['motivation']) input.motivation = String(params['motivation']);
  if (params['linkedEmotion']) input.linkedEmotion = params['linkedEmotion'] as EmotionName;
  if (basePriority !== undefined) input.basePriority = basePriority;
  if (params['completionCriteria']) input.completionCriteria = String(params['completionCriteria']);
  ctx.goalManager.createGoal(input);
});

registerDecisionHandler('update_goal', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const goalId = String(params['goalId'] ?? '');
  const newStatus = String(params['status'] ?? '');

  switch (newStatus) {
    case 'active':
      ctx.goalManager.activateGoal(goalId);
      break;
    case 'paused':
      ctx.goalManager.pauseGoal(goalId);
      taskStore.pauseTasksByGoalId(ctx.hbDb, goalId);
      break;
    case 'completed':
      ctx.goalManager.completeGoal(goalId, stringParam(params, 'reason') ?? stringParam(params, 'rationale'));
      taskStore.cancelTasksByGoalId(ctx.hbDb, goalId);
      break;
    case 'abandoned':
      ctx.goalManager.abandonGoal(goalId, stringParam(params, 'reason'));
      taskStore.cancelTasksByGoalId(ctx.hbDb, goalId);
      break;
    case 'resumed':
      ctx.goalManager.resumeGoal(goalId);
      break;
    default:
      log.warn(`Unknown goal status: ${newStatus}`);
  }
});

function registerPlanVersionHandler(type: 'create_plan' | 'revise_plan' | 'create_plan_version'): void {
  registerDecisionHandler(type, async (params, decision, ctx) => {
    if (!ctx.goalManager) return;
    const goalId = String(params['goalId'] ?? '');
    const milestones = milestoneInputs(params);
    const revisionReason = stringParam(params, 'revisionReason');
    const reasonCreated = stringParam(params, 'reasonCreated');
    const assumptions = stringArrayParam(params, 'assumptions');
    const input: {
      strategy: string;
      milestones?: MilestoneDecisionInput[];
      createdBy: 'mind';
      revisionReason?: string | null;
      reasonCreated?: string | null;
      assumptions?: string[] | null;
    } = {
      strategy: String(params['strategy'] ?? decision.description),
      createdBy: 'mind',
    };
    if (milestones) input.milestones = milestones;
    if (revisionReason) input.revisionReason = revisionReason;
    if (reasonCreated) input.reasonCreated = reasonCreated;
    if (assumptions) input.assumptions = assumptions;
    ctx.goalManager.createPlanVersion(goalId, input);
  });
}

registerPlanVersionHandler('create_plan');
registerPlanVersionHandler('revise_plan');
registerPlanVersionHandler('create_plan_version');

registerDecisionHandler('update_milestone', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const milestoneId = stringParam(params, 'milestoneId');
  if (!milestoneId) {
    log.warn('update_milestone missing milestoneId');
    return;
  }

  const update: {
    title?: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    status?: MilestoneStatus;
    confidence?: number;
    blockerNotes?: string | null;
    completionRationale?: string | null;
  } = {};
  const title = stringParam(params, 'title');
  const status = stringParam(params, 'status');
  const confidence = numberParam(params, 'confidence');
  const blockerNotes = stringParam(params, 'blockerNotes');
  const completionRationale = stringParam(params, 'completionRationale');
  if (title) update.title = title;
  if (params['description'] !== undefined) update.description = params['description'] == null ? null : String(params['description']);
  if (params['acceptanceCriteria'] !== undefined) update.acceptanceCriteria = params['acceptanceCriteria'] == null ? null : String(params['acceptanceCriteria']);
  if (status) update.status = status as MilestoneStatus;
  if (confidence !== undefined) update.confidence = confidence;
  if (blockerNotes) update.blockerNotes = blockerNotes;
  if (completionRationale) update.completionRationale = completionRationale;
  ctx.goalManager.updateMilestone(milestoneId, update);
});

registerDecisionHandler('update_goal_snapshot', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const goalId = stringParam(params, 'goalId');
  if (!goalId) {
    log.warn('update_goal_snapshot missing goalId');
    return;
  }

  const snapshot: {
    summary?: string;
    currentPlanId?: string | null;
    currentMilestoneId?: string | null;
    recentProgress?: string;
    knownBlockers?: string[];
    openQuestions?: string[];
    nextBestMove?: string;
    planConfidence?: number;
    completionConfidence?: number;
    updatedBy: 'mind';
  } = { updatedBy: 'mind' };
  const summary = stringParam(params, 'summary');
  const recentProgress = stringParam(params, 'recentProgress');
  const knownBlockers = stringArrayParam(params, 'knownBlockers');
  const openQuestions = stringArrayParam(params, 'openQuestions');
  const nextBestMove = stringParam(params, 'nextBestMove');
  const planConfidence = numberParam(params, 'planConfidence');
  const completionConfidence = numberParam(params, 'completionConfidence');
  if (summary) snapshot.summary = summary;
  if (params['currentPlanId'] !== undefined) snapshot.currentPlanId = params['currentPlanId'] == null ? null : String(params['currentPlanId']);
  if (params['currentMilestoneId'] !== undefined) snapshot.currentMilestoneId = params['currentMilestoneId'] == null ? null : String(params['currentMilestoneId']);
  if (recentProgress) snapshot.recentProgress = recentProgress;
  if (knownBlockers) snapshot.knownBlockers = knownBlockers;
  if (openQuestions) snapshot.openQuestions = openQuestions;
  if (nextBestMove) snapshot.nextBestMove = nextBestMove;
  if (planConfidence !== undefined) snapshot.planConfidence = planConfidence;
  if (completionConfidence !== undefined) snapshot.completionConfidence = completionConfidence;
  ctx.goalManager.updateGoalSnapshot(goalId, snapshot);
});

registerDecisionHandler('queue_goal_review', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const goalId = stringParam(params, 'goalId');
  if (!goalId) {
    log.warn('queue_goal_review missing goalId');
    return;
  }

  const evidenceRefs = stringArrayParam(params, 'evidenceRefs');
  const input: {
    goalId: string;
    scope: GoalReviewScope;
    urgency?: GoalReviewUrgency;
    reason: string;
    evidenceRefs?: string[];
    requestedBy: 'mind';
  } = {
    goalId,
    scope: (stringParam(params, 'scope') ?? 'plan_revision') as GoalReviewScope,
    reason: String(params['reason'] ?? 'The goal needs review.'),
    requestedBy: 'mind',
  };
  const urgency = stringParam(params, 'urgency');
  if (urgency) input.urgency = urgency as GoalReviewUrgency;
  if (evidenceRefs) input.evidenceRefs = evidenceRefs;
  ctx.goalManager.queueGoalReview(input);
});

registerDecisionHandler('resolve_goal_review', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const requestId = stringParam(params, 'reviewRequestId') ?? stringParam(params, 'requestId');
  if (!requestId) {
    log.warn('resolve_goal_review missing reviewRequestId');
    return;
  }
  const status = stringParam(params, 'status') === 'dismissed' ? 'dismissed' : 'resolved';
  ctx.goalManager.resolveGoalReview(requestId, stringParam(params, 'resolution'), status);
});
