/**
 * Autosave Subsystem
 *
 * Handles scheduled autosave execution based on user-configured frequency
 * and time-of-day preferences. Integrates with the LifecycleManager as a
 * SubsystemLifecycle and supports missed-window recovery on app restart.
 *
 * Autosaves are stored in data/saves/autosave/ and rotated to keep at most
 * maxCount files.
 */

import type { SubsystemLifecycle, SubsystemHealth } from '../lib/lifecycle.js';
import { createLogger } from '../lib/logger.js';
import { getSystemDb, getPersonaDb } from '../db/index.js';
import * as settingsStore from '../db/stores/settings-store.js';
import * as personaStore from '../db/stores/persona-store.js';
import { isMaintenanceMode } from '../lib/maintenance.js';
import { createSave, operationInProgress, rotateAutosaves } from './save-service.js';

const log = createLogger('AutosaveSubsystem', 'autosave');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AutosaveFrequency = '1h' | '6h' | '12h' | '24h' | '3d' | '7d';

/** How long to wait before retrying when blocked by maintenance or an in-progress operation. */
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Scheduling Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current time in a given timezone as a Date with correct local interpretation.
 * Returns the wall-clock hour (0-23) and minute (0-59) in that timezone.
 */
function getLocalTime(date: Date, timezone: string): { hour: number; minute: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return { hour, minute };
  } catch {
    log.warn(`Invalid timezone "${timezone}", falling back to UTC`);
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

/**
 * Build a Date for a specific hour (on the hour) in the target timezone,
 * on a given reference date's calendar day in that timezone.
 *
 * Strategy: get the calendar date in the timezone, build a UTC guess,
 * then measure the actual offset by comparing local vs UTC representations
 * of a nearby point and adjust.
 */
function dateAtHourInTimezone(refDate: Date, targetHour: number, timezone: string): Date {
  // Get the reference date's calendar date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(refDate);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  // Get the timezone's UTC offset at the reference date by comparing
  // the local calendar parts in UTC vs the timezone
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(refDate);
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(refDate);

  const utcMs = Date.UTC(
    Number(utcParts.find((p) => p.type === 'year')?.value),
    Number(utcParts.find((p) => p.type === 'month')?.value) - 1,
    Number(utcParts.find((p) => p.type === 'day')?.value),
    Number(utcParts.find((p) => p.type === 'hour')?.value) % 24,
    Number(utcParts.find((p) => p.type === 'minute')?.value),
  );
  const localMs = Date.UTC(
    Number(tzParts.find((p) => p.type === 'year')?.value),
    Number(tzParts.find((p) => p.type === 'month')?.value) - 1,
    Number(tzParts.find((p) => p.type === 'day')?.value),
    Number(tzParts.find((p) => p.type === 'hour')?.value) % 24,
    Number(tzParts.find((p) => p.type === 'minute')?.value),
  );

  // offsetMs = how far ahead local time is from UTC (positive = east of UTC)
  const offsetMs = localMs - utcMs;

  // Target: year-month-day targetHour:00 in the timezone
  // In UTC that is: Date.UTC(year, month-1, day, targetHour) - offsetMs
  const result = new Date(Date.UTC(year, month - 1, day, targetHour, 0, 0, 0) - offsetMs);
  return result;
}

/**
 * Compute the next fire time for autosave based on frequency and configuration.
 *
 * - '1h': next top of hour
 * - '6h': every 6h anchored to timeOfDay
 * - '12h': every 12h anchored to timeOfDay
 * - '24h': daily at timeOfDay
 * - '3d': every 3 days at timeOfDay, computed from lastAutosaveAt
 * - '7d': every 7 days at timeOfDay, computed from lastAutosaveAt
 */
export function computeNextFireTime(
  frequency: AutosaveFrequency,
  timeOfDay: number,
  timezone: string,
  lastAutosaveAt: string | null,
): Date {
  const now = new Date();

  if (frequency === '1h') {
    // Next top of hour
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }

  if (frequency === '24h') {
    // Next occurrence of timeOfDay in the persona timezone
    const todayAtTime = dateAtHourInTimezone(now, timeOfDay, timezone);
    if (todayAtTime.getTime() > now.getTime()) {
      return todayAtTime;
    }
    // Already passed today, schedule for tomorrow
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return dateAtHourInTimezone(tomorrow, timeOfDay, timezone);
  }

  if (frequency === '12h' || frequency === '6h') {
    const intervalHours = frequency === '12h' ? 12 : 6;
    // Generate anchor times based on timeOfDay, stepping by intervalHours
    const anchors: number[] = [];
    for (let h = timeOfDay; anchors.length < 24 / intervalHours; h = (h + intervalHours) % 24) {
      anchors.push(h);
    }

    // Find the next anchor time that is in the future
    const local = getLocalTime(now, timezone);
    const currentFractional = local.hour + local.minute / 60;

    // Sort anchors and find the next one after current time
    anchors.sort((a, b) => a - b);

    for (const anchor of anchors) {
      if (anchor > currentFractional) {
        return dateAtHourInTimezone(now, anchor, timezone);
      }
    }

    // All anchors have passed today, use the first anchor tomorrow
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return dateAtHourInTimezone(tomorrow, anchors[0]!, timezone);
  }

  // '3d' or '7d': interval-based from lastAutosaveAt
  const intervalDays = frequency === '3d' ? 3 : 7;

  if (lastAutosaveAt) {
    const last = new Date(lastAutosaveAt);
    // Next fire = last + intervalDays, at timeOfDay in timezone
    const nextDay = new Date(last.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    const nextFire = dateAtHourInTimezone(nextDay, timeOfDay, timezone);

    // If the computed time is still in the future, use it
    if (nextFire.getTime() > now.getTime()) {
      return nextFire;
    }
    // Otherwise it is in the past (missed window), return it as-is
    // so the caller can detect it and fire immediately
    return nextFire;
  }

  // No previous autosave: schedule intervalDays from now at timeOfDay
  const futureDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return dateAtHourInTimezone(futureDate, timeOfDay, timezone);
}

// ---------------------------------------------------------------------------
// AutosaveSubsystem
// ---------------------------------------------------------------------------

let instance: AutosaveSubsystem | null = null;

export class AutosaveSubsystem implements SubsystemLifecycle {
  readonly name = 'autosave';

  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private nextFireAt: Date | null = null;
  private lastAutosaveAt: string | null = null;

  async start(): Promise<void> {
    await this.schedule();
  }

  async stop(): Promise<void> {
    this.clearTimer();
    log.info('Stopped');
  }

  healthCheck(): SubsystemHealth {
    return {
      status: 'running',
      detail: [
        `enabled=${this.enabled}`,
        this.nextFireAt ? `nextFireAt=${this.nextFireAt.toISOString()}` : 'nextFireAt=none',
        this.lastAutosaveAt ? `lastAutosaveAt=${this.lastAutosaveAt}` : 'lastAutosaveAt=none',
      ].join(', '),
    };
  }

  /**
   * Return typed status for the API layer. Unlike healthCheck() (which returns
   * a freeform detail string for diagnostics), this returns structured data.
   */
  getStatus(): { enabled: boolean; nextAutosaveAt: string | null; lastAutosaveAt: string | null } {
    return {
      enabled: this.enabled,
      nextAutosaveAt: this.nextFireAt?.toISOString() ?? null,
      lastAutosaveAt: this.lastAutosaveAt,
    };
  }

  /**
   * Re-read settings and reschedule. Call this when autosave settings change.
   */
  async reconfigure(): Promise<void> {
    log.info('Reconfiguring autosave schedule');
    this.clearTimer();
    await this.schedule();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextFireAt = null;
  }

  private async schedule(): Promise<void> {
    const settings = settingsStore.getSystemSettings(getSystemDb());
    this.enabled = settings.autosaveEnabled;
    this.lastAutosaveAt = settings.lastAutosaveAt ?? null;

    if (!this.enabled) {
      log.info('Autosave is disabled');
      return;
    }

    const timezone = this.getTimezone();
    const frequency = settings.autosaveFrequency as AutosaveFrequency;
    const timeOfDay = settings.autosaveTimeOfDay;
    const maxCount = settings.autosaveMaxCount;

    const nextFire = computeNextFireTime(frequency, timeOfDay, timezone, this.lastAutosaveAt);
    const now = Date.now();
    const delay = nextFire.getTime() - now;

    if (delay <= 0) {
      // Missed window (app was off when it should have fired). Fire immediately.
      log.info('Missed autosave window detected, firing immediately');
      await this.executeAutosave(maxCount, frequency, timeOfDay, timezone);
    } else {
      this.nextFireAt = nextFire;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.executeAutosave(maxCount, frequency, timeOfDay, timezone).catch((err) => {
          log.error('Unexpected error in autosave execution:', err);
        });
      }, delay);
      log.info(`Next autosave scheduled for ${nextFire.toISOString()} (in ${Math.round(delay / 1000)}s)`);
    }
  }

  private async executeAutosave(
    maxCount: number,
    frequency: AutosaveFrequency,
    timeOfDay: number,
    timezone: string,
  ): Promise<void> {
    try {
      // Check maintenance mode
      if (isMaintenanceMode()) {
        log.info('Maintenance mode active, retrying autosave in 5 minutes');
        this.scheduleRetry(maxCount, frequency, timeOfDay, timezone);
        return;
      }

      // Check if another save/restore is in progress
      if (operationInProgress) {
        log.info('Save/restore operation in progress, retrying autosave in 5 minutes');
        this.scheduleRetry(maxCount, frequency, timeOfDay, timezone);
        return;
      }

      // Create the autosave
      log.info('Creating autosave');
      await createSave('Autosave', undefined, { autosave: true });

      // Rotate old autosaves
      await rotateAutosaves(maxCount);

      // Update lastAutosaveAt in settings
      const nowIso = new Date().toISOString();
      settingsStore.updateSystemSettings(getSystemDb(), { lastAutosaveAt: nowIso });
      this.lastAutosaveAt = nowIso;

      log.info('Autosave completed successfully');
    } catch (err) {
      log.error('Autosave failed:', err);
    }

    // Always schedule the next one, even if this one failed
    try {
      const nextFire = computeNextFireTime(frequency, timeOfDay, timezone, this.lastAutosaveAt);
      let delay = nextFire.getTime() - Date.now();

      // Safety: if the computed next time is in the past (should not happen after
      // a successful save), fall back to the retry delay instead of rapid-looping.
      if (delay <= 0) {
        log.warn(`Computed next autosave is in the past (${nextFire.toISOString()}), falling back to retry delay`);
        delay = RETRY_DELAY_MS;
      }

      this.nextFireAt = nextFire;
      this.timer = setTimeout(() => {
        this.timer = null;
        // Re-read settings for the next execution in case they changed
        this.executeAutosaveFromSettings().catch((err) => {
          log.error('Unexpected error in autosave execution:', err);
        });
      }, delay);

      log.info(`Next autosave scheduled for ${nextFire.toISOString()} (in ${Math.round(delay / 1000)}s)`);
    } catch (err) {
      log.error('Failed to schedule next autosave:', err);
    }
  }

  /**
   * Re-read settings and execute. Used for subsequent timer fires
   * so that setting changes are picked up without needing reconfigure().
   */
  private async executeAutosaveFromSettings(): Promise<void> {
    const settings = settingsStore.getSystemSettings(getSystemDb());
    this.enabled = settings.autosaveEnabled;

    if (!this.enabled) {
      log.info('Autosave has been disabled, skipping execution');
      return;
    }

    const timezone = this.getTimezone();
    const frequency = settings.autosaveFrequency as AutosaveFrequency;
    const timeOfDay = settings.autosaveTimeOfDay;
    const maxCount = settings.autosaveMaxCount;

    await this.executeAutosave(maxCount, frequency, timeOfDay, timezone);
  }

  private scheduleRetry(
    maxCount: number,
    frequency: AutosaveFrequency,
    timeOfDay: number,
    timezone: string,
  ): void {
    this.nextFireAt = new Date(Date.now() + RETRY_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.executeAutosave(maxCount, frequency, timeOfDay, timezone).catch((err) => {
        log.error('Unexpected error in autosave retry:', err);
      });
    }, RETRY_DELAY_MS);
  }

  private getTimezone(): string {
    try {
      const persona = personaStore.getPersona(getPersonaDb());
      return persona.timezone || 'UTC';
    } catch {
      return 'UTC';
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export function getAutosaveSubsystem(): AutosaveSubsystem {
  if (!instance) {
    instance = new AutosaveSubsystem();
  }
  return instance;
}
