/**
 * Settings Store — system_settings table (singleton)
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { SystemSettings, OnboardingState } from '@animus-labs/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';

export function getSystemSettings(db: Database.Database): SystemSettings {
  const row = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  const s = snakeToCamel<Record<string, unknown>>(row);
  // Strip singleton id and updatedAt (not in schema), convert booleans
  const { id: _id, updatedAt: _ua, ...rest } = s;
  return {
    ...rest,
    energySystemEnabled: intToBool(rest['energySystemEnabled'] as number),
    telemetryEnabled: intToBool(rest['telemetryEnabled'] as number),
  } as SystemSettings;
}

export function updateSystemSettings(
  db: Database.Database,
  data: Partial<SystemSettings>
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const mapping: Record<string, string> = {
    heartbeatIntervalMs: 'heartbeat_interval_ms',
    sessionWarmthMs: 'session_warmth_ms',
    sessionContextBudget: 'session_context_budget',
    thoughtRetentionDays: 'thought_retention_days',
    experienceRetentionDays: 'experience_retention_days',
    emotionHistoryRetentionDays: 'emotion_history_retention_days',
    agentLogRetentionDays: 'agent_log_retention_days',
    taskRunRetentionDays: 'task_run_retention_days',
    defaultAgentProvider: 'default_agent_provider',
    defaultModel: 'default_model',
    goalApprovalMode: 'goal_approval_mode',
    energySystemEnabled: 'energy_system_enabled',
    telemetryEnabled: 'telemetry_enabled',
    sleepStartHour: 'sleep_start_hour',
    sleepEndHour: 'sleep_end_hour',
    sleepTickIntervalMs: 'sleep_tick_interval_ms',
    reasoningEffort: 'reasoning_effort',
    memoryPoolMaxSize: 'memory_pool_max_size',
  };

  // Boolean fields need int conversion
  const booleanFields = new Set(['energySystemEnabled', 'telemetryEnabled']);

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    const value = (data as Record<string, unknown>)[camelKey];
    if (value !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(booleanFields.has(camelKey) ? boolToInt(value as boolean) : value);
    }
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE system_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}

// ============================================================================
// Log Categories
// ============================================================================

export function getLogCategories(db: Database.Database): Record<string, boolean> {
  const row = db
    .prepare('SELECT log_categories FROM system_settings WHERE id = 1')
    .get() as { log_categories: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.log_categories) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function updateLogCategories(
  db: Database.Database,
  categories: Record<string, boolean>
): Record<string, boolean> {
  const existing = getLogCategories(db);
  const merged = { ...existing, ...categories };
  db.prepare('UPDATE system_settings SET log_categories = ?, updated_at = ? WHERE id = 1').run(
    JSON.stringify(merged),
    now()
  );
  return merged;
}

// ============================================================================
// Onboarding State (on system_settings singleton)
// ============================================================================

export function getOnboardingState(db: Database.Database): OnboardingState {
  const row = db.prepare(
    'SELECT onboarding_step, onboarding_complete FROM system_settings WHERE id = 1'
  ).get() as { onboarding_step: number; onboarding_complete: number } | undefined;
  if (!row) return { currentStep: 0, isComplete: false };
  return {
    currentStep: row.onboarding_step,
    isComplete: intToBool(row.onboarding_complete),
  };
}

export function updateOnboardingState(
  db: Database.Database,
  data: { currentStep?: number; isComplete?: boolean }
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.currentStep !== undefined) {
    fields.push('onboarding_step = ?');
    values.push(data.currentStep);
  }
  if (data.isComplete !== undefined) {
    fields.push('onboarding_complete = ?');
    values.push(boolToInt(data.isComplete));
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  db.prepare(`UPDATE system_settings SET ${fields.join(', ')} WHERE id = 1`).run(...values);
}
