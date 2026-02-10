/**
 * Goal Context — builds goal sections for the mind's context.
 *
 * Formats salient goals, active seeds (graduating only), and plans
 * into prompt sections.
 */

import type { Goal, Plan, GoalSeed, EmotionState } from '@animus/shared';
import type { GoalManager } from './goal-manager.js';
import type { SeedManager } from './seed-manager.js';
import type { SalienceResult } from './salience.js';

export interface GoalContext {
  goalSection: string | null;
  graduatingSeedsSection: string | null;
  proposedGoalsSection: string | null;
  tokenEstimate: number;
}

/**
 * Build goal context for a tick.
 */
export function buildGoalContext(
  goalManager: GoalManager,
  seedManager: SeedManager,
  emotionStates: EmotionState[],
  tokenBudget: number = 1500,
): GoalContext {
  let tokenEstimate = 0;

  // 1. Compute salience and get visible goals
  const salientGoals = goalManager.computeAndUpdateSalience(emotionStates);
  let goalSection: string | null = null;

  if (salientGoals.length > 0 && tokenEstimate < tokenBudget) {
    goalSection = formatGoalSection(salientGoals.map(({ goal }) => ({
      goal,
      plan: goalManager.getActivePlan(goal.id),
    })));
    tokenEstimate += Math.ceil(goalSection.split(/\s+/).length * 1.3);
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

  return { goalSection, graduatingSeedsSection, proposedGoalsSection, tokenEstimate };
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
    lines.push(`${i + 1}. ${goal.title}`);
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
    `A pattern has emerged in your recent thinking: you've been consistently drawn toward "${seed.content}". ` +
    (seed.motivation ? `Motivation: ${seed.motivation}. ` : '') +
    `Consider whether this is something you want to actively pursue as a goal.`
  ).join('\n\n');
}

function formatProposedGoals(goals: Goal[]): string {
  return goals.map((g) =>
    `Proposed goal awaiting approval: "${g.title}"` +
    (g.motivation ? ` — ${g.motivation}` : '')
  ).join('\n');
}
