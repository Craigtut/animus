import { describe, it, expect } from 'vitest';
import {
  getEnergyBand,
  computeCircadianBaseline,
  applyEnergyDecay,
  isInSleepHours,
  formatEnergyContext,
  SLEEP_EMOTION_DECAY_MULTIPLIER,
  type WakeUpContext,
} from '../../src/heartbeat/energy-engine.js';
import { applyDecay } from '../../src/heartbeat/emotion-engine.js';
import type { EmotionState } from '@animus/shared';

// ============================================================================
// getEnergyBand
// ============================================================================

describe('getEnergyBand', () => {
  it('returns sleeping for 0.0', () => {
    expect(getEnergyBand(0.0)).toBe('sleeping');
  });

  it('returns sleeping for 0.049', () => {
    expect(getEnergyBand(0.049)).toBe('sleeping');
  });

  it('returns very_drowsy for 0.05', () => {
    expect(getEnergyBand(0.05)).toBe('very_drowsy');
  });

  it('returns very_drowsy for 0.099', () => {
    expect(getEnergyBand(0.099)).toBe('very_drowsy');
  });

  it('returns drowsy for 0.1', () => {
    expect(getEnergyBand(0.1)).toBe('drowsy');
  });

  it('returns drowsy for 0.199', () => {
    expect(getEnergyBand(0.199)).toBe('drowsy');
  });

  it('returns tired for 0.2', () => {
    expect(getEnergyBand(0.2)).toBe('tired');
  });

  it('returns tired for 0.399', () => {
    expect(getEnergyBand(0.399)).toBe('tired');
  });

  it('returns alert for 0.4', () => {
    expect(getEnergyBand(0.4)).toBe('alert');
  });

  it('returns alert for 0.699', () => {
    expect(getEnergyBand(0.699)).toBe('alert');
  });

  it('returns peak for 0.7', () => {
    expect(getEnergyBand(0.7)).toBe('peak');
  });

  it('returns peak for 1.0', () => {
    expect(getEnergyBand(1.0)).toBe('peak');
  });
});

// ============================================================================
// computeCircadianBaseline
// ============================================================================

describe('computeCircadianBaseline', () => {
  // Helper: create a Date at a specific UTC hour (using UTC timezone in tests)
  function dateAtUTCHour(hour: number, minute: number = 0): Date {
    const d = new Date('2025-06-15T00:00:00Z');
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  }

  describe('standard hours (22:00-07:00, midnight crossing)', () => {
    const sleepStart = 22;
    const sleepEnd = 7;
    const tz = 'UTC';

    it('midnight returns 0.0 (sleep floor)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(0), sleepStart, sleepEnd, tz)).toBe(0.0);
    });

    it('3am returns 0.0 (sleep floor)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(3), sleepStart, sleepEnd, tz)).toBe(0.0);
    });

    it('7am (wake time) returns 0.0 (start of ramp)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(7), sleepStart, sleepEnd, tz)).toBeCloseTo(0.0, 1);
    });

    it('8am returns ~0.425 (midway through ramp)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(8), sleepStart, sleepEnd, tz);
      expect(result).toBeCloseTo(0.425, 1);
    });

    it('9am returns 0.85 (ramp complete, plateau starts)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(9), sleepStart, sleepEnd, tz);
      expect(result).toBeCloseTo(0.85, 1);
    });

    it('14:00 returns 0.85 (daytime plateau)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(14), sleepStart, sleepEnd, tz)).toBe(0.85);
    });

    it('19:00 returns 0.85 (start of decline)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(19), sleepStart, sleepEnd, tz);
      expect(result).toBeCloseTo(0.85, 1);
    });

    it('20:00 returns ~0.567 (1h into decline)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(20), sleepStart, sleepEnd, tz);
      expect(result).toBeCloseTo(0.567, 1);
    });

    it('21:00 returns ~0.283 (2h into decline)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(21), sleepStart, sleepEnd, tz);
      expect(result).toBeCloseTo(0.283, 1);
    });

    it('22:00 returns 0.0 (sleep starts)', () => {
      const result = computeCircadianBaseline(dateAtUTCHour(22), sleepStart, sleepEnd, tz);
      expect(result).toBe(0.0);
    });

    it('23:00 returns 0.0 (during sleep)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(23), sleepStart, sleepEnd, tz)).toBe(0.0);
    });
  });

  describe('edge case: sleepStart === sleepEnd (no sleep)', () => {
    it('returns flat 0.85 at any hour', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(0), 22, 22, 'UTC')).toBe(0.85);
      expect(computeCircadianBaseline(dateAtUTCHour(12), 22, 22, 'UTC')).toBe(0.85);
      expect(computeCircadianBaseline(dateAtUTCHour(22), 22, 22, 'UTC')).toBe(0.85);
    });
  });

  describe('non-crossing sleep range (1:00-6:00)', () => {
    const sleepStart = 1;
    const sleepEnd = 6;
    const tz = 'UTC';

    it('3:00 returns 0.0 (sleep floor)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(3), sleepStart, sleepEnd, tz)).toBe(0.0);
    });

    it('6:00 returns 0.0 (wake time, start of ramp)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(6), sleepStart, sleepEnd, tz)).toBeCloseTo(0.0, 1);
    });

    it('8:00 returns 0.85 (ramp complete)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(8), sleepStart, sleepEnd, tz)).toBeCloseTo(0.85, 1);
    });

    it('12:00 returns 0.85 (plateau)', () => {
      expect(computeCircadianBaseline(dateAtUTCHour(12), sleepStart, sleepEnd, tz)).toBe(0.85);
    });
  });
});

