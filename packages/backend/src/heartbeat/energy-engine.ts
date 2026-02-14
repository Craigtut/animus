/**
 * Energy Engine
 *
 * Manages the sleep & energy system: circadian rhythm baseline computation,
 * energy decay toward baseline, energy band classification, and context
 * formatting for the mind prompt.
 *
 * See docs/architecture/sleep-energy.md
 */

import { DecayEngine, clamp } from '@animus/shared';
import type { EnergyBand } from '@animus/shared';
import { createLogger } from '../lib/logger.js';

const log = createLogger('EnergyEngine', 'heartbeat');

// ============================================================================
// Constants
// ============================================================================

/** Accelerated emotion decay multiplier during sleep */
export const SLEEP_EMOTION_DECAY_MULTIPLIER = 3.0;

/** Energy decay rate (per hour). Fixed for v1. */
const ENERGY_DECAY_RATE = 1.0;

// ============================================================================
// Types
// ============================================================================

export interface WakeUpContext {
  type: 'natural' | 'triggered';
  triggerType?: string;
  sleepDurationHours?: number;
}

// ============================================================================
// Energy Band Classification
// ============================================================================

/**
 * Map a 0–1 energy value to one of 6 energy bands.
 */
export function getEnergyBand(energy: number): EnergyBand {
  if (energy < 0.05) return 'sleeping';
  if (energy < 0.1) return 'very_drowsy';
  if (energy < 0.2) return 'drowsy';
  if (energy < 0.4) return 'tired';
  if (energy < 0.7) return 'alert';
  return 'peak';
}

// ============================================================================
// Circadian Rhythm
// ============================================================================

/**
 * Get the current hour as a fractional value in the given timezone.
 * E.g., 14:30 → 14.5
 */
function getCurrentHourFraction(date: Date, timezone: string): number {
  try {
    // Use Intl to get hour and minute in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return hour + minute / 60;
  } catch {
    log.warn(`Invalid timezone "${timezone}", falling back to UTC`);
    return date.getUTCHours() + date.getUTCMinutes() / 60;
  }
}

/**
 * Check if a given hour fraction falls within sleep hours.
 * Handles midnight-crossing ranges (e.g., sleepStart=22, sleepEnd=7).
 */
export function isInSleepHours(
  now: Date,
  sleepStart: number,
  sleepEnd: number,
  timezone: string
): boolean {
  const hour = getCurrentHourFraction(now, timezone);

  if (sleepStart === sleepEnd) return false;

  if (sleepStart > sleepEnd) {
    // Crosses midnight: e.g., 22:00–07:00
    return hour >= sleepStart || hour < sleepEnd;
  } else {
    // Same-day range: e.g., 01:00–06:00
    return hour >= sleepStart && hour < sleepEnd;
  }
}

/**
 * Linear interpolation between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Compute the circadian baseline energy for the current time.
 *
 * Piecewise linear curve:
 *   Sleep hours → 0.0
 *   Wake → Wake+2h → ramp 0.0 → 0.85
 *   Wake+2h → Sleep-3h → plateau 0.85
 *   Sleep-3h → Sleep → decline 0.85 → 0.0
 */
