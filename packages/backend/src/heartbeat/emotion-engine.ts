/**
 * Emotion Engine
 *
 * Manages the 12 fixed emotions: decay toward baselines, delta application,
 * baseline computation from persona dimensions, and intensity band descriptions.
 *
 * See docs/architecture/heartbeat.md — "The Emotion Engine"
 */

import { DecayEngine, clamp, EMOTION_CATEGORIES, getEmotionDescription } from '@animus-labs/shared';
import type { EmotionName, EmotionState } from '@animus-labs/shared';

export { EMOTION_CATEGORIES };

/** All 12 emotion names */
export const ALL_EMOTIONS: EmotionName[] = [
  'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
  'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
  'curiosity', 'loneliness',
];

/**
 * Per-emotion decay rates (per hour).
 * From docs/architecture/heartbeat.md — "Per-Emotion Decay Rates"
 */
export const DECAY_RATES: Record<EmotionName, number> = {
  joy: 0.384,
  contentment: 0.288,
  excitement: 0.767,
  gratitude: 0.461,
  confidence: 0.256,
  stress: 0.256,
  anxiety: 0.192,
  frustration: 0.576,
  sadness: 0.192,
  boredom: 1.151,
  curiosity: 0.384,
  loneliness: 0.230,
};

// ============================================================================
// Persona Dimension Names (for baseline computation)
// ============================================================================

export type PersonaDimension =
  | 'extroversion'
  | 'trust'
  | 'leadership'
  | 'optimism'
  | 'confidence_dim'
  | 'empathy'
  | 'cautious'
  | 'patience'
  | 'orderly'
  | 'altruism';

/**
 * Mapping from persona dimensions to emotion baselines.
 * From docs/architecture/heartbeat.md — "Personality Dimension → Emotion Baseline Mapping"
 *
 * Each entry: [dimension, weight]
 */
const BASELINE_WEIGHTS: Record<EmotionName, Array<[PersonaDimension, number]>> = {
  joy: [['optimism', 0.10], ['extroversion', 0.05]],
  contentment: [['optimism', 0.08], ['patience', 0.05]],
  excitement: [['extroversion', 0.08], ['cautious', -0.05], ['patience', -0.05]],
  gratitude: [['empathy', 0.08], ['altruism', 0.05]],
  confidence: [['confidence_dim', 0.12], ['leadership', 0.05]],
  stress: [['confidence_dim', -0.08], ['cautious', 0.05]],
  anxiety: [['confidence_dim', -0.10], ['optimism', -0.08]],
  frustration: [['patience', -0.10], ['orderly', 0.05]],
  sadness: [['optimism', -0.08], ['confidence_dim', -0.05]],
  boredom: [['extroversion', 0.08], ['patience', -0.05]],
  curiosity: [['cautious', -0.05], ['extroversion', 0.05]],
  loneliness: [['extroversion', 0.10], ['empathy', 0.05], ['trust', -0.03]],
};

// ============================================================================
// Baseline Computation
// ============================================================================

export interface PersonaDimensions {
  extroversion: number;      // 0-1 (introverted=0, extroverted=1)
  trust: number;             // 0-1 (suspicious=0, trusting=1)
  leadership: number;        // 0-1 (follower=0, leader=1)
  optimism: number;          // 0-1 (pessimistic=0, optimistic=1)
  confidence_dim: number;    // 0-1 (insecure=0, confident=1)
  empathy: number;           // 0-1 (uncompassionate=0, empathetic=1)
  cautious: number;          // 0-1 (reckless=0, cautious=1)
  patience: number;          // 0-1 (impulsive=0, patient=1)
  orderly: number;           // 0-1 (chaotic=0, orderly=1)
  altruism: number;          // 0-1 (selfish=0, altruistic=1)
}

/**
 * Compute emotion baseline from a single dimension contribution.
 * Formula: weight × (dimension - 0.5) × 2
 * This normalizes the 0-1 slider to a -1 to +1 range centered on neutral.
 */
function dimensionContribution(dimensionValue: number, weight: number): number {
  return weight * (dimensionValue - 0.5) * 2;
}

/**
 * Compute emotion baselines from persona dimensions.
 * Formula: baseline(emotion) = clamp(Σ weight × (dimension - 0.5) × 2, 0, 0.25)
 */
export function computeBaselines(
  dimensions: PersonaDimensions
): Record<EmotionName, number> {
  const baselines = {} as Record<EmotionName, number>;

  for (const emotion of ALL_EMOTIONS) {
    const weights = BASELINE_WEIGHTS[emotion];
    let sum = 0;
    for (const [dim, weight] of weights) {
      sum += dimensionContribution(dimensions[dim], weight);
    }
    baselines[emotion] = clamp(sum, 0, 0.25);
  }

  return baselines;
}

// ============================================================================
// Emotion Decay
// ============================================================================

/**
 * Apply time-based decay to all emotions.
 * Returns new intensities after decay toward their baselines.
 *
 * @param decayMultiplier - Optional multiplier for decay rates (e.g., 3.0 during sleep)
 */
export function applyDecay(
  emotions: EmotionState[],
  nowMs: number,
  decayMultiplier: number = 1.0
): EmotionState[] {
  return emotions.map((e) => {
    const elapsedMs = nowMs - new Date(e.lastUpdatedAt).getTime();
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    if (elapsedHours <= 0) return e;

    const rate = DECAY_RATES[e.emotion] * decayMultiplier;
    const decayed = DecayEngine.compute(e.intensity, e.baseline, rate, elapsedHours);

    return {
      ...e,
      intensity: clamp(decayed, 0, 1),
    };
  });
}

/**
 * Apply a single emotion delta and clamp to [0, 1].
 */
export function applyDelta(currentIntensity: number, delta: number): number {
  return clamp(currentIntensity + delta, 0, 1);
}

export { getEmotionDescription };

/**
 * Format all emotions for inclusion in the mind's context.
 */
export function formatEmotionalState(
  emotions: EmotionState[],
  tickIntervalMs: number
): string {
  const intervalDesc = formatInterval(tickIntervalMs);

  const lines: string[] = [
    '── YOUR EMOTIONAL STATE ──',
    `Current tick interval: ${intervalDesc}`,
    '',
  ];

  // Group by category
  const positive = emotions.filter((e) => EMOTION_CATEGORIES[e.emotion] === 'positive');
  const negative = emotions.filter((e) => EMOTION_CATEGORIES[e.emotion] === 'negative');
  const drive = emotions.filter((e) => EMOTION_CATEGORIES[e.emotion] === 'drive');

  for (const group of [positive, negative, drive]) {
    for (const e of group) {
      const desc = getEmotionDescription(e.emotion, e.intensity);
      const padded = (e.emotion + ':').padEnd(16);
      lines.push(`  ${padded}${e.intensity.toFixed(2)}  — ${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  if (remainingMin === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${hours}h ${remainingMin}m`;
}