// ============================================================================
// applyEnergyDecay
// ============================================================================

describe('applyEnergyDecay', () => {
  it('decays toward higher baseline', () => {
    // Energy 0.3, baseline 0.85, 1 hour
    const result = applyEnergyDecay(0.3, 0.85, 1);
    // Should be closer to 0.85 than 0.3
    expect(result).toBeGreaterThan(0.3);
    expect(result).toBeLessThan(0.85);
  });

  it('decays toward lower baseline', () => {
    // Energy 0.85, baseline 0.0, 1 hour
    const result = applyEnergyDecay(0.85, 0.0, 1);
    // Should be closer to 0.0 than 0.85
    expect(result).toBeLessThan(0.85);
    expect(result).toBeGreaterThan(0.0);
  });

  it('returns current energy when elapsed is 0', () => {
    expect(applyEnergyDecay(0.5, 0.85, 0)).toBe(0.5);
  });

  it('approaches baseline for large elapsed time', () => {
    // After many hours, should be very close to baseline
    const result = applyEnergyDecay(0.85, 0.0, 10);
    expect(result).toBeCloseTo(0.0, 2);
  });

  it('stays at baseline when already there', () => {
    const result = applyEnergyDecay(0.85, 0.85, 2);
    expect(result).toBeCloseTo(0.85, 5);
  });
});

// ============================================================================
// isInSleepHours
// ============================================================================