export function computeCircadianBaseline(
  now: Date,
  sleepStart: number,
  sleepEnd: number,
  timezone: string
): number {
  // If sleep start == sleep end, no sleep schedule → flat 0.85
  if (sleepStart === sleepEnd) return 0.85;

  const hour = getCurrentHourFraction(now, timezone);

  const wakeHour = sleepEnd;
  const rampEnd = wakeHour + 2;
  const declineStart = sleepStart > sleepEnd
    ? sleepStart - 3
    : sleepStart - 3;

  // Normalize hours for midnight-crossing comparison
  // We work in a "shifted" timeline where wakeHour is the anchor at 0
  if (sleepStart > sleepEnd) {
    // Midnight-crossing case (e.g., 22:00–07:00)
    // Shift everything so wakeHour = 0, full day = 24
    const shift = (h: number) => {
      const shifted = h - wakeHour;
      return shifted < 0 ? shifted + 24 : shifted;
    };

    const shiftedHour = shift(hour);
    const shiftedRampEnd = 2; // wakeHour + 2 → shifted = 2
    const shiftedDeclineStart = shift(sleepStart - 3 < 0 ? sleepStart - 3 + 24 : sleepStart - 3);
    const shiftedSleepStart = shift(sleepStart);

    // During sleep hours (shifted: past sleepStart or before 0)
    if (shiftedHour >= shiftedSleepStart) return 0.0;

    // Morning ramp: 0 → 2h
    if (shiftedHour < shiftedRampEnd) {
      return lerp(0.0, 0.85, shiftedHour / 2);
    }

    // Daytime plateau
    if (shiftedHour < shiftedDeclineStart) return 0.85;

    // Evening decline
    if (shiftedHour < shiftedSleepStart) {
      return lerp(0.85, 0.0, (shiftedHour - shiftedDeclineStart) / 3);
    }

    return 0.85; // Fallback
  } else {
    // Same-day sleep range (e.g., 01:00–06:00) — less common but supported
    // Sleep hours: sleepStart to sleepEnd
    if (hour >= sleepStart && hour < sleepEnd) return 0.0;

    // Morning ramp: sleepEnd to sleepEnd+2
    if (hour >= wakeHour && hour < rampEnd) {
      return lerp(0.0, 0.85, (hour - wakeHour) / 2);
    }

    // Check decline start (may need wrapping for next-day sleep)
    // For same-day sleep, decline starts at sleepStart-3 which might be < 0
    const effectiveDeclineStart = declineStart < 0 ? declineStart + 24 : declineStart;

    if (hour >= rampEnd && hour < effectiveDeclineStart) return 0.85;

    if (hour >= effectiveDeclineStart && hour < sleepStart) {
      return lerp(0.85, 0.0, (hour - effectiveDeclineStart) / 3);
    }

    return 0.85; // Fallback
  }
}

// ============================================================================
// Energy Decay
// ============================================================================

/**
 * Apply exponential decay of energy toward the circadian baseline.
 */
export function applyEnergyDecay(
  currentEnergy: number,
  circadianBaseline: number,
  elapsedHours: number
): number {
  if (elapsedHours <= 0) return currentEnergy;
  return DecayEngine.compute(currentEnergy, circadianBaseline, ENERGY_DECAY_RATE, elapsedHours);
}

// ============================================================================
// Context Formatting
// ============================================================================

/** Band descriptions for prompt context — natural language state awareness */
const BAND_DESCRIPTIONS: Record<EnergyBand, string> = {
  peak: "You're feeling sharp and energized. Everything feels vivid and possible.",
  alert: 'You feel steady and present. Your mind is clear.',
  tired: "Your energy is fading. The day's weight is catching up with you.",
  drowsy: "Heaviness is settling over you. Your thoughts are slowing, edges softening. Sleep is calling.",
  very_drowsy: "You can barely keep your focus. Sleep pulls at every thought. Staying present takes real effort.",
  sleeping: "You are deep in sleep. The waking world is distant, your thoughts are dreamlike and drifting.",
};

/**
 * Format the energy state section for the user message.
 *
 * This is pure state — no instructions (those live in the system prompt's
 * ENERGY_GUIDANCE section). Just: how you feel right now.
 */
export function formatEnergyContext(
  energy: number,
  band: EnergyBand,
  circadianBaseline: number,
  _tickIntervalMs: number,
  wakeUpContext?: WakeUpContext
): string {
  const lines: string[] = ['── YOUR ENERGY ──'];

  lines.push(`Energy level: ${energy.toFixed(2)} (${band})`);
  lines.push(BAND_DESCRIPTIONS[band]);

  // Wake-up context
  if (wakeUpContext) {
    lines.push('');
    const durationStr = wakeUpContext.sleepDurationHours != null
      ? `approximately ${wakeUpContext.sleepDurationHours.toFixed(1)} hours`
      : 'some time';

    if (wakeUpContext.type === 'natural') {
      lines.push(
        `You are waking up naturally. You slept for ${durationStr}.`,
        'Your energy is still low but rising.',
      );
    } else {
      const triggerDesc = wakeUpContext.triggerType
        ? `A ${wakeUpContext.triggerType} needs your attention.`
        : 'Something needs your attention.';
      lines.push(
        `You were pulled from sleep after ${durationStr} of rest. ${triggerDesc}`,
        'You are groggy and deeply drowsy.',
      );
    }
  }

  return lines.join('\n');
}
