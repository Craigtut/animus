/**
 * Goal Context — builds deterministic goal sections for the mind's context.
 *
 * Gather does not infer what the user is asking about. It always surfaces a
 * compact active-goal index, then adds richer detail for salient goals and
 * explicit review requests.
 */

import type {
  EmotionState,
  Goal,
  GoalEvent,
  GoalReviewRequest,
  GoalSeed,
  GoalSnapshot,
  Milestone,
  Plan,
} from '@animus-labs/shared';
import type { GoalManager } from './goal-manager.js';
import type { SeedManager } from './seed-manager.js';
import {
  GOAL_PLANNING_PROMPT_STRONGER_TICKS,
  GOAL_PLANNING_PROMPT_FORCEFUL_TICKS,
  PLANNING_PROMPT_MESSAGES,
  type PlanningPromptUrgency,
} from './planning.js';

export interface GoalContext {
  goalIndexSection: string | null;
  goalSection: string | null;
  graduatingSeedsSection: string | null;
  proposedGoalsSection: string | null;
  planningPromptsSection: string | null;
  tokenEstimate: number;
}

interface GoalContextBundle {
  goal: Goal;
  plan: Plan | null;
  currentMilestone: Milestone | null;
  snapshot: GoalSnapshot | null;
  pendingReviews: GoalReviewRequest[];
  recentEvents: GoalEvent[];
}

/**
 * Build goal context for a tick.
 */
export function buildGoalContext(
  goalManager: GoalManager,
  seedManager: SeedManager,
  emotionStates: EmotionState[],
  currentTickNumber: number,
  tokenBudget: number = 2200,
): GoalContext {
  let tokenEstimate = 0;

  const salientGoals = goalManager.computeAndUpdateSalience(emotionStates);
  const activeGoals = goalManager.getActiveGoals(8);
  const activeBundles = activeGoals.map((goal) => buildBundle(goalManager, goal));

  let goalIndexSection: string | null = null;
  if (activeBundles.length > 0) {
    goalIndexSection = formatGoalIndex(activeBundles);
    tokenEstimate += estimate(goalIndexSection);
  }

  const salientGoalIds = new Set(salientGoals.map(({ goal }) => goal.id));
  const salientBundles = activeBundles.filter((bundle) => salientGoalIds.has(bundle.goal.id));

  let goalSection: string | null = null;
  if (salientBundles.length > 0 && tokenEstimate < tokenBudget) {
    goalSection = formatGoalSection(salientBundles);
    tokenEstimate += estimate(goalSection);
  }

  const graduatingSeeds = seedManager.getGraduatingSeeds();
  let graduatingSeedsSection: string | null = null;

  if (graduatingSeeds.length > 0 && tokenEstimate < tokenBudget) {
    graduatingSeedsSection = formatGraduatingSeeds(graduatingSeeds);
    tokenEstimate += estimate(graduatingSeedsSection);
  }

  const proposedGoals = goalManager.getGoalsByStatus('proposed');
  let proposedGoalsSection: string | null = null;

  if (proposedGoals.length > 0 && tokenEstimate < tokenBudget) {
    proposedGoalsSection = formatProposedGoals(proposedGoals);
    tokenEstimate += estimate(proposedGoalsSection);
  }

  let planningPromptsSection: string | null = null;
  if (activeGoals.length > 0 && tokenEstimate < tokenBudget) {
    const prompts = generatePlanningPrompts(
      activeBundles.map(({ goal, plan }) => ({
        id: goal.id,
        title: goal.title,
        activatedAtTick: goal.activatedAtTick ?? null,
        hasPlan: plan !== null,
      })),
      currentTickNumber,
    );

    if (prompts.length > 0) {
      planningPromptsSection = prompts
        .map((p) => `── NOTE ──\n${p.message}\nUse create_plan_version when you form the plan.`)
        .join('\n\n');
      tokenEstimate += estimate(planningPromptsSection);
    }
  }

  return {
    goalIndexSection,
    goalSection,
    graduatingSeedsSection,
    proposedGoalsSection,
    planningPromptsSection,
    tokenEstimate,
  };
}

// ============================================================================
// Formatters
// ============================================================================

function buildBundle(goalManager: GoalManager, goal: Goal): GoalContextBundle {
  const plan = goalManager.getActivePlan(goal.id);
  const snapshot = goalManager.getGoalSnapshot(goal.id);
  const currentMilestone = snapshot?.currentMilestoneId
    ? goalManager.getMilestone(snapshot.currentMilestoneId)
    : goalManager.getCurrentMilestone(goal.id);

  return {
    goal,
    plan,
    currentMilestone,
    snapshot,
    pendingReviews: goalManager.getPendingReviewRequests(goal.id).slice(0, 4),
    recentEvents: goalManager.getRecentEvents(goal.id, 5),
  };
}

function formatGoalIndex(bundles: GoalContextBundle[]): string {
  const lines: string[] = [];

  for (const bundle of bundles) {
    const { goal, plan, currentMilestone, snapshot, pendingReviews } = bundle;
    lines.push(`${goal.title} [goalId: ${goal.id}]`);
    lines.push(`  Salience: ${goal.currentSalience.toFixed(2)}${plan ? ` | Plan: v${plan.version} [planId: ${plan.id}]` : ' | Plan: none'}`);
    if (currentMilestone) {
      lines.push(`  Current milestone: ${currentMilestone.title} [milestoneId: ${currentMilestone.id}, status: ${currentMilestone.status}]`);
    }
    if (snapshot?.nextBestMove) {
      lines.push(`  Next best move: ${snapshot.nextBestMove}`);
    }
    if (pendingReviews.length > 0) {
      lines.push(`  Review cues: ${pendingReviews.map((request) => `${request.scope} [reviewRequestId: ${request.id}, ${request.urgency}]`).join('; ')}`);
    }
  }

  return lines.join('\n');
}

