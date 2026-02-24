/**
 * Planning Prompt Escalation — Constants & Types
 *
 * When an active goal has no plan, the system injects escalating prompts
 * into the mind's context to guide (not force) plan creation.
 */

/**
 * Tick thresholds for planning prompt urgency escalation.
 * When an active goal has no plan, the prompt urgency increases over time:
 * - 0 to STRONGER ticks: 'soft' prompts
 * - STRONGER to FORCEFUL ticks: 'stronger' prompts
 * - FORCEFUL+ ticks: 'forceful' prompts
 */
export const GOAL_PLANNING_PROMPT_STRONGER_TICKS = 3;
export const GOAL_PLANNING_PROMPT_FORCEFUL_TICKS = 10;

/**
 * Planning prompt urgency levels and their associated messages.
 */
export type PlanningPromptUrgency = 'soft' | 'stronger' | 'forceful';

export const PLANNING_PROMPT_MESSAGES: Record<PlanningPromptUrgency, string> = {
  soft: 'Your goal "{title}" has no plan yet. You might consider how you\'d approach it.',
  stronger: 'Your goal "{title}" still lacks a strategy. It would help to sketch out an approach — even a simple one.',
  forceful: 'Your goal "{title}" needs a plan. Take a moment now to outline how you\'d pursue it — whether that\'s a simple strategy you create directly, or delegating to a planning agent for something more complex.',
};