describe('isInSleepHours', () => {
  function dateAtUTCHour(hour: number, minute: number = 0): Date {
    const d = new Date('2025-06-15T00:00:00Z');
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  }

  describe('midnight-crossing range (22:00-07:00)', () => {
    it('23:00 is in sleep hours', () => {
      expect(isInSleepHours(dateAtUTCHour(23), 22, 7, 'UTC')).toBe(true);
    });

    it('3:00 is in sleep hours', () => {
      expect(isInSleepHours(dateAtUTCHour(3), 22, 7, 'UTC')).toBe(true);
    });

    it('7:00 is NOT in sleep hours (wake time)', () => {
      expect(isInSleepHours(dateAtUTCHour(7), 22, 7, 'UTC')).toBe(false);
    });

    it('12:00 is NOT in sleep hours', () => {
      expect(isInSleepHours(dateAtUTCHour(12), 22, 7, 'UTC')).toBe(false);
    });

    it('22:00 IS in sleep hours (sleep start)', () => {
      expect(isInSleepHours(dateAtUTCHour(22), 22, 7, 'UTC')).toBe(true);
    });
  });

  describe('non-crossing range (1:00-6:00)', () => {
    it('3:00 is in sleep hours', () => {
      expect(isInSleepHours(dateAtUTCHour(3), 1, 6, 'UTC')).toBe(true);
    });

    it('8:00 is NOT in sleep hours', () => {
      expect(isInSleepHours(dateAtUTCHour(8), 1, 6, 'UTC')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false when sleepStart === sleepEnd', () => {
      expect(isInSleepHours(dateAtUTCHour(12), 22, 22, 'UTC')).toBe(false);
      expect(isInSleepHours(dateAtUTCHour(22), 22, 22, 'UTC')).toBe(false);
    });
  });
});

// ============================================================================
// formatEnergyContext
// ============================================================================

describe('formatEnergyContext', () => {
  it('includes band description for peak', () => {
    const ctx = formatEnergyContext(0.85, 'peak', 0.85, 300000);
    expect(ctx).toContain('YOUR ENERGY');
    expect(ctx).toContain('peak');
    expect(ctx).toContain('sharp and energized');
  });

  it('includes band description for alert', () => {
    const ctx = formatEnergyContext(0.55, 'alert', 0.85, 300000);
    expect(ctx).toContain('alert');
    expect(ctx).toContain('steady and present');
  });

  it('includes band description for sleeping', () => {
    const ctx = formatEnergyContext(0.02, 'sleeping', 0.0, 1800000);
    expect(ctx).toContain('deep in sleep');
  });

  it('is pure state — no instructional content', () => {
    const ctx = formatEnergyContext(0.55, 'alert', 0.85, 300000);
    // Delta guidance moved to system prompt
    expect(ctx).not.toContain('Delta magnitude');
    expect(ctx).not.toContain('energyDelta');
    expect(ctx).not.toContain('Provide');
  });

  it('includes wake-up context for natural wake', () => {
    const wakeUp: WakeUpContext = { type: 'natural', sleepDurationHours: 8.5 };
    const ctx = formatEnergyContext(0.15, 'drowsy', 0.1, 300000, wakeUp);
    expect(ctx).toContain('waking up');
    expect(ctx).toContain('8.5 hours');
    expect(ctx).toContain('still low but rising');
  });

  it('includes wake-up context for triggered wake', () => {
    const wakeUp: WakeUpContext = { type: 'triggered', triggerType: 'message', sleepDurationHours: 3.0 };
    const ctx = formatEnergyContext(0.10, 'drowsy', 0.0, 300000, wakeUp);
    expect(ctx).toContain('pulled from sleep');
    expect(ctx).toContain('3.0 hours');
    expect(ctx).toContain('message');
    expect(ctx).toContain('groggy');
  });

  it('excludes wake-up context when not provided', () => {
    const ctx = formatEnergyContext(0.55, 'alert', 0.85, 300000);
    expect(ctx).not.toContain('waking up');
    expect(ctx).not.toContain('pulled from sleep');
  });
});

// ============================================================================
// SLEEP_EMOTION_DECAY_MULTIPLIER
// ============================================================================

describe('SLEEP_EMOTION_DECAY_MULTIPLIER', () => {
  it('equals 3.0', () => {
    expect(SLEEP_EMOTION_DECAY_MULTIPLIER).toBe(3.0);
  });
});

// ============================================================================
// applyDecay with multiplier (emotion-engine integration)
// ============================================================================

describe('applyDecay with sleep multiplier', () => {
  function makeEmotion(name: string, intensity: number): EmotionState {
    return {
      emotion: name as EmotionState['emotion'],
      category: 'positive',
      intensity,
      baseline: 0.05,
      lastUpdatedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    };
  }

  it('decays faster with multiplier > 1', () => {
    const emotions = [makeEmotion('joy', 0.8)];
    const nowMs = Date.now();

    const normalDecay = applyDecay(emotions, nowMs, 1.0);
    const sleepDecay = applyDecay(emotions, nowMs, SLEEP_EMOTION_DECAY_MULTIPLIER);

    // Sleep decay should bring intensity closer to baseline (0.05) than normal
    expect(sleepDecay[0].intensity).toBeLessThan(normalDecay[0].intensity);
    // Both should be less than original
    expect(normalDecay[0].intensity).toBeLessThan(0.8);
    expect(sleepDecay[0].intensity).toBeLessThan(0.8);
  });

  it('normal decay (multiplier 1.0) matches original behavior', () => {
    const emotions = [makeEmotion('joy', 0.8)];
    const nowMs = Date.now();

    const withMultiplier = applyDecay(emotions, nowMs, 1.0);
    const withoutMultiplier = applyDecay(emotions, nowMs);

    expect(withMultiplier[0].intensity).toBeCloseTo(withoutMultiplier[0].intensity, 10);
  });
});
