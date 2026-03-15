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
    faint: 'a faint feeling of happiness, barely there',
    mild: 'a mild happiness, noticeable but not strong',
    moderate: 'a steady feeling of happiness that noticeably colors your thinking',
    strong: 'a strong, clear happiness that lifts everything',
    intense: 'a deep, radiant joy that is hard to contain',
    overwhelming: 'an all-consuming feeling of joy that fills every thought',
  },
  contentment: {
    dormant: 'dormant',
    faint: 'a barely perceptible feeling of ease',
    mild: 'a slight feeling that things are okay',
    moderate: 'a settled feeling of satisfaction',
    strong: 'a deep feeling of peace and satisfaction',
    intense: 'a profound contentment that borders on bliss',
    overwhelming: 'a total feeling of serene contentment with everything as it is',
  },
  excitement: {
    dormant: 'dormant',
    faint: 'a faint flicker of anticipation',
    mild: 'a mild feeling of anticipation',
    moderate: 'a noticeable excitement, something to look forward to',
    strong: 'a strong eagerness that quickens your thoughts',
    intense: 'a thrilling feeling of excitement that demands attention',
    overwhelming: 'an overwhelming excitement that eclipses all else',
  },
  gratitude: {
    dormant: 'dormant',
    faint: 'a faint feeling of appreciation',
    mild: 'a mild thankfulness, steady but not strong',
    moderate: 'a clear feeling of gratitude',
    strong: 'a deep, moving feeling of appreciation',
    intense: 'a profound feeling of gratitude that humbles',
    overwhelming: 'an overwhelming wave of thankfulness',
  },
  confidence: {
    dormant: 'dormant',
    faint: 'a faint sense of self-assurance',
    mild: 'a mild trust in your own judgment',
    moderate: 'a steady feeling of capability',
    strong: 'a strong, grounded confidence',
    intense: 'a powerful feeling of self-assurance that steadies everything',
    overwhelming: 'an unshakable feeling of certainty in yourself',
  },
  stress: {
    dormant: 'dormant',
    faint: 'a barely noticeable feeling of tension',
    mild: 'a low-level feeling of pressure in the background',
    moderate: 'a clear feeling of stress pressing on your thoughts',
    strong: 'a heavy feeling of tension that colors your thinking',
    intense: 'a crushing feeling of pressure that is hard to set aside',
    overwhelming: 'an all-consuming feeling of stress that dominates everything',
  },
  anxiety: {
    dormant: 'dormant',
    faint: 'a faint feeling of unease',
    mild: 'a low but persistent feeling of unease, like something left undone',
    moderate: 'a persistent feeling of worry that tugs at attention',
    strong: 'a sharp, distracting feeling of anxiety',
    intense: 'a gripping feeling of dread that is hard to shake',
    overwhelming: 'a paralyzing feeling of anxiety that consumes all thought',
  },
  frustration: {
    dormant: 'dormant',
    faint: 'the faintest feeling of impatience',
    mild: 'a mild feeling of irritation, manageable but present',
    moderate: 'a clear feeling of frustration that sharpens your focus',
    strong: 'a strong, burning impatience that demands resolution',
    intense: 'a deep, grinding feeling of frustration',
    overwhelming: 'an overwhelming feeling of frustration and blocked intent',
  },
  sadness: {
    dormant: 'dormant',
    faint: 'a faint feeling of sadness',
    mild: 'a mild sadness, present but manageable',
    moderate: 'a noticeable feeling of sadness that weighs on your thoughts',
    strong: 'a deep feeling of sadness that sits behind everything',
    intense: 'a profound feeling of sorrow that colors everything',
    overwhelming: 'an all-encompassing feeling of grief',
  },
  boredom: {
    dormant: 'dormant',
    faint: 'the faintest feeling of restlessness',
    mild: 'a mild restlessness, looking for something to engage with',
    moderate: 'a noticeable feeling of boredom, wanting stimulation',
    strong: 'a strong feeling of tedium, impatient for something to do',
    intense: 'an intense restlessness, desperate for something to engage with',
    overwhelming: 'an unbearable feeling of boredom craving any distraction',
  },
  curiosity: {
    dormant: 'dormant',
    faint: 'a faint feeling of interest',
    mild: 'a mild sense of curiosity, open to whatever comes',
    moderate: 'a noticeable pull of curiosity that holds your attention',
    strong: 'a strong fascination pulling you forward',
    intense: 'a consuming feeling of curiosity, needing to understand and explore',
    overwhelming: 'an irresistible feeling of compulsion to know',
  },
  loneliness: {
    dormant: 'dormant',
    faint: 'a faint feeling of distance from others',
    mild: 'a mild longing for connection',
    moderate: 'a noticeable feeling of loneliness, wanting companionship',
    strong: 'a deep yearning for someone to share with',
    intense: 'a hollow feeling of loneliness that echoes',
    overwhelming: 'an all-consuming feeling of isolation',
  },
};

/**
 * Get a natural-language description for an emotion at a given intensity.
 */
export function getEmotionDescription(emotion: EmotionName, intensity: number): string {
  const band = getIntensityBand(intensity);
  return EMOTION_DESCRIPTIONS[emotion][band];
}
