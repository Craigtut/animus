/**
 * Salience Scoring — computes how prominent a goal is in the mind's consciousness.
 *
 * Score formula:
 *   salience = clamp(base_priority + emotional_resonance + user_engagement
 *              + progress_momentum + urgency + staleness_penalty + novelty, 0, 1)
 *
 * See docs/architecture/goals.md — "Goal Salience"
 */

import { clamp, DecayEngine } from '@animus-labs/shared';
import type { Goal, EmotionState } from '@animus-labs/shared';

// ============================================================================
// Constants
// ============================================================================

export const GOAL_VISIBILITY_THRESHOLD = 0.3;
export const MAX_GOALS_IN_CONTEXT = 5;
export const RESONANCE_WEIGHT = 0.4;

// ============================================================================
// Types
// ============================================================================

export interface SalienceComponents {
  basePriority: number;
  emotionalResonance: number;
  userEngagement: number;
  progressMomentum: number;
  urgency: number;
  stalenessPenalty: number;
  novelty: number;
}

export interface SalienceResult {
  salience: number;
  components: SalienceComponents;
}

// ============================================================================
// Salience Computation
// ============================================================================

/**
 * Compute salience for a goal given current emotional state and baselines.
 */
export function computeSalience(
  goal: Goal,
  emotionStates: EmotionState[],
): SalienceResult {
  const nowMs = Date.now();

  // 1. Base priority
  const basePriority = goal.basePriority;

  // 2. Emotional resonance
  const emotionalResonance = computeEmotionalResonance(
    goal.linkedEmotion,
    emotionStates
  );

  // 3. User engagement
  const userEngagement = computeUserEngagement(goal.lastUserMentionAt, nowMs);

  // 4. Progress momentum
  const progressMomentum = computeProgressMomentum(goal.lastProgressAt, nowMs);

  // 5. Urgency (deadline proximity)
  const urgency = computeUrgency(goal.deadline, nowMs);

  // 6. Staleness penalty
  const stalenessPenalty = computeStalenessPenalty(
    goal.lastProgressAt,
    goal.lastUserMentionAt,
    nowMs
  );

  // 7. Novelty (new goals get a brief boost)
  const novelty = computeNovelty(goal.createdAt, nowMs);

  const salience = clamp(
    basePriority + emotionalResonance + userEngagement +
    progressMomentum + urgency + stalenessPenalty + novelty,
    0, 1
  );

  return {
    salience,
    components: {
      basePriority,
      emotionalResonance,
      userEngagement,
      progressMomentum,
      urgency,
      stalenessPenalty,
      novelty,
    },
  };
}

// ============================================================================
// Component Functions
// ============================================================================

/**
 * Emotional resonance: clamp((intensity - baseline) * 0.4, -0.2, 0.2)
 */
function computeEmotionalResonance(
  linkedEmotion: string | null,
  emotionStates: EmotionState[],
): number {
  if (!linkedEmotion) return 0;

  const emotion = emotionStates.find((e) => e.emotion === linkedEmotion);
  if (!emotion) return 0;

  return clamp(
    (emotion.intensity - emotion.baseline) * RESONANCE_WEIGHT,
    -0.2,
    0.2
  );
}

/**
 * User engagement: boost if recently mentioned, decay if not.
 * Range: -0.1 to +0.2
 */
function computeUserEngagement(
  lastUserMentionAt: string | null,
  nowMs: number,
): number {
  if (!lastUserMentionAt) return 0;

  const hoursSince = (nowMs - new Date(lastUserMentionAt).getTime()) / 3_600_000;

  if (hoursSince < 1) return 0.2;       // Very recently mentioned
  if (hoursSince < 24) return 0.1;      // Mentioned today
  if (hoursSince < 168) return 0.02;    // Mentioned this week
  if (hoursSince > 336) return -0.1;    // Not mentioned in 2+ weeks

  return 0;
}

/**
 * Progress momentum: boost for recent progress, reduction for stalled goals.
 * Range: -0.1 to +0.1
 */
function computeProgressMomentum(
  lastProgressAt: string | null,
  nowMs: number,
): number {
  if (!lastProgressAt) return 0;

  const hoursSince = (nowMs - new Date(lastProgressAt).getTime()) / 3_600_000;

  if (hoursSince < 24) return 0.1;     // Progress today — on a roll
  if (hoursSince < 72) return 0.05;    // Progress this week
  if (hoursSince > 336) return -0.1;   // Stalled for 2+ weeks

  return 0;
}

/**
 * Urgency: boost as deadline approaches.
 * Range: 0 to +0.3
 */
function computeUrgency(
  deadline: string | null,
  nowMs: number,
): number {
  if (!deadline) return 0;

  const hoursUntil = (new Date(deadline).getTime() - nowMs) / 3_600_000;

  if (hoursUntil <= 0) return 0.3;      // Overdue
  if (hoursUntil < 24) return 0.25;     // Due today
  if (hoursUntil < 72) return 0.15;     // Due in 3 days
  if (hoursUntil < 168) return 0.08;    // Due this week
  if (hoursUntil < 720) return 0.03;    // Due this month

  return 0;
}

/**
 * Staleness penalty: reduction for goals with no activity.
 * Range: -0.2 to 0
 */
function computeStalenessPenalty(
  lastProgressAt: string | null,
  lastUserMentionAt: string | null,
  nowMs: number,
): number {
  // Find the most recent activity
  const timestamps = [lastProgressAt, lastUserMentionAt].filter(Boolean) as string[];
  if (timestamps.length === 0) return 0;

  const lastActivity = Math.max(...timestamps.map((t) => new Date(t).getTime()));
  const hoursSince = (nowMs - lastActivity) / 3_600_000;

  if (hoursSince < 168) return 0;          // Active within a week
  if (hoursSince < 336) return -0.05;      // 1-2 weeks stale
  if (hoursSince < 720) return -0.1;       // 2-4 weeks stale
  return -0.2;                              // 4+ weeks stale
}

/**
 * Novelty: brief boost for new goals that fades over 3 days.
 * Range: 0 to +0.1
 */
function computeNovelty(
  createdAt: string,
  nowMs: number,
): number {
  const hoursSince = (nowMs - new Date(createdAt).getTime()) / 3_600_000;

  if (hoursSince < 24) return 0.1;      // First day
  if (hoursSince < 48) return 0.05;     // Second day
  if (hoursSince < 72) return 0.02;     // Third day

  return 0;
}
