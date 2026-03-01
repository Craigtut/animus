import { describe, it, expect } from 'vitest';
import {
  getIntensityBand,
  getEmotionDescription,
  INTENSITY_BAND_LABELS,
  EMOTION_CATEGORIES,
  EMOTION_DESCRIPTIONS,
} from '../src/emotions.js';
import type { IntensityBand } from '../src/emotions.js';
import type { EmotionName } from '../src/types/index.js';

describe('getIntensityBand', () => {
  it('returns dormant for very low values', () => {
    expect(getIntensityBand(0)).toBe('dormant');
    expect(getIntensityBand(0.05)).toBe('dormant');
  });

  it('returns faint for low values', () => {
    expect(getIntensityBand(0.06)).toBe('faint');
    expect(getIntensityBand(0.20)).toBe('faint');
  });

  it('returns mild for moderate-low values', () => {
    expect(getIntensityBand(0.21)).toBe('mild');
    expect(getIntensityBand(0.40)).toBe('mild');
  });

  it('returns moderate for mid-range values', () => {
    expect(getIntensityBand(0.41)).toBe('moderate');
    expect(getIntensityBand(0.60)).toBe('moderate');
  });

  it('returns strong for high values', () => {
    expect(getIntensityBand(0.61)).toBe('strong');
    expect(getIntensityBand(0.75)).toBe('strong');
  });

  it('returns intense for very high values', () => {
    expect(getIntensityBand(0.76)).toBe('intense');
    expect(getIntensityBand(0.90)).toBe('intense');
  });

  it('returns overwhelming for extreme values', () => {
    expect(getIntensityBand(0.91)).toBe('overwhelming');
    expect(getIntensityBand(1.0)).toBe('overwhelming');
  });
});

describe('INTENSITY_BAND_LABELS', () => {
  it('has a human-readable label for every band', () => {
    const bands: IntensityBand[] = ['dormant', 'faint', 'mild', 'moderate', 'strong', 'intense', 'overwhelming'];
    for (const band of bands) {
      expect(INTENSITY_BAND_LABELS[band]).toBeDefined();
      expect(typeof INTENSITY_BAND_LABELS[band]).toBe('string');
      expect(INTENSITY_BAND_LABELS[band].length).toBeGreaterThan(0);
    }
  });
});

describe('EMOTION_CATEGORIES', () => {
  it('maps all 12 emotions', () => {
    const emotions: EmotionName[] = [
      'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
      'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
      'curiosity', 'loneliness',
    ];
    for (const emotion of emotions) {
      expect(['positive', 'negative', 'drive']).toContain(EMOTION_CATEGORIES[emotion]);
    }
  });

  it('categorizes positive emotions correctly', () => {
    expect(EMOTION_CATEGORIES.joy).toBe('positive');
    expect(EMOTION_CATEGORIES.contentment).toBe('positive');
    expect(EMOTION_CATEGORIES.confidence).toBe('positive');
  });

  it('categorizes negative emotions correctly', () => {
    expect(EMOTION_CATEGORIES.stress).toBe('negative');
    expect(EMOTION_CATEGORIES.anxiety).toBe('negative');
    expect(EMOTION_CATEGORIES.sadness).toBe('negative');
  });

  it('categorizes drive emotions correctly', () => {
    expect(EMOTION_CATEGORIES.curiosity).toBe('drive');
    expect(EMOTION_CATEGORIES.loneliness).toBe('drive');
  });
});

describe('EMOTION_DESCRIPTIONS', () => {
  it('has descriptions for all 12 emotions across all 7 bands', () => {
    const emotions: EmotionName[] = [
      'joy', 'contentment', 'excitement', 'gratitude', 'confidence',
      'stress', 'anxiety', 'frustration', 'sadness', 'boredom',
      'curiosity', 'loneliness',
    ];
    const bands: IntensityBand[] = ['dormant', 'faint', 'mild', 'moderate', 'strong', 'intense', 'overwhelming'];

    for (const emotion of emotions) {
      for (const band of bands) {
        expect(EMOTION_DESCRIPTIONS[emotion][band]).toBeDefined();
        expect(typeof EMOTION_DESCRIPTIONS[emotion][band]).toBe('string');
        expect(EMOTION_DESCRIPTIONS[emotion][band].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('getEmotionDescription', () => {
  it('returns the correct description for a given emotion and intensity', () => {
    expect(getEmotionDescription('joy', 0.0)).toBe('dormant');
    expect(getEmotionDescription('joy', 0.5)).toBe('a genuine warmth colors your thinking');
    expect(getEmotionDescription('joy', 1.0)).toBe('an all-consuming elation that fills every thought');
  });

  it('returns different descriptions for different intensity levels', () => {
    const low = getEmotionDescription('anxiety', 0.1);
    const mid = getEmotionDescription('anxiety', 0.5);
    const high = getEmotionDescription('anxiety', 0.95);
    expect(low).not.toBe(mid);
    expect(mid).not.toBe(high);
  });

  it('matches the correct band boundaries', () => {
    // At boundary 0.20, should be faint
    expect(getEmotionDescription('curiosity', 0.20)).toBe(EMOTION_DESCRIPTIONS.curiosity.faint);
    // Just above 0.20, should be mild
    expect(getEmotionDescription('curiosity', 0.21)).toBe(EMOTION_DESCRIPTIONS.curiosity.mild);
  });
});
