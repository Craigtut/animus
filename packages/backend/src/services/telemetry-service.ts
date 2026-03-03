/**
 * Telemetry Service — anonymous usage telemetry via PostHog.
 *
 * Opt-out by default via settings toggle, DO_NOT_TRACK env, or
 * ANIMUS_TELEMETRY_DISABLED env. No PII is ever collected.
 *
 * Events: install, app_started, daily_active, feature_used, error_occurred
 */

import { PostHog } from 'posthog-node';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../utils/env.js';
import { getSystemDb } from '../db/index.js';
import * as settingsStore from '../db/stores/settings-store.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Telemetry', 'server');

const POSTHOG_API_KEY = 'phc_tWOlrOoDiJ1dncN5uNhFZ2DqvKuHJzSkCb7FEeYEgyz';
const POSTHOG_HOST = 'https://us.posthog.com';
const TELEMETRY_ID_FILE = 'telemetry-id';

// Package version (read once at startup)
let _version: string | null = null;
function getVersion(): string {
  if (!_version) {
    try {
      const pkgPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../package.json'
      );
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      _version = pkg.version ?? 'unknown';
    } catch {
      _version = 'unknown';
    }
  }
  return _version!;
}

export type TelemetryFeature =
  | 'voice'
  | 'goals'
  | 'plugins'
  | 'channels'
  | 'memory'
  | 'sleep_energy';

export class TelemetryService {
  private client: PostHog | null = null;
  private anonymousId: string | null = null;
  private isFirstRun = false;
  private installCaptured = false;
  private debug = false;

  // Per-day dedup state
  private lastDailyActiveDate = '';
  private featureUsedToday = new Set<string>();
  private errorCountToday = 0;
  private errorHashesToday = new Set<number>();
  private lastErrorDate = '';

  // Cached env check (immutable once process starts)
  private envDisabled: boolean | null = null;

