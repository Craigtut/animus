/**
 * Temporal annotation utilities for observational memory.
 *
 * Adds relative time annotations ("4 days ago") to date headers and
 * gap markers ("[2 weeks earlier]") between non-consecutive date groups.
 * Observations are displayed newest-first (reverse chronological).
 * Applied at context injection time, not by the Observer.
 *
 * See docs/architecture/observational-memory.md — Context Presentation / Temporal Annotations.
 */

/**
 * Parse a date from an observation header line.
 * Expected format: "Date: Feb 10, 2026" or "Date: Jan 1, 2026"
 * Returns null if the line doesn't match.
 */
export function parseDateHeader(line: string): Date | null {
  const match = line.match(/^Date:\s+(.+)$/);
  if (!match) return null;

  const dateStr = match[1]!.trim();
  // Remove any existing relative time annotation like "(4 days ago)"
  const cleaned = dateStr.replace(/\s*\(.*\)\s*$/, '');
  const parsed = new Date(cleaned);

  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Format a relative time string between a date and "now".
 * Returns: "today", "yesterday", "X days ago", "X weeks ago", "X months ago"
 */
export function formatRelativeTime(date: Date, now: Date): string {
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = startOfNow.getTime() - startOfDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 14) return `${diffDays} days ago`;
  if (diffDays < 60) {
    const weeks = Math.round(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  const months = Math.round(diffDays / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

/**
 * Format a gap marker between two dates (displayed newest → oldest).
 * Returns null if dates are consecutive (within 1 day).
 * Otherwise returns "[X days earlier]", "[X weeks earlier]", "[X months earlier]"
 */
export function formatGap(newer: Date, older: Date): string | null {
  const startOfNewer = new Date(newer.getFullYear(), newer.getMonth(), newer.getDate());
  const startOfOlder = new Date(older.getFullYear(), older.getMonth(), older.getDate());
  const diffMs = startOfNewer.getTime() - startOfOlder.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) return null;

  if (diffDays < 14) return `[${diffDays} days earlier]`;
  if (diffDays < 60) {
    const weeks = Math.round(diffDays / 7);
    return weeks === 1 ? '[1 week earlier]' : `[${weeks} weeks earlier]`;
  }
  const months = Math.round(diffDays / 30);
  return months === 1 ? '[1 month earlier]' : `[${months} months earlier]`;
}

/**
 * Add relative time annotations to date headers in observation text.
 * "Date: Feb 10, 2026" becomes "Date: Feb 10, 2026 (4 days ago)"
 */
export function annotateRelativeTime(observations: string, currentDate?: Date): string {
  const now = currentDate ?? new Date();
  const lines = observations.split('\n');

  return lines.map(line => {
    const date = parseDateHeader(line);
    if (!date) return line;

    const relative = formatRelativeTime(date, now);
    // Strip existing annotation if present, then add new one
    const cleanLine = line.replace(/\s*\(.*\)\s*$/, '');
    return `${cleanLine} (${relative})`;
  }).join('\n');
}

/**
 * Merge observation entries sharing the same date into a single group,
 * and sort entries within each group by timestamp (newest first).
 *
 * Multiple observer batches on the same day each produce their own "Date:"
 * header. This function consolidates them into one group per calendar date
 * with entries sorted by their (HH:MM) timestamp descending.
 */
export function mergeSameDateGroups(observations: string): string {
  if (!observations.trim()) return observations;

  const lines = observations.split('\n');

  // Map from clean date header → { date, entries[] }
  // An "entry" is a top-level bullet plus any sub-bullets underneath it.
  const dateGroups = new Map<string, { date: Date; entries: { timestamp: string; lines: string[] }[] }>();
  const dateOrder: string[] = []; // preserve chronological order of first appearance
  let currentDateKey: string | null = null;

  for (const line of lines) {
    const date = parseDateHeader(line);
    if (date) {
      const cleanHeader = line.replace(/\s*\(.*\)\s*$/, '');
      currentDateKey = cleanHeader;
      if (!dateGroups.has(cleanHeader)) {
        dateGroups.set(cleanHeader, { date, entries: [] });
        dateOrder.push(cleanHeader);
      }
      continue;
    }

    if (!currentDateKey) continue;
    const group = dateGroups.get(currentDateKey)!;

    if (/^\*\s+/.test(line)) {
      // Top-level bullet — start a new entry, extract (HH:MM) timestamp
      const timeMatch = line.match(/\((\d{2}:\d{2})\)/);
      group.entries.push({
        timestamp: timeMatch ? timeMatch[1]! : '00:00',
        lines: [line],
      });
    } else if (/^\s+\*/.test(line) && group.entries.length > 0) {
      // Sub-bullet — attach to current entry
      group.entries[group.entries.length - 1]!.lines.push(line);
    }
    // Skip empty lines between groups (they get re-added when we rejoin)
  }

  if (dateGroups.size === 0) return observations;

  // Build output: one date header per unique date, entries sorted newest-first
  const result: string[] = [];
  for (const key of dateOrder) {
    const group = dateGroups.get(key)!;
    if (result.length > 0) result.push('');
    result.push(key);

    // Sort entries by timestamp descending (newest first)
    group.entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    for (const entry of group.entries) {
      result.push(...entry.lines);
    }
  }

  return result.join('\n');
}

/**
 * Reverse the order of date groups in observation text.
 * Observations are stored chronologically (oldest first) by the observer,
 * but displayed newest-first for the mind's context.
 *
 * A "date group" starts with a "Date:" header and includes all lines
 * until the next "Date:" header or end of text.
 */
export function reverseObservationGroups(observations: string): string {
  const lines = observations.split('\n');
  const groups: string[][] = [];
  let currentGroup: string[] = [];

  for (const line of lines) {
    if (parseDateHeader(line) !== null && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(line);
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Reverse and rejoin, trimming trailing empty lines from each group
  return groups.reverse()
    .map(g => g.join('\n').trimEnd())
    .join('\n\n');
}

/**
 * Insert gap markers between non-consecutive date groups in observation text.
 * Groups are expected in reverse chronological order (newest first).
 * Adds "[2 weeks earlier]" between date headers that aren't consecutive.
 */
export function insertGapMarkers(observations: string): string {
  const lines = observations.split('\n');
  const result: string[] = [];
  let lastDate: Date | null = null;

  for (const line of lines) {
    const date = parseDateHeader(line);
    if (date && lastDate) {
      // In reverse order, lastDate is newer, date is older
      const gap = formatGap(lastDate, date);
      if (gap) {
        result.push('');
        result.push(gap);
        result.push('');
      }
    }
    if (date) {
      lastDate = date;
    }
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Apply all temporal transformations:
 * 1. Merge duplicate date groups (from multiple observer batches)
 * 2. Reverse date group order (newest first)
 * 3. Insert gap markers between non-consecutive dates
 * 4. Annotate date headers with relative time
 *
 * This is the main entry point used by the context builder.
 */
export function annotateObservations(observations: string, currentDate?: Date): string {
  const merged = mergeSameDateGroups(observations);
  const reversed = reverseObservationGroups(merged);
  const withGaps = insertGapMarkers(reversed);
  return annotateRelativeTime(withGaps, currentDate);
}
