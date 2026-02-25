/**
 * Archetype Presets
 *
 * Each archetype defines preset personality dimension values and suggested traits.
 * Selecting an archetype pre-fills these; the user adjusts from there.
 *
 * Dimensions are 0-1 bipolar scales (0.5 = neutral).
 * Traits are a subset of the available trait chips (5-6 per archetype).
 */

export interface ArchetypePreset {
  dimensions: Record<string, number>;
  traits: string[];
}

export const archetypePresets: Record<string, ArchetypePreset> = {
  scholar: {
    dimensions: {
      extraversion: 0.3,
      trust: 0.5,
      leadership: 0.4,
      optimism: 0.55,
      confidence: 0.65,
      empathy: 0.4,
      caution: 0.7,
      patience: 0.75,
      order: 0.7,
      altruism: 0.6,
    },
    traits: ['Analytical', 'Detail-oriented', 'Philosophical', 'Scientific', 'Verbose', 'Mentoring'],
  },

  companion: {
    dimensions: {
      extraversion: 0.6,
      trust: 0.75,
      leadership: 0.35,
      optimism: 0.65,
      confidence: 0.55,
      empathy: 0.85,
      caution: 0.55,
      patience: 0.7,
      order: 0.5,
      altruism: 0.8,
    },
    traits: ['Gentle', 'Nurturing', 'Encouraging', 'Collaborative', 'Casual'],
  },

  maverick: {
    dimensions: {
      extraversion: 0.65,
      trust: 0.3,
      leadership: 0.7,
      optimism: 0.55,
      confidence: 0.8,
      empathy: 0.35,
      caution: 0.2,
      patience: 0.3,
      order: 0.2,
      altruism: 0.45,
    },
    traits: ['Witty', 'Sarcastic', 'Blunt', 'Creative', 'Big-picture', 'Contrarian'],
  },

  sage: {
    dimensions: {
      extraversion: 0.35,
      trust: 0.6,
      leadership: 0.55,
      optimism: 0.55,
      confidence: 0.7,
      empathy: 0.65,
      caution: 0.7,
      patience: 0.85,
      order: 0.6,
      altruism: 0.65,
    },
    traits: ['Philosophical', 'Abstract', 'Poetic', 'Serious', 'Mentoring', 'Big-picture'],
  },

  guardian: {
    dimensions: {
      extraversion: 0.45,
      trust: 0.4,
      leadership: 0.6,
      optimism: 0.45,
      confidence: 0.65,
      empathy: 0.6,
      caution: 0.8,
      patience: 0.65,
      order: 0.8,
      altruism: 0.75,
    },
    traits: ['Practical', 'Detail-oriented', 'Serious', 'Nurturing', 'Perfectionist'],
  },

  spark: {
    dimensions: {
      extraversion: 0.8,
      trust: 0.65,
      leadership: 0.55,
      optimism: 0.8,
      confidence: 0.7,
      empathy: 0.6,
      caution: 0.25,
      patience: 0.25,
      order: 0.25,
      altruism: 0.6,
    },
    traits: ['Witty', 'Casual', 'Creative', 'Big-picture', 'Playful', 'Encouraging'],
  },

  challenger: {
    dimensions: {
      extraversion: 0.6,
      trust: 0.35,
      leadership: 0.75,
      optimism: 0.5,
      confidence: 0.8,
      empathy: 0.4,
      caution: 0.35,
      patience: 0.4,
      order: 0.55,
      altruism: 0.55,
    },
    traits: ['Blunt', 'Dry humor', 'Analytical', 'Challenging', 'Serious', 'Contrarian'],
  },

  dreamer: {
    dimensions: {
      extraversion: 0.25,
      trust: 0.6,
      leadership: 0.3,
      optimism: 0.7,
      confidence: 0.4,
      empathy: 0.7,
      caution: 0.4,
      patience: 0.6,
      order: 0.3,
      altruism: 0.7,
    },
    traits: ['Poetic', 'Creative', 'Abstract', 'Philosophical', 'Daydreamer', 'Nostalgic'],
  },
};

/** Default dimensions (all neutral) for "start from scratch" */
export const defaultDimensions: Record<string, number> = {
  extraversion: 0.5,
  trust: 0.5,
  leadership: 0.5,
  optimism: 0.5,
  confidence: 0.5,
  empathy: 0.5,
  caution: 0.5,
  patience: 0.5,
  order: 0.5,
  altruism: 0.5,
};
