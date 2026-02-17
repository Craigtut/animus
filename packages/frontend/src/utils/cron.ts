/**
 * Cron Utilities — parsing, generating, humanizing, and next-occurrence computation
 * for 5-field standard cron expressions.
 */

// ============================================================================
// Types
// ============================================================================

export type Frequency = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface CronVisualState {
  frequency: Frequency;
  minuteInterval: number;       // 1-59
  hourInterval: number;         // 1-23
  minuteOffset: number;         // 0-59 (which minute of the hour for hourly)
  time: { hour: number; minute: number }; // 24h format
  weekdays: boolean[];          // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  monthDays: number[];          // 1-31
  months: number[];             // 1-12, empty = all
}

// ============================================================================
// Constants
// ============================================================================

const FULL_DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ============================================================================
// Default State
// ============================================================================

export function defaultVisualState(): CronVisualState {
  return {
    frequency: 'daily',
    minuteInterval: 15,
    hourInterval: 2,
    minuteOffset: 0,
    time: { hour: 9, minute: 0 },
    weekdays: [false, true, true, true, true, true, false], // weekdays
    monthDays: [1],
    months: [],
  };
}

// ============================================================================
// Generate Cron from Visual State
// ============================================================================

export function generateCron(state: CronVisualState): string {
  const monthField = state.months.length > 0 ? compressNumbers(state.months) : '*';

  switch (state.frequency) {
    case 'minutes':
      return `*/${state.minuteInterval} * * ${monthField} *`;

    case 'hourly':
      return `${state.minuteOffset} */${state.hourInterval} * ${monthField} *`;

    case 'daily':
      return `${state.time.minute} ${state.time.hour} * ${monthField} *`;

    case 'weekly': {
      const selectedDays = state.weekdays
        .map((on, i) => on ? i : -1)
        .filter(i => i >= 0);
      const dayField = selectedDays.length === 7 ? '*' : compressNumbers(selectedDays);
      return `${state.time.minute} ${state.time.hour} * ${monthField} ${dayField}`;
    }

    case 'monthly': {
      const dayField = compressNumbers([...state.monthDays].sort((a, b) => a - b));
      return `${state.time.minute} ${state.time.hour} ${dayField} ${monthField} *`;
    }
  }
}

/**
 * Compress sorted numbers into ranges: [1,2,3,5] → "1-3,5"
 */
function compressNumbers(nums: number[]): string {
  if (nums.length === 0) return '*';
  if (nums.length === 1) return String(nums[0]);

  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = start;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i]!;
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = sorted[i]!;
      end = start;
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(',');
}

// ============================================================================
// Parse Cron to Visual State
// ============================================================================

/**
 * Attempt to parse a cron expression into visual editor state.
 * Returns null if the expression can't be represented visually.
 */
export function parseCronToVisualState(cron: string): CronVisualState | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  const base = defaultVisualState();

  // Parse month filter
  if (month !== '*') {
    const months = parseField(month, 1, 12);
    if (!months) return null;
    base.months = months;
  }

  const isInterval = (s: string) => s.startsWith('*/');
  const intervalVal = (s: string) => parseInt(s.slice(2), 10);

  // Pattern: */N * * M *  →  every N minutes
  if (isInterval(minute) && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    const n = intervalVal(minute);
    if (isNaN(n) || n < 1 || n > 59) return null;
    base.frequency = 'minutes';
    base.minuteInterval = n;
    return base;
  }

  // Pattern: M */N * M *  →  every N hours at :M
  if (!isInterval(minute) && isInterval(hour) && dayOfMonth === '*' && dayOfWeek === '*') {
    const m = parseInt(minute, 10);
    const n = intervalVal(hour);
    if (isNaN(m) || isNaN(n) || m < 0 || m > 59 || n < 1 || n > 23) return null;
    base.frequency = 'hourly';
    base.hourInterval = n;
    base.minuteOffset = m;
    return base;
  }

  // Need specific minute and hour for daily/weekly/monthly
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);
  if (isNaN(m) || isNaN(h) || m < 0 || m > 59 || h < 0 || h > 23) return null;
  if (isInterval(minute) || isInterval(hour)) return null;

  base.time = { hour: h, minute: m };

  // Pattern: M H * M D  →  weekly
  if (dayOfMonth === '*' && dayOfWeek !== '*') {
    const days = parseField(dayOfWeek, 0, 6);
    if (!days) return null;
    base.frequency = 'weekly';
    base.weekdays = [false, false, false, false, false, false, false];
    for (const d of days) {
      base.weekdays[d] = true;
    }
    return base;
  }

  // Pattern: M H D M *  →  monthly
  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    const days = parseField(dayOfMonth, 1, 31);
    if (!days) return null;
    base.frequency = 'monthly';
    base.monthDays = days.sort((a, b) => a - b);
    return base;
  }

  // Pattern: M H * M *  →  daily
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    base.frequency = 'daily';
    return base;
  }

  // Simultaneous day-of-month and day-of-week — not representable
  return null;
}

/**
 * Parse a cron field into individual numbers.
 * Supports: single values, comma-separated lists, ranges (a-b).
 * Does NOT support step patterns on ranges (e.g. 1-10/2).
 */
