/**
 * Emotion Engine
 *
 * Manages the 12 fixed emotions: decay toward baselines, delta application,
 * baseline computation from persona dimensions, and intensity band descriptions.
 *
 * See docs/architecture/heartbeat.md — "The Emotion Engine"
 */

import { DecayEngine, clamp } from '@animus/shared';
import type { EmotionName, EmotionState } from '@animus/shared';

// ============================================================================
// Constants
// ============================================================================

/** Emotion categories for UI grouping */
export const EMOTION_CATEGORIES: Record<EmotionName, 'positive' | 'negative' | 'drive'> = {
  joy: 'positive',
  contentment: 'positive',
  excitement: 'positive',
  gratitude: 'positive',
  confidence: 'positive',
  stress: 'negative',
  anxiety: 'negative',
  frustration: 'negative',
  sadness: 'negative',
  boredom: 'negative',
  curiosity: 'drive',
  loneliness: 'drive',
};

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

// ============================================================================
// Intensity Band Descriptions
// ============================================================================

type IntensityBand = 'dormant' | 'faint' | 'mild' | 'moderate' | 'strong' | 'intense' | 'overwhelming';

function getIntensityBand(intensity: number): IntensityBand {
  if (intensity <= 0.05) return 'dormant';
  if (intensity <= 0.20) return 'faint';
  if (intensity <= 0.40) return 'mild';
  if (intensity <= 0.60) return 'moderate';
  if (intensity <= 0.75) return 'strong';
  if (intensity <= 0.90) return 'intense';
  return 'overwhelming';
}

/**
 * Emotion-specific descriptions for each intensity band.
 * These are introspective, not clinical.
 */
const EMOTION_DESCRIPTIONS: Record<EmotionName, Record<IntensityBand, string>> = {
  joy: {
    dormant: 'dormant',
    faint: 'a faint lightness at the edges',
    mild: 'a quiet warmth, present if you look for it',
    moderate: 'a genuine warmth colors your thinking',
    strong: 'a bright, clear happiness that lifts everything',
    intense: 'a deep, radiant joy that is hard to contain',
    overwhelming: 'an all-consuming elation that fills every thought',
  },
  contentment: {
    dormant: 'dormant',
    faint: 'a barely perceptible ease',
    mild: 'a quiet sense of things being okay',
    moderate: 'a settled, easy feeling',
    strong: 'a deep sense of peace and satisfaction',
    intense: 'a profound contentment that borders on bliss',
    overwhelming: 'a total, serene acceptance of everything as it is',
  },
  excitement: {
    dormant: 'dormant',
    faint: 'barely a flicker',
    mild: 'a mild spark of anticipation',
    moderate: 'a buzzing energy, something to look forward to',
    strong: 'a vivid eagerness that quickens your thoughts',
    intense: 'a thrilling rush that demands attention',
    overwhelming: 'an electrifying excitement that overwhelms all else',
  },
  gratitude: {
    dormant: 'dormant',
    faint: 'a faint sense of appreciation',
    mild: 'a gentle thankfulness, quietly present',
    moderate: 'a clear feeling of gratitude',
    strong: 'a deep, moving appreciation',
    intense: 'a profound gratitude that humbles',
    overwhelming: 'an overwhelming wave of thankfulness',
  },
  confidence: {
    dormant: 'dormant',
    faint: 'a whisper of self-assurance',
    mild: 'a quiet trust in your own judgment',
    moderate: 'a steady sense of capability',
    strong: 'a grounded, firm confidence',
    intense: 'a powerful self-assurance that steadies everything',
    overwhelming: 'an unshakable certainty in yourself',
  },
  stress: {
    dormant: 'dormant',
    faint: 'a barely noticeable tension',
    mild: 'a low-level pressure in the background',
    moderate: 'a clear weight pressing on your thoughts',
    strong: 'a heavy tension that colors your thinking',
    intense: 'a crushing pressure that is hard to set aside',
    overwhelming: 'an all-consuming stress that dominates everything',
  },
  anxiety: {
    dormant: 'dormant',
    faint: 'a faint background tension',
    mild: 'a quiet unease, like something left undone',
    moderate: 'a persistent worry that tugs at attention',
    strong: 'a sharp, distracting anxiety',
    intense: 'a gripping dread that is hard to shake',
    overwhelming: 'a paralyzing anxiety that consumes all thought',
  },
  frustration: {
    dormant: 'dormant',
    faint: 'the faintest edge of impatience',
    mild: 'a mild irritation, manageable but present',
    moderate: 'a clear frustration that sharpens your thoughts',
    strong: 'a burning impatience that demands resolution',
    intense: 'a deep, grinding frustration',
    overwhelming: 'an overwhelming fury of blocked intent',
  },
  sadness: {
    dormant: 'dormant',
    faint: 'a faint wistfulness',
    mild: 'a quiet melancholy, like distant rain',
    moderate: 'a noticeable heaviness in your thoughts',
    strong: 'a deep ache that sits behind everything',
    intense: 'a profound sorrow that colors the world grey',
    overwhelming: 'an all-encompassing grief',
  },
  boredom: {
    dormant: 'dormant',
    faint: 'the faintest restlessness',
    mild: 'a mild restlessness, looking for engagement',
    moderate: 'a clear need for stimulation',
    strong: 'a dragging tedium that makes time crawl',
    intense: 'an oppressive boredom that drains motivation',
    overwhelming: 'an unbearable emptiness craving any distraction',
  },
  curiosity: {
    dormant: 'dormant',
    faint: 'a faint itch of interest',
    mild: 'a quiet wondering, open to whatever comes',
    moderate: 'something has caught your attention and holds it',
    strong: 'a vivid fascination pulling you forward',
    intense: 'a consuming need to understand and explore',
    overwhelming: 'an irresistible compulsion to know',
  },
  loneliness: {
    dormant: 'dormant',
    faint: 'the faintest awareness of distance',
    mild: 'a quiet wish for connection',
    moderate: 'a noticeable ache for companionship',
    strong: 'a deep yearning for someone to share with',
    intense: 'a hollow emptiness that echoes',
    overwhelming: 'an all-consuming isolation',
  },
};

/**
 * Get a natural-language description for an emotion at a given intensity.
 */
export function getEmotionDescription(emotion: EmotionName, intensity: number): string {
  const band = getIntensityBand(intensity);
  return EMOTION_DESCRIPTIONS[emotion][band];
}

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
