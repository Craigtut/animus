import { describe, it, expect } from 'vitest';
import {
  parseDateHeader,
  formatRelativeTime,
  formatGap,
  annotateRelativeTime,
  insertGapMarkers,
  reverseObservationGroups,
  annotateObservations,
} from '../../../src/memory/observational-memory/temporal.js';

describe('temporal utilities', () => {
  // Fixed "now" for deterministic tests: Feb 14, 2026
  const now = new Date(2026, 1, 14); // Month is 0-indexed

  describe('parseDateHeader', () => {
    it('parses a standard date header', () => {
      const date = parseDateHeader('Date: Feb 10, 2026');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2026);
      expect(date!.getMonth()).toBe(1); // February
      expect(date!.getDate()).toBe(10);
    });

    it('parses a date header with existing annotation', () => {
      const date = parseDateHeader('Date: Feb 10, 2026 (4 days ago)');
      expect(date).not.toBeNull();
      expect(date!.getDate()).toBe(10);
    });

    it('returns null for non-date lines', () => {
      expect(parseDateHeader('* some observation')).toBeNull();
      expect(parseDateHeader('')).toBeNull();
      expect(parseDateHeader('[2 weeks earlier]')).toBeNull();
    });

    it('returns null for invalid date text', () => {
      expect(parseDateHeader('Date: not a real date')).toBeNull();
    });

    it('parses dates in different months', () => {
      const jan = parseDateHeader('Date: Jan 1, 2026');
      expect(jan).not.toBeNull();
      expect(jan!.getMonth()).toBe(0);

      const dec = parseDateHeader('Date: Dec 25, 2025');
      expect(dec).not.toBeNull();
      expect(dec!.getMonth()).toBe(11);
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "today" for same day', () => {
      expect(formatRelativeTime(now, now)).toBe('today');
    });

    it('returns "yesterday" for 1 day ago', () => {
      const yesterday = new Date(2026, 1, 13);
      expect(formatRelativeTime(yesterday, now)).toBe('yesterday');
    });

    it('returns "X days ago" for 2-13 days', () => {
      const fiveDaysAgo = new Date(2026, 1, 9);
      expect(formatRelativeTime(fiveDaysAgo, now)).toBe('5 days ago');
    });

    it('returns "X weeks ago" for 14-59 days', () => {
      const threeWeeksAgo = new Date(2026, 0, 24); // 21 days ago
      expect(formatRelativeTime(threeWeeksAgo, now)).toBe('3 weeks ago');
    });

    it('returns "1 week ago" for exactly 1 week', () => {
      // 7 days is still in "X days ago" range (< 14)
      const sevenDaysAgo = new Date(2026, 1, 7);
      expect(formatRelativeTime(sevenDaysAgo, now)).toBe('7 days ago');

      // 14 days is the start of weeks range
      const twoWeeksAgo = new Date(2026, 0, 31);
      expect(formatRelativeTime(twoWeeksAgo, now)).toBe('2 weeks ago');
    });

    it('returns "X months ago" for 60+ days', () => {
      const twoMonthsAgo = new Date(2025, 11, 14); // Dec 14, 2025 = ~62 days
      expect(formatRelativeTime(twoMonthsAgo, now)).toBe('2 months ago');
    });

    it('returns weeks for 30 days (still in weeks range)', () => {
      const thirtyDaysAgo = new Date(2026, 0, 15); // Jan 15 = 30 days ago
      expect(formatRelativeTime(thirtyDaysAgo, now)).toBe('4 weeks ago');
    });

    it('returns "1 month ago" for ~60 days', () => {
      const sixtyDaysAgo = new Date(2025, 11, 16); // Dec 16, 2025 = 60 days ago
      expect(formatRelativeTime(sixtyDaysAgo, now)).toBe('2 months ago');
    });
  });

  describe('formatGap', () => {
    // formatGap(newer, older) — used in reverse chronological display

    it('returns null for consecutive days', () => {
      const newer = new Date(2026, 1, 11);
      const older = new Date(2026, 1, 10);
      expect(formatGap(newer, older)).toBeNull();
    });

    it('returns null for same day', () => {
      const day = new Date(2026, 1, 10);
      expect(formatGap(day, day)).toBeNull();
    });

    it('returns days gap for 2-13 days', () => {
      const newer = new Date(2026, 1, 10);
      const older = new Date(2026, 1, 5);
      expect(formatGap(newer, older)).toBe('[5 days earlier]');
    });

    it('returns weeks gap for 14-59 days', () => {
      const newer = new Date(2026, 1, 12);
      const older = new Date(2026, 0, 15);
      expect(formatGap(newer, older)).toBe('[4 weeks earlier]');
    });

    it('returns months gap for 60+ days', () => {
      const newer = new Date(2026, 1, 10);
      const older = new Date(2025, 11, 1);
      // ~71 days
      expect(formatGap(newer, older)).toBe('[2 months earlier]');
    });
  });

  describe('annotateRelativeTime', () => {
    it('adds relative time to date headers', () => {
      const input = `Date: Feb 10, 2026
* some observation
Date: Feb 14, 2026
* another observation`;

      const result = annotateRelativeTime(input, now);
      expect(result).toContain('Date: Feb 10, 2026 (4 days ago)');
      expect(result).toContain('Date: Feb 14, 2026 (today)');
      expect(result).toContain('* some observation');
    });

    it('replaces existing annotations', () => {
      const input = 'Date: Feb 10, 2026 (old annotation)';
      const result = annotateRelativeTime(input, now);
      expect(result).toBe('Date: Feb 10, 2026 (4 days ago)');
    });

    it('leaves non-date lines unchanged', () => {
      const input = '* observation text\n[gap marker]';
      const result = annotateRelativeTime(input, now);
      expect(result).toBe(input);
    });
  });

  describe('reverseObservationGroups', () => {
    it('reverses date groups to newest-first', () => {
      const input = `Date: Jan 15, 2026
* old observation
Date: Feb 14, 2026
* new observation`;

      const result = reverseObservationGroups(input);
      const lines = result.split('\n');
      // First date group should be Feb 14 (newest)
      expect(lines[0]).toBe('Date: Feb 14, 2026');
      // Jan 15 should come after
      expect(result).toContain('Date: Jan 15, 2026');
      expect(result.indexOf('Feb 14')).toBeLessThan(result.indexOf('Jan 15'));
    });

    it('handles single date group', () => {
      const input = `Date: Feb 14, 2026
* observation`;

      const result = reverseObservationGroups(input);
      expect(result).toContain('Date: Feb 14, 2026');
      expect(result).toContain('* observation');
    });

    it('handles empty input', () => {
      expect(reverseObservationGroups('')).toBe('');
    });

    it('handles three date groups', () => {
      const input = `Date: Jan 1, 2026
* obs 1
Date: Jan 15, 2026
* obs 2
Date: Feb 14, 2026
* obs 3`;

      const result = reverseObservationGroups(input);
      expect(result.indexOf('Feb 14')).toBeLessThan(result.indexOf('Jan 15'));
      expect(result.indexOf('Jan 15')).toBeLessThan(result.indexOf('Jan 1,'));
    });
  });

  describe('insertGapMarkers', () => {
    it('inserts gap markers between non-consecutive dates (reverse order)', () => {
      // In reverse chronological order: newest first
      const input = `Date: Feb 10, 2026
* observation 2
Date: Jan 15, 2026
* observation 1`;

      const result = insertGapMarkers(input);
      expect(result).toContain('[4 weeks earlier]');
    });

    it('does not insert markers for consecutive dates', () => {
      const input = `Date: Feb 14, 2026
* observation 2
Date: Feb 13, 2026
* observation 1`;

      const result = insertGapMarkers(input);
      expect(result).not.toContain('[');
    });

    it('handles multiple gaps', () => {
      // Reverse chronological order
      const input = `Date: Feb 10, 2026
* obs 3
Date: Jan 15, 2026
* obs 2
Date: Jan 1, 2026
* obs 1`;

      const result = insertGapMarkers(input);
      // Gap between Feb 10 and Jan 15 = 26 days = ~4 weeks
      expect(result).toContain('[4 weeks earlier]');
      // Gap between Jan 15 and Jan 1 = 14 days = 2 weeks
      expect(result).toContain('[2 weeks earlier]');
    });

    it('handles empty input', () => {
      expect(insertGapMarkers('')).toBe('');
    });
  });

  describe('annotateObservations', () => {
    it('applies all transformations: reverse, gaps, relative time', () => {
      // Input stored chronologically (oldest first)
      const input = `Date: Jan 15, 2026
* 🔴 (10:00) User set up their account
Date: Feb 14, 2026
* 🟡 (09:00) User returned`;

      const result = annotateObservations(input, now);

      // Should be reversed: newest first
      expect(result.indexOf('Feb 14')).toBeLessThan(result.indexOf('Jan 15'));

      // Should have relative time annotations
      expect(result).toContain('(4 weeks ago)');
      expect(result).toContain('(today)');

      // Should have gap marker (in reverse order, "earlier")
      expect(result).toContain('[4 weeks earlier]');

      // Should preserve observation content
      expect(result).toContain('User set up their account');
      expect(result).toContain('User returned');
    });

    it('handles observations with no date headers', () => {
      const input = 'Just some text with no dates';
      const result = annotateObservations(input, now);
      expect(result).toBe(input);
    });

    it('handles single date group', () => {
      const input = `Date: Feb 14, 2026
* 🔴 (09:00) Something happened`;

      const result = annotateObservations(input, now);
      expect(result).toContain('Date: Feb 14, 2026 (today)');
      expect(result).not.toContain('[');
    });

    it('matches expected reverse-chronological output', () => {
      // Input stored chronologically (oldest first)
      const input = `Date: Jan 15, 2026
* 🔴 (10:00) User set up their account, prefers dark mode
Date: Jan 30, 2026
* 🟡 (14:00) User asked about export features
Date: Feb 14, 2026
* 🟡 (09:00) User returned, asked about new features since last visit`;

      const result = annotateObservations(input, now);

      // Newest first
      expect(result).toContain('Date: Feb 14, 2026 (today)');
      expect(result).toContain('Date: Jan 30, 2026 (2 weeks ago)');
      expect(result).toContain('Date: Jan 15, 2026 (4 weeks ago)');

      // Gaps say "earlier" (reverse direction)
      expect(result).toContain('[2 weeks earlier]');
      expect(result).toContain('[2 weeks earlier]');

      // Order: Feb 14 → Jan 30 → Jan 15
      expect(result.indexOf('Feb 14')).toBeLessThan(result.indexOf('Jan 30'));
      expect(result.indexOf('Jan 30')).toBeLessThan(result.indexOf('Jan 15'));
    });
  });
});
