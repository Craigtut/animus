import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateCronExpression, computeNextRunAt } from '../../src/tasks/task-scheduler.js';

// Mock getSystemDb to avoid DB initialization
vi.mock('../../src/db/index.js', () => ({
  getHeartbeatDb: vi.fn(),
  getSystemDb: vi.fn(),
}));

vi.mock('../../src/db/stores/system-store.js', () => ({
  getSystemSettings: vi.fn(() => ({ timezone: 'UTC' })),
}));

describe('task-scheduler', () => {
  describe('validateCronExpression', () => {
    it('validates a correct cron expression', () => {
      const result = validateCronExpression('0 9 * * *', 'UTC');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.nextRuns).toHaveLength(3);
        // Each next run should be a valid ISO date
        for (const run of result.nextRuns) {
          expect(new Date(run).getTime()).toBeGreaterThan(0);
        }
      }
    });

    it('validates a complex cron expression', () => {
      const result = validateCronExpression('0 8 * * 1-5', 'UTC'); // Weekdays at 8am
      expect(result.valid).toBe(true);
    });

    it('rejects an invalid cron expression', () => {
      const result = validateCronExpression('not a cron', 'UTC');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });

    it('rejects empty string', () => {
      const result = validateCronExpression('', 'UTC');
      expect(result.valid).toBe(false);
    });
  });

  describe('computeNextRunAt', () => {
    it('computes next run for a valid cron expression', () => {
      const nextRun = computeNextRunAt('0 12 * * *', 'UTC');
      expect(nextRun).not.toBeNull();
      if (nextRun) {
        const date = new Date(nextRun);
        expect(date.getUTCHours()).toBe(12);
        expect(date.getUTCMinutes()).toBe(0);
      }
    });

    it('returns null for invalid cron expression', () => {
      const nextRun = computeNextRunAt('invalid', 'UTC');
      expect(nextRun).toBeNull();
    });

    it('next run is in the future', () => {
      const nextRun = computeNextRunAt('* * * * *', 'UTC'); // Every minute
      expect(nextRun).not.toBeNull();
      if (nextRun) {
        expect(new Date(nextRun).getTime()).toBeGreaterThan(Date.now());
      }
    });
  });
});
