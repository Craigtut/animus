/**
 * Goal System — exports
 */

export { computeSalience, GOAL_VISIBILITY_THRESHOLD, MAX_GOALS_IN_CONTEXT, RESONANCE_WEIGHT } from './salience.js';
export type { SalienceComponents, SalienceResult } from './salience.js';
export { SeedManager, cosineSimilarity, SEED_RESONANCE_THRESHOLD, SEED_BOOST_MULTIPLIER, SEED_DECAY_RATE, SEED_GRADUATION_THRESHOLD, SEED_CLEANUP_THRESHOLD } from './seed-manager.js';
export type { SeedWithEmbedding } from './seed-manager.js';
export { GoalManager } from './goal-manager.js';
export { buildGoalContext, generatePlanningPrompts } from './goal-context.js';
export type { GoalContext } from './goal-context.js';

// Planning prompt escalation (re-exported from planning.ts)
export {
  GOAL_PLANNING_PROMPT_STRONGER_TICKS,
  GOAL_PLANNING_PROMPT_FORCEFUL_TICKS,
  PLANNING_PROMPT_MESSAGES,
} from './planning.js';
export type { PlanningPromptUrgency } from './planning.js';
