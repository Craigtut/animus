/**
 * Emotion Display Logic
 *
 * Pure display utilities for the 12 fixed emotions: intensity band classification,
 * human-readable band labels, poetic descriptions, and category grouping.
 *
 * These are extracted from the backend emotion engine so the frontend can render
 * rich emotion context without duplicating logic.
 */

import type { EmotionName } from './types/index.js';

// ============================================================================
// Intensity Bands
// ============================================================================

export type IntensityBand = 'dormant' | 'faint' | 'mild' | 'moderate' | 'strong' | 'intense' | 'overwhelming';

/** Classify a 0-1 intensity value into a named band. */
export function getIntensityBand(intensity: number): IntensityBand {
  if (intensity <= 0.05) return 'dormant';
  if (intensity <= 0.20) return 'faint';
  if (intensity <= 0.40) return 'mild';
  if (intensity <= 0.60) return 'moderate';
  if (intensity <= 0.75) return 'strong';
  if (intensity <= 0.90) return 'intense';
  return 'overwhelming';
}

/** Human-readable labels for each intensity band. */
export const INTENSITY_BAND_LABELS: Record<IntensityBand, string> = {
  dormant: 'Dormant',
  faint: 'Faint',
  mild: 'Mild',
  moderate: 'Moderate',
  strong: 'Strong',
  intense: 'Intense',
  overwhelming: 'Overwhelming',
};

// ============================================================================
// Emotion Categories
// ============================================================================

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

// ============================================================================
// Poetic Descriptions
// ============================================================================

/**
 * Emotion-specific descriptions for each intensity band.
 * These are introspective, not clinical.
 */
export const EMOTION_DESCRIPTIONS: Record<EmotionName, Record<IntensityBand, string>> = {
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
