/**
 * Plugin Store — data access for the plugins table in system.db
 *
 * Pure functions with `db` as first parameter, following the same
 * pattern as system-store.ts.
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { PluginRecord, PluginSource } from '@animus-labs/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';

// ============================================================================
// Helpers
// ============================================================================

function rowToPlugin(row: Record<string, unknown>): PluginRecord {
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return { ...raw, enabled: intToBool(raw['enabled'] as number) } as PluginRecord;
}

// ============================================================================
// CRUD
// ============================================================================

export interface NewPlugin {
  name: string;
  version: string;
  path: string;
  source: PluginSource;
  enabled?: boolean;
  storeId?: string | null;
  configEncrypted?: string | null;
}

export function insertPlugin(db: Database.Database, data: NewPlugin): PluginRecord {
  const timestamp = now();
  const enabled = data.enabled ?? true;
  db.prepare(
    `INSERT INTO plugins (name, version, path, enabled, installed_at, updated_at, source, store_id, config_encrypted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.name,
    data.version,
    data.path,
    boolToInt(enabled),
    timestamp,
    timestamp,
    data.source,
    data.storeId ?? null,
    data.configEncrypted ?? null,
  );
  return {
    name: data.name,
    version: data.version,
    path: data.path,
    enabled,
    installedAt: timestamp,
    updatedAt: timestamp,
    source: data.source,
    storeId: data.storeId ?? null,
    configEncrypted: data.configEncrypted ?? null,
  };
}

export function getPlugin(db: Database.Database, name: string): PluginRecord | null {
  const row = db
    .prepare('SELECT * FROM plugins WHERE name = ?')
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToPlugin(row) : null;
}

export function getAllPlugins(db: Database.Database): PluginRecord[] {
  const rows = db
    .prepare('SELECT * FROM plugins ORDER BY name')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToPlugin);
}

export function getEnabledPlugins(db: Database.Database): PluginRecord[] {
  const rows = db
    .prepare('SELECT * FROM plugins WHERE enabled = 1 ORDER BY name')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToPlugin);
}

export function updatePlugin(
  db: Database.Database,
  name: string,
  data: Partial<Pick<PluginRecord, 'version' | 'path' | 'enabled' | 'source' | 'storeId'>>
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.version !== undefined) {
    fields.push('version = ?');
    values.push(data.version);
  }
  if (data.path !== undefined) {
    fields.push('path = ?');
    values.push(data.path);
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(boolToInt(data.enabled));
  }
  if (data.source !== undefined) {
    fields.push('source = ?');
    values.push(data.source);
  }
  if (data.storeId !== undefined) {
    fields.push('store_id = ?');
    values.push(data.storeId);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(now());
  values.push(name);

  const result = db
    .prepare(`UPDATE plugins SET ${fields.join(', ')} WHERE name = ?`)
    .run(...values);
  return result.changes > 0;
}

export function deletePlugin(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM plugins WHERE name = ?').run(name);
  return result.changes > 0;
}

export function updatePluginConfig(
  db: Database.Database,
  name: string,
  configEncrypted: string | null
): boolean {
  const result = db
    .prepare('UPDATE plugins SET config_encrypted = ?, updated_at = ? WHERE name = ?')
    .run(configEncrypted, now(), name);
  return result.changes > 0;
}