  initialize(): void {
    this.debug = process.env['ANIMUS_TELEMETRY_DEBUG'] === '1';

    // Read or create anonymous ID
    const idPath = path.join(DATA_DIR, TELEMETRY_ID_FILE);
    try {
      if (fs.existsSync(idPath)) {
        this.anonymousId = fs.readFileSync(idPath, 'utf-8').trim();
      } else {
        this.anonymousId = randomUUID();
        fs.writeFileSync(idPath, this.anonymousId, 'utf-8');
        this.isFirstRun = true;
      }
    } catch (err) {
      log.warn('Failed to read/write telemetry ID file:', err);
      this.anonymousId = randomUUID();
    }

    // Initialize PostHog client
    if (!this.isEnvDisabled()) {
      this.client = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushInterval: 30000,
        flushAt: 5,
      });
      // Surface PostHog errors instead of silently swallowing them
      this.client.on('error', (err) => {
        log.debug('PostHog error:', err);
      });
    }
  }

  /** True when env vars explicitly disable telemetry (immutable for process lifetime). */
  private isEnvDisabled(): boolean {
    if (this.envDisabled === null) {
      this.envDisabled =
        process.env['DO_NOT_TRACK'] === '1' ||
        process.env['ANIMUS_TELEMETRY_DISABLED'] === '1';
    }
    return this.envDisabled;
  }

  /** Fully enabled: env allows it AND user setting is on. */
  isEnabled(): boolean {
    if (this.isEnvDisabled()) return false;
    try {
      const settings = settingsStore.getSystemSettings(getSystemDb());
      return settings.telemetryEnabled;
    } catch {
      // DB not ready or migration hasn't run yet
      return false;
    }
  }

  /** Re-generate anonymous ID (e.g. when user re-enables after disabling). */
  regenerateId(): void {
    this.anonymousId = randomUUID();
    const idPath = path.join(DATA_DIR, TELEMETRY_ID_FILE);
    try {
      fs.writeFileSync(idPath, this.anonymousId, 'utf-8');
    } catch (err) {
      log.warn('Failed to write new telemetry ID:', err);
    }
    // Reset dedup state
    this.featureUsedToday.clear();
    this.lastDailyActiveDate = '';
    this.errorCountToday = 0;
    this.errorHashesToday.clear();
    this.lastErrorDate = '';
  }

  /** Print a one-time notice about telemetry on first run. */
  printFirstRunNotice(): void {
    if (!this.isFirstRun) return;
    log.info(
      'Anonymous telemetry is enabled to help improve Animus. ' +
        'No personal data is collected. ' +
        'Disable in Settings > Telemetry, or set DO_NOT_TRACK=1.'
    );
  }

  // --------------------------------------------------------------------------
  // Event capture methods
  // --------------------------------------------------------------------------

  captureInstall(): void {
    if (this.installCaptured || !this.isFirstRun) return;
    if (!this.isEnabled()) return;
    this.installCaptured = true;
    this.capture('install', {
      version: getVersion(),
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    });
  }

  captureAppStarted(props: {
    provider: string;
    channelCount: number;
    pluginCount: number;
  }): void {
    if (!this.isEnabled()) return;
    this.capture('app_started', {
      version: getVersion(),
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      ...props,
    });
  }

  captureDailyActive(uptimeHours: number): void {
    if (!this.isEnabled()) return;
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastDailyActiveDate === today) return;
    this.lastDailyActiveDate = today;
    // Reset per-day feature tracking
    this.featureUsedToday.clear();
    this.errorCountToday = 0;
    this.errorHashesToday.clear();
    this.capture('daily_active', {
      version: getVersion(),
      provider: this.getCurrentProvider(),
      uptimeHours: Math.round(uptimeHours * 10) / 10,
    });
  }

  captureFeatureUsed(feature: TelemetryFeature): void {
    if (!this.isEnabled()) return;
    // Dedup: once per feature per day
    const today = new Date().toISOString().slice(0, 10);
    const key = `${today}:${feature}`;
    if (this.featureUsedToday.has(key)) return;
    this.featureUsedToday.add(key);
    this.capture('feature_used', { feature });
  }

  captureError(error: unknown): void {
    if (!this.isEnabled()) return;
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastErrorDate !== today) {
      this.lastErrorDate = today;
      this.errorCountToday = 0;
      this.errorHashesToday.clear();
    }
    if (this.errorCountToday >= 5) return;

    const errorType =
      error instanceof Error ? error.constructor.name : typeof error;
    const errorHash = simpleHash(
      error instanceof Error ? `${error.constructor.name}:${error.message}` : String(error)
    );

    if (this.errorHashesToday.has(errorHash)) return;
    this.errorHashesToday.add(errorHash);
    this.errorCountToday++;

    this.capture('error_occurred', { errorType, errorHash });
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private capture(event: string, properties: Record<string, unknown>): void {
    if (!this.anonymousId) return;

    const payload = {
      distinctId: this.anonymousId,
      event,
      properties: {
        ...properties,
        $lib: 'animus-engine',
      },
    };

    if (this.debug) {
      log.info(`[telemetry-debug] ${event}`, properties);
      return;
    }

    try {
      this.client?.capture(payload);
    } catch (err) {
      log.debug('Telemetry capture failed:', err);
    }
  }

  private getCurrentProvider(): string {
    try {
      const settings = settingsStore.getSystemSettings(getSystemDb());
      return settings.defaultAgentProvider ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.client?.shutdown();
    } catch {
      // Best-effort flush on shutdown
    }
    this.client = null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: TelemetryService | null = null;

export function getTelemetryService(): TelemetryService {
  if (!instance) instance = new TelemetryService();
  return instance;
}

export function resetTelemetryService(): void {
  instance = null;
}

// ============================================================================
// Utilities
// ============================================================================

/** Simple numeric hash for dedup. No crypto needed, just collision avoidance. */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}