function parseField(field: string, min: number, max: number): number[] | null {
  if (field === '*') return null;

  // Reject step patterns on ranges
  if (field.includes('/')) return null;

  const result: number[] = [];
  const segments = field.split(',');

  for (const seg of segments) {
    if (seg.includes('-')) {
      const [startStr, endStr] = seg.split('-');
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) return null;
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const n = parseInt(seg, 10);
      if (isNaN(n) || n < min || n > max) return null;
      result.push(n);
    }
  }

  return result.length > 0 ? [...new Set(result)].sort((a, b) => a - b) : null;
}

// ============================================================================
// Humanize Cron
// ============================================================================

function formatTime12h(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  const last = n % 10;
  if (last === 1) return 'st';
  if (last === 2) return 'nd';
  if (last === 3) return 'rd';
  return 'th';
}

/**
 * Convert a cron expression to human-readable text.
 */
export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];

  const isInterval = (s: string) => s.startsWith('*/');
  const intervalVal = (s: string) => parseInt(s.slice(2), 10);

  // Month suffix
  let monthSuffix = '';
  if (month !== '*') {
    const months = parseField(month, 1, 12);
    if (months && months.length < 12) {
      monthSuffix = ` (${months.map(m => MONTH_ABBR[m - 1]).join(', ')} only)`;
    }
  }

  // Every minute
  if (cron.trim() === '* * * * *') return 'Every minute' + monthSuffix;

  // Every hour at :MM
  if (minute !== '*' && !isInterval(minute) && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}` + monthSuffix;
  }

  // Interval minutes: */N * * * *
  if (isInterval(minute) && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    const n = intervalVal(minute);
    return (n === 1 ? 'Every minute' : `Every ${n} minutes`) + monthSuffix;
  }

  // Interval hours: M */N * * *
  if (isInterval(hour) && dayOfMonth === '*' && dayOfWeek === '*') {
    const n = intervalVal(hour);
    const m = parseInt(minute, 10);
    const base = n === 1 ? 'Every hour' : `Every ${n} hours`;
    if (!isNaN(m) && m > 0) {
      return `${base} at :${m.toString().padStart(2, '0')}` + monthSuffix;
    }
    return base + monthSuffix;
  }

  // Need specific time for remaining patterns
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (isNaN(h) || isNaN(m) || isInterval(hour) || isInterval(minute)) {
    return cron;
  }
  const timeStr = formatTime12h(h, m);

  // Daily
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    return `Daily at ${timeStr}` + monthSuffix;
  }

  // Weekly
  if (dayOfMonth === '*' && dayOfWeek !== '*') {
    const days = parseField(dayOfWeek, 0, 6);
    if (days) {
      if (days.length === 5 && days.every((d, i) => d === i + 1)) {
        return `Weekdays at ${timeStr}` + monthSuffix;
      }
      if (days.length === 7) {
        return `Daily at ${timeStr}` + monthSuffix;
      }
      const dayNames = days.map(d => FULL_DAY_NAMES[d] ?? String(d));
      return `${dayNames.join(', ')} at ${timeStr}` + monthSuffix;
    }
  }

  // Monthly
  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    const days = parseField(dayOfMonth, 1, 31);
    if (days) {
      const dayStrs = days.map(d => `${d}${ordinalSuffix(d)}`);
      if (dayStrs.length === 1) {
        return `${dayStrs[0]} of each month at ${timeStr}` + monthSuffix;
      }
      const last = dayStrs.pop();
      return `${dayStrs.join(', ')} and ${last} of each month at ${timeStr}` + monthSuffix;
    }
  }

  // Fallback
  if (timeStr) return `${timeStr} (${cron})`;
  return cron;
}

// ============================================================================
// Next Occurrence (for interval-based schedules)
// ============================================================================

/**
 * Compute the next occurrence for interval-based cron expressions.
 * Returns null for non-interval (specific-time) schedules.
 */
export function computeNextOccurrence(cron: string): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour] = parts as [string, string, string, string, string];
  const isInterval = (s: string) => s.startsWith('*/');

  const now = new Date();

  // Every N minutes: */N * * * *
  if (isInterval(minute) && hour === '*') {
    const n = parseInt(minute.slice(2), 10);
    if (isNaN(n) || n < 1) return null;
    const currentMinute = now.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / n) * n;
    const next = new Date(now);
    next.setSeconds(0, 0);
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(nextMinute % 60);
    } else {
      next.setMinutes(nextMinute);
    }
    return next;
  }

  // Every N hours: M */N * * *
  if (!isInterval(minute) && isInterval(hour)) {
    const m = parseInt(minute, 10);
    const n = parseInt(hour.slice(2), 10);
    if (isNaN(m) || isNaN(n) || n < 1) return null;

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    // Find the next hour that's divisible by N
    let nextHour = Math.ceil((currentHour * 60 + currentMinute + 1 - m) / (n * 60)) * n;
    // Convert back: we want the next hour divisible by n where we haven't passed minute m
    nextHour = currentHour - (currentHour % n); // current slot start
    const slotTime = new Date(now);
    slotTime.setHours(nextHour, m, 0, 0);
    if (slotTime <= now) {
      nextHour += n;
    }

    const next = new Date(now);
    next.setSeconds(0, 0);
    if (nextHour >= 24) {
      next.setDate(next.getDate() + 1);
      next.setHours(nextHour % 24, m);
    } else {
      next.setHours(nextHour, m);
    }
    return next;
  }

  return null;
}

/**
 * Format a next occurrence date relative to now.
 */
export function formatNextOccurrence(date: Date): string {
  const now = new Date();
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) {
    return `${timeStr} today`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) {
    return `${timeStr} tomorrow`;
  }

  const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
  return `${dayName} at ${timeStr}`;
}
