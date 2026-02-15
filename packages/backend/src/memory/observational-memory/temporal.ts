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
 * Apply all temporal transformations: reverse order, gap markers, relative time annotations.
 * This is the main entry point used by the context builder.
 */
export function annotateObservations(observations: string, currentDate?: Date): string {
  const reversed = reverseObservationGroups(observations);
  const withGaps = insertGapMarkers(reversed);
  return annotateRelativeTime(withGaps, currentDate);
}