function formatGoalSection(bundles: GoalContextBundle[]): string {
  return bundles.map((bundle, index) => formatGoalDetail(bundle, index + 1)).join('\n\n');
}

function formatGoalDetail(bundle: GoalContextBundle, index: number): string {
  const { goal, plan, currentMilestone, snapshot, pendingReviews, recentEvents } = bundle;
  const lines: string[] = [];

  lines.push(`${index}. ${goal.title} [goalId: ${goal.id}]`);
  if (goal.motivation) lines.push(`   Why: ${goal.motivation}`);
  if (goal.completionCriteria) lines.push(`   Done when: ${goal.completionCriteria}`);

  if (snapshot) {
    if (snapshot.summary) lines.push(`   Snapshot: ${snapshot.summary}`);
    if (snapshot.recentProgress) lines.push(`   Recent progress: ${snapshot.recentProgress}`);
    if (snapshot.knownBlockers.length > 0) {
      lines.push(`   Known blockers: ${snapshot.knownBlockers.join('; ')}`);
    }
    if (snapshot.openQuestions.length > 0) {
      lines.push(`   Open questions: ${snapshot.openQuestions.join('; ')}`);
    }
    if (snapshot.nextBestMove) lines.push(`   Next best move: ${snapshot.nextBestMove}`);
    lines.push(`   Confidence: plan ${snapshot.planConfidence.toFixed(2)}, completion ${snapshot.completionConfidence.toFixed(2)}`);
  }

  if (plan) {
    lines.push(`   Plan v${plan.version} [planId: ${plan.id}]: ${trim(plan.strategy, 260)}`);
    if (plan.assumptions.length > 0) {
      lines.push(`   Assumptions: ${plan.assumptions.join('; ')}`);
    }
    if (plan.milestones && plan.milestones.length > 0) {
      lines.push('   Milestones:');
      for (const milestone of plan.milestones) {
        const marker = currentMilestone?.id === milestone.id ? 'current' : milestone.status;
        lines.push(`     - ${milestone.title} [milestoneId: ${milestone.id}, ${marker}]`);
        if (milestone.acceptanceCriteria) {
          lines.push(`       Acceptance: ${milestone.acceptanceCriteria}`);
        }
        if (milestone.blockerNotes) {
          lines.push(`       Blocker: ${milestone.blockerNotes}`);
        }
      }
    }
  } else {
    lines.push('   No active plan yet. Create one with create_plan_version when the moment is right.');
  }

  if (pendingReviews.length > 0) {
    lines.push('   Review cues:');
    for (const request of pendingReviews) {
      lines.push(`     - ${request.scope} [reviewRequestId: ${request.id}, urgency: ${request.urgency}]: ${request.reason}`);
    }
  }

  if (recentEvents.length > 0) {
    lines.push('   Recent events:');
    for (const event of recentEvents) {
      lines.push(`     - ${event.type}: ${trim(event.summary, 120)}`);
    }
  }

  return lines.join('\n');
}

function formatGraduatingSeeds(seeds: GoalSeed[]): string {
  return seeds.map((seed) =>
    `A pattern has emerged in your recent thinking: you've been consistently drawn toward "${seed.content}". [seedId: ${seed.id}] ` +
    (seed.motivation ? `Motivation: ${seed.motivation}. ` : '') +
    `If you want to pursue this, use propose_goal with this seedId. Otherwise ignore it; it will fade naturally.`
  ).join('\n\n');
}

function formatProposedGoals(goals: Goal[]): string {
  return goals.map((g) =>
    `Proposed goal awaiting approval: "${g.title}" [goalId: ${g.id}]` +
    (g.motivation ? `, ${g.motivation}` : '') +
    ` -> To activate: update_goal { goalId: "${g.id}", status: "active" } | To reject: update_goal { goalId: "${g.id}", status: "abandoned" }`
  ).join('\n');
}

function estimate(section: string): number {
  return Math.ceil(section.split(/\s+/).length * 1.3);
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '...';
}

// ============================================================================
// Planning Prompts
// ============================================================================

function computePlanningPromptUrgency(ticksSinceActivation: number): PlanningPromptUrgency {
  if (ticksSinceActivation >= GOAL_PLANNING_PROMPT_FORCEFUL_TICKS) {
    return 'forceful';
  } else if (ticksSinceActivation >= GOAL_PLANNING_PROMPT_STRONGER_TICKS) {
    return 'stronger';
  }
  return 'soft';
}

export function generatePlanningPrompts(
  goals: Array<{ id: string; title: string; activatedAtTick: number | null; hasPlan: boolean }>,
  currentTickNumber: number,
): Array<{ goalId: string; goalTitle: string; urgency: PlanningPromptUrgency; message: string }> {
  const prompts: Array<{ goalId: string; goalTitle: string; urgency: PlanningPromptUrgency; message: string }> = [];

  for (const goal of goals) {
    if (goal.hasPlan || goal.activatedAtTick === null) continue;

    const ticksSinceActivation = currentTickNumber - goal.activatedAtTick;
    if (ticksSinceActivation < 0) continue;

    const urgency = computePlanningPromptUrgency(ticksSinceActivation);
    const message = PLANNING_PROMPT_MESSAGES[urgency].replace('{title}', goal.title);

    prompts.push({
      goalId: goal.id,
      goalTitle: goal.title,
      urgency,
      message,
    });
  }

  return prompts;
}
