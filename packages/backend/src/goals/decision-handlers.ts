/**
 * Goal Decision Handlers
 *
 * Registers handlers for goal-related decisions:
 * create_seed, propose_goal, update_goal, create_plan, revise_plan.
 *
 * Extracted from decision-executor.ts executeGoalTaskDecisions().
 */

import { registerDecisionHandler } from '../heartbeat/decision-registry.js';
import * as taskStore from '../db/stores/task-store.js';
import type { EmotionName } from '@animus-labs/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('GoalDecisions', 'heartbeat');

// create_seed
registerDecisionHandler('create_seed', async (params, _decision, ctx) => {
  if (!ctx.seedManager) return;
  await ctx.seedManager.createSeed({
    content: String(params['content'] ?? ''),
    ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
    ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
    source: (params['source'] as 'internal' | 'user_observation' | 'experience') ?? 'internal',
  });
});

// propose_goal
registerDecisionHandler('propose_goal', async (params, decision, ctx) => {
  if (!ctx.goalManager) return;
  const origin = (params['origin'] as 'user_directed' | 'ai_internal' | 'collaborative') ?? 'ai_internal';
  const seedId = params['seedId'] ? String(params['seedId']) : undefined;

  if (seedId) {
    // Promote from seed: marks seed as 'graduated' and links graduatedToGoalId
    ctx.goalManager.promoteToGoal(seedId, {
      title: String(params['title'] ?? decision.description),
      ...(params['description'] ? { description: String(params['description']) } : {}),
      ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
      ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
      ...(typeof params['basePriority'] === 'number' ? { basePriority: params['basePriority'] } : {}),
      ...(params['completionCriteria'] ? { completionCriteria: String(params['completionCriteria']) } : {}),
    });
  } else {
    ctx.goalManager.createGoal({
      title: String(params['title'] ?? decision.description),
      ...(params['description'] ? { description: String(params['description']) } : {}),
      ...(params['motivation'] ? { motivation: String(params['motivation']) } : {}),
      origin,
      ...(params['linkedEmotion'] ? { linkedEmotion: params['linkedEmotion'] as EmotionName } : {}),
      status: origin === 'user_directed' ? 'active' : 'proposed',
      ...(typeof params['basePriority'] === 'number' ? { basePriority: params['basePriority'] } : {}),
      ...(params['completionCriteria'] ? { completionCriteria: String(params['completionCriteria']) } : {}),
    });
  }
});

// update_goal
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
      ctx.goalManager.completeGoal(goalId);
      taskStore.cancelTasksByGoalId(ctx.hbDb, goalId);
      break;
    case 'abandoned':
      ctx.goalManager.abandonGoal(goalId, params['reason'] ? String(params['reason']) : undefined);
      taskStore.cancelTasksByGoalId(ctx.hbDb, goalId);
      break;
    case 'resumed':
      ctx.goalManager.resumeGoal(goalId);
      break;
    default:
      log.warn(`Unknown goal status: ${newStatus}`);
  }
});

// create_plan
registerDecisionHandler('create_plan', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const goalId = String(params['goalId'] ?? '');
  const milestones = Array.isArray(params['milestones'])
    ? params['milestones'] as Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' }>
    : undefined;
  ctx.goalManager.createPlan(goalId, {
    strategy: String(params['strategy'] ?? ''),
    ...(milestones ? { milestones } : {}),
    createdBy: 'mind',
  });
});

// revise_plan
registerDecisionHandler('revise_plan', async (params, _decision, ctx) => {
  if (!ctx.goalManager) return;
  const goalId = String(params['goalId'] ?? '');
  const revisedMilestones = Array.isArray(params['milestones'])
    ? params['milestones'] as Array<{ title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'skipped' }>
    : undefined;
  ctx.goalManager.createPlan(goalId, {
    strategy: String(params['strategy'] ?? ''),
    ...(revisedMilestones ? { milestones: revisedMilestones } : {}),
    createdBy: 'mind',
  });
});
