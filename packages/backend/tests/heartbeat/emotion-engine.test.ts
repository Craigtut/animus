import { describe, it, expect } from 'vitest';
import {
  computeBaselines,
  applyDecay,
  applyDelta,
  getEmotionDescription,
  formatEmotionalState,
  ALL_EMOTIONS,
  DECAY_RATES,
  EMOTION_CATEGORIES,
  type PersonaDimensions,
} from '../../src/heartbeat/emotion-engine.js';
import type { EmotionState } from '@animus/shared';

function makeNeutralDimensions(): PersonaDimensions {
  return {
    extroversion: 0.5,
    trust: 0.5,
    leadership: 0.5,
    optimism: 0.5,
    confidence_dim: 0.5,
    empathy: 0.5,
    cautious: 0.5,
    patience: 0.5,
    orderly: 0.5,
    altruism: 0.5,
  };
}

function makeEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    emotion: 'joy',
    category: 'positive',
    intensity: 0.5,
    baseline: 0.0,
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('emotion-engine', () => {
  describe('constants', () => {
    it('has 12 emotions', () => {
      expect(ALL_EMOTIONS).toHaveLength(12);
    });

    it('has decay rates for all 12 emotions', () => {
      for (const emotion of ALL_EMOTIONS) {
        expect(DECAY_RATES[emotion]).toBeGreaterThan(0);
      }
    });

    it('has categories for all 12 emotions', () => {
      for (const emotion of ALL_EMOTIONS) {
        expect(['positive', 'negative', 'drive']).toContain(EMOTION_CATEGORIES[emotion]);
      }
    });
  });

  describe('computeBaselines', () => {
    it('returns zero baselines for all-neutral dimensions', () => {
      const dims = makeNeutralDimensions();
      const baselines = computeBaselines(dims);

      for (const emotion of ALL_EMOTIONS) {
        expect(baselines[emotion]).toBe(0);
      }
    });

    it('returns higher joy baseline for optimistic persona', () => {
      const dims = makeNeutralDimensions();
      dims.optimism = 0.9;
      const baselines = computeBaselines(dims);

      // Joy: optimism weight 0.10 => 0.10 * (0.9 - 0.5) * 2 = 0.08
      // Plus extroversion contribution at 0.5 = 0
      expect(baselines.joy).toBeCloseTo(0.08, 4);
    });

    it('returns higher anxiety baseline for pessimistic + insecure persona', () => {
      const dims = makeNeutralDimensions();
      dims.optimism = 0.2;
      dims.confidence_dim = 0.2;
      const baselines = computeBaselines(dims);

      // Anxiety: confidence_dim -0.10 + optimism -0.08
      // = (-0.10) * (0.2 - 0.5) * 2 + (-0.08) * (0.2 - 0.5) * 2
      // = 0.06 + 0.048 = 0.108
      expect(baselines.anxiety).toBeCloseTo(0.108, 3);
    });

    it('clamps baselines to [0, 0.25]', () => {
      const dims = makeNeutralDimensions();
      // Push everything extreme
      dims.extroversion = 1.0;
      dims.optimism = 1.0;
      const baselines = computeBaselines(dims);

      for (const emotion of ALL_EMOTIONS) {
        expect(baselines[emotion]).toBeGreaterThanOrEqual(0);
        expect(baselines[emotion]).toBeLessThanOrEqual(0.25);
      }
    });

    it('returns zero for negative-direction contributions', () => {
      const dims = makeNeutralDimensions();
      dims.optimism = 0.1; // Below neutral
      const baselines = computeBaselines(dims);

      // Sadness: optimism -0.08 contribution => (-0.08) * (0.1-0.5) * 2 = 0.064
      expect(baselines.sadness).toBeGreaterThan(0);
    });
  });

  describe('applyDecay', () => {
    it('returns same intensity if no time has elapsed', () => {
      const emotion = makeEmotionState({ intensity: 0.5 });
      const decayed = applyDecay([emotion], Date.now());
      expect(decayed[0].intensity).toBeCloseTo(0.5, 4);
    });

    it('decays toward baseline over time', () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const emotion = makeEmotionState({
        emotion: 'joy',
        intensity: 0.8,
        baseline: 0.0,
        lastUpdatedAt: oneHourAgo,
      });
      const decayed = applyDecay([emotion], Date.now());

      // After 1 hour with decay rate 0.384:
      // decayed = 0 + (0.8 - 0) * e^(-0.384 * 1) = 0.8 * 0.681 = ~0.545
      expect(decayed[0].intensity).toBeLessThan(0.8);
      expect(decayed[0].intensity).toBeGreaterThan(0);
      expect(decayed[0].intensity).toBeCloseTo(0.545, 1);
    });

    it('decays toward non-zero baseline', () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const emotion = makeEmotionState({
        emotion: 'joy',
        intensity: 0.8,
        baseline: 0.1,
        lastUpdatedAt: oneHourAgo,
      });
      const decayed = applyDecay([emotion], Date.now());

      // Should decay toward 0.1, not toward 0
      expect(decayed[0].intensity).toBeGreaterThan(0.1);
      expect(decayed[0].intensity).toBeLessThan(0.8);
    });

    it('boredom decays very fast', () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const boredom = makeEmotionState({
        emotion: 'boredom',
        category: 'negative',
        intensity: 0.8,
        baseline: 0.0,
        lastUpdatedAt: oneHourAgo,
      });
      const decayed = applyDecay([boredom], Date.now());

      // Boredom rate = 1.151, after 1h: 0.8 * e^(-1.151) = 0.8 * 0.316 = ~0.253
      expect(decayed[0].intensity).toBeLessThan(0.3);
    });

    it('anxiety decays very slowly', () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const anxiety = makeEmotionState({
        emotion: 'anxiety',
        category: 'negative',
        intensity: 0.8,
        baseline: 0.0,
        lastUpdatedAt: oneHourAgo,
      });
      const decayed = applyDecay([anxiety], Date.now());

      // Anxiety rate = 0.192, after 1h: 0.8 * e^(-0.192) = 0.8 * 0.825 = ~0.660
      expect(decayed[0].intensity).toBeGreaterThan(0.6);
    });
  });

  describe('applyDelta', () => {
    it('adds positive delta', () => {
      expect(applyDelta(0.3, 0.05)).toBeCloseTo(0.35);
    });

    it('subtracts negative delta', () => {
      expect(applyDelta(0.3, -0.05)).toBeCloseTo(0.25);
    });

    it('clamps to 0', () => {
      expect(applyDelta(0.1, -0.5)).toBe(0);
    });

    it('clamps to 1', () => {
      expect(applyDelta(0.9, 0.5)).toBe(1);
    });
  });

  describe('getEmotionDescription', () => {
    it('returns dormant for very low intensity', () => {
      expect(getEmotionDescription('joy', 0.01)).toBe('dormant');
    });

    it('returns faint description for low intensity', () => {
      const desc = getEmotionDescription('joy', 0.1);
      expect(desc).toContain('faint');
    });

    it('returns overwhelming for very high intensity', () => {
      const desc = getEmotionDescription('joy', 0.95);
      expect(desc).toContain('all-consuming');
    });

    it('has descriptions for all emotions at all bands', () => {
      const intensities = [0.0, 0.1, 0.3, 0.5, 0.7, 0.85, 0.95];
      for (const emotion of ALL_EMOTIONS) {
        for (const intensity of intensities) {
          const desc = getEmotionDescription(emotion, intensity);
          expect(desc).toBeTruthy();
        }
      }
    });
  });

  describe('formatEmotionalState', () => {
    it('produces formatted output with all emotions', () => {
      const emotions: EmotionState[] = ALL_EMOTIONS.map((e) => makeEmotionState({
        emotion: e,
        category: EMOTION_CATEGORIES[e],
        intensity: 0.3,
      }));

      const formatted = formatEmotionalState(emotions, 300000);
      expect(formatted).toContain('YOUR EMOTIONAL STATE');
      expect(formatted).toContain('joy:');
      expect(formatted).toContain('curiosity:');
      expect(formatted).toContain('5 minutes');
    });

    it('includes tick interval in output', () => {
      const emotions: EmotionState[] = [makeEmotionState({ intensity: 0.5 })];
      const formatted = formatEmotionalState(emotions, 900000);
      expect(formatted).toContain('15 minutes');
    });
  });
});
