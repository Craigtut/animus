/**
 * Goal Context — builds goal sections for the mind's context.
 *
 * Formats salient goals, active seeds (graduating only), and plans
 * into prompt sections.
 */

import type { Goal, Plan, GoalSeed, EmotionState } from '@animus-labs/shared';
import type { GoalManager } from './goal-manager.js';
import type { SeedManager } from './seed-manager.js';
import type { SalienceResult } from './salience.js';
import {
  GOAL_PLANNING_PROMPT_STRONGER_TICKS,
  GOAL_PLANNING_PROMPT_FORCEFUL_TICKS,
  PLANNING_PROMPT_MESSAGES,
  type PlanningPromptUrgency,
} from './planning.js';

export interface GoalContext {
  goalSection: string | null;
  graduatingSeedsSection: string | null;
  proposedGoalsSection: string | null;
  planningPromptsSection: string | null;
  tokenEstimate: number;
}

/**
 * Build goal context for a tick.
 */
export function buildGoalContext(
  goalManager: GoalManager,
  seedManager: SeedManager,
  emotionStates: EmotionState[],
  currentTickNumber: number,
  tokenBudget: number = 1500,
): GoalContext {
  let tokenEstimate = 0;

  // 1. Compute salience and get visible goals
  const salientGoals = goalManager.computeAndUpdateSalience(emotionStates);
  let goalSection: string | null = null;

  // Track which goals have plans for planning prompt generation
  const goalsWithPlanStatus: Array<{ goal: Goal; hasPlan: boolean }> = [];

  if (salientGoals.length > 0 && tokenEstimate < tokenBudget) {
    const goalsAndPlans = salientGoals.map(({ goal }) => ({
      goal,
      plan: goalManager.getActivePlan(goal.id),
    }));
    goalSection = formatGoalSection(goalsAndPlans);
    tokenEstimate += Math.ceil(goalSection.split(/\s+/).length * 1.3);

    for (const { goal, plan } of goalsAndPlans) {
      goalsWithPlanStatus.push({ goal, hasPlan: plan !== null });
    }
  }

  // 2. Check for graduating seeds
  const graduatingSeeds = seedManager.getGraduatingSeeds();
  let graduatingSeedsSection: string | null = null;

  if (graduatingSeeds.length > 0 && tokenEstimate < tokenBudget) {
    graduatingSeedsSection = formatGraduatingSeeds(graduatingSeeds);
    tokenEstimate += Math.ceil(graduatingSeedsSection.split(/\s+/).length * 1.3);
  }

  // 3. Check for proposed goals awaiting approval
  const proposedGoals = goalManager.getGoalsByStatus('proposed');
  let proposedGoalsSection: string | null = null;

  if (proposedGoals.length > 0 && tokenEstimate < tokenBudget) {
    proposedGoalsSection = formatProposedGoals(proposedGoals);
    tokenEstimate += Math.ceil(proposedGoalsSection.split(/\s+/).length * 1.3);
  }

  // 4. Generate planning prompts for active goals without plans
  let planningPromptsSection: string | null = null;

  if (goalsWithPlanStatus.length > 0 && tokenEstimate < tokenBudget) {
    const prompts = generatePlanningPrompts(
      goalsWithPlanStatus.map(({ goal, hasPlan }) => ({
        id: goal.id,
        title: goal.title,
        activatedAtTick: goal.activatedAtTick ?? null,
        hasPlan,
      })),
      currentTickNumber,
    );

    if (prompts.length > 0) {
      planningPromptsSection = prompts
        .map((p) => `── NOTE ──\n${p.message}`)
        .join('\n\n');
      tokenEstimate += Math.ceil(planningPromptsSection.split(/\s+/).length * 1.3);
    }
  }

  return { goalSection, graduatingSeedsSection, proposedGoalsSection, planningPromptsSection, tokenEstimate };
}

// ============================================================================
// Formatters
// ============================================================================

function formatGoalSection(
  goals: Array<{ goal: Goal; plan: Plan | null }>
): string {
  const lines: string[] = [];

  for (let i = 0; i < goals.length; i++) {
    const { goal, plan } = goals[i]!;
    lines.push(`${i + 1}. ${goal.title} [goalId: ${goal.id}]`);
    if (goal.motivation) {
      lines.push(`   Why: ${goal.motivation}`);
    }
    if (plan) {
      lines.push(`   Plan (v${plan.version}): ${plan.strategy.slice(0, 200)}`);
    }
    if (goal.lastProgressAt) {
      const hoursAgo = (Date.now() - new Date(goal.lastProgressAt).getTime()) / 3_600_000;
      if (hoursAgo < 24) {
        lines.push(`   Recent progress: today`);
      } else if (hoursAgo < 168) {
        lines.push(`   Recent progress: ${Math.floor(hoursAgo / 24)} days ago`);
      }
    }
  }

  return lines.join('\n');
}

function formatGraduatingSeeds(seeds: GoalSeed[]): string {
  return seeds.map((seed) =>
    `A pattern has emerged in your recent thinking: you've been consistently drawn toward "${seed.content}". [seedId: ${seed.id}] ` +
    (seed.motivation ? `Motivation: ${seed.motivation}. ` : '') +
    `If you want to pursue this, use propose_goal with this seedId. Otherwise ignore it — it will fade naturally.`
  ).join('\n\n');
}

function formatProposedGoals(goals: Goal[]): string {
  return goals.map((g) =>
    `Proposed goal awaiting approval: "${g.title}" [goalId: ${g.id}]` +
    (g.motivation ? ` — ${g.motivation}` : '') +
    ` → To activate: update_goal { goalId: "${g.id}", status: "active" } | To reject: update_goal { goalId: "${g.id}", status: "abandoned" }`
  ).join('\n');
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
    // Only generate prompts for active goals without plans
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
