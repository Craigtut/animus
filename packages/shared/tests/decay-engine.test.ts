import { describe, it, expect } from 'vitest';
import { compute, computeRetention, shouldPrune, hoursSince } from '../src/decay-engine.js';

describe('DecayEngine', () => {
  describe('compute', () => {
    it('returns baseline when elapsed is very large', () => {
      const result = compute(1.0, 0.3, 0.1, 10000);
      expect(result).toBeCloseTo(0.3, 5);
    });

    it('returns current when elapsed is zero', () => {
      const result = compute(0.8, 0.3, 0.1, 0);
      expect(result).toBeCloseTo(0.8, 5);
    });

    it('decays toward baseline over time', () => {
      const t1 = compute(1.0, 0.0, 0.1, 1);
      const t10 = compute(1.0, 0.0, 0.1, 10);
      expect(t1).toBeGreaterThan(t10);
      expect(t10).toBeGreaterThan(0);
    });

    it('handles current below baseline', () => {
      const result = compute(0.1, 0.5, 0.1, 5);
      // Should move toward baseline (0.5), so result > 0.1
      expect(result).toBeGreaterThan(0.1);
      expect(result).toBeLessThanOrEqual(0.5);
    });
  });

  describe('computeRetention', () => {
    it('returns 1 when elapsed is zero', () => {
      expect(computeRetention(1, 0)).toBeCloseTo(1, 5);
    });

    it('decays over time', () => {
      const r1 = computeRetention(1, 100);
      const r2 = computeRetention(1, 1000);
      expect(r1).toBeGreaterThan(r2);
    });

    it('higher strength means slower decay', () => {
      const lowStrength = computeRetention(1, 500);
      const highStrength = computeRetention(5, 500);
      expect(highStrength).toBeGreaterThan(lowStrength);
    });
  });

  describe('shouldPrune', () => {
    it('prunes low retention + low importance', () => {
      expect(shouldPrune(0.05, 0.1)).toBe(true);
    });

    it('does not prune if retention above threshold', () => {
      expect(shouldPrune(0.2, 0.1)).toBe(false);
    });

    it('does not prune if importance above threshold', () => {
      expect(shouldPrune(0.05, 0.5)).toBe(false);
    });

    it('does not prune if both above threshold', () => {
      expect(shouldPrune(0.5, 0.5)).toBe(false);
    });
  });

  describe('hoursSince', () => {
    it('returns positive hours for past timestamp', () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      const hours = hoursSince(past);
      expect(hours).toBeCloseTo(1, 0);
    });

    it('returns near zero for recent timestamp', () => {
      const recent = new Date().toISOString();
      const hours = hoursSince(recent);
      expect(hours).toBeLessThan(0.01);
    });
  });
});
