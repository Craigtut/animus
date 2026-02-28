/**
 * Channel Package Store — channel_packages table
 */

import type Database from 'better-sqlite3';
import { now } from '@animus-labs/shared';
import type { ChannelPackage, ChannelPackageStatus } from '@animus-labs/shared';
import { snakeToCamel, boolToInt, intToBool } from '../utils.js';
import { encrypt, decrypt } from '../../lib/encryption-service.js';

function rowToChannelPackage(row: Record<string, unknown>): ChannelPackage {
  const raw = snakeToCamel<Record<string, unknown>>(row);
  return {
    name: raw['name'] as string,
    channelType: raw['channelType'] as string,
    version: raw['version'] as string,
    path: raw['path'] as string,
    enabled: intToBool(raw['enabled'] as number),
    config: row['config'] ? JSON.parse(row['config'] as string) as Record<string, unknown> : null,
    installedAt: raw['installedAt'] as string,
    updatedAt: raw['updatedAt'] as string,
    checksum: raw['checksum'] as string,
    status: raw['status'] as ChannelPackageStatus,
    lastError: (raw['lastError'] as string) ?? null,
    installedFrom: (raw['installedFrom'] as 'local' | 'package') ?? 'local',
  };
}

export function getChannelPackages(db: Database.Database): ChannelPackage[] {
  const rows = db
    .prepare('SELECT * FROM channel_packages ORDER BY installed_at')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToChannelPackage);
}

export function getChannelPackage(
  db: Database.Database,
  name: string
): ChannelPackage | null {
  const row = db
    .prepare('SELECT * FROM channel_packages WHERE name = ?')
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToChannelPackage(row) : null;
}

export function getChannelPackageByType(
  db: Database.Database,
  channelType: string
): ChannelPackage | null {
  const row = db
    .prepare('SELECT * FROM channel_packages WHERE channel_type = ?')
    .get(channelType) as Record<string, unknown> | undefined;
  return row ? rowToChannelPackage(row) : null;
}

export function createChannelPackage(
  db: Database.Database,
  data: {
    name: string;
    channelType: string;
    version: string;
    path: string;
    checksum: string;
    installedFrom?: 'local' | 'package';
  }
): ChannelPackage {
  const timestamp = now();
  const installedFrom = data.installedFrom ?? 'local';
  db.prepare(
    `INSERT INTO channel_packages (name, channel_type, version, path, checksum, installed_from, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.name, data.channelType, data.version, data.path, data.checksum, installedFrom, timestamp, timestamp);
  return {
    name: data.name,
    channelType: data.channelType,
    version: data.version,
    path: data.path,
    enabled: false,
    config: null,
    installedAt: timestamp,
    updatedAt: timestamp,
    checksum: data.checksum,
    status: 'disabled',
    lastError: null,
    installedFrom,
  };
}

export function updateChannelPackage(
  db: Database.Database,
  name: string,
  data: Partial<{
    version: string;
    path: string;
    enabled: boolean;
    config: Record<string, unknown> | null;
    checksum: string;
    status: ChannelPackageStatus;
    lastError: string | null;
  }>
): void {
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
  if (data.config !== undefined) {
    fields.push('config = ?');
    values.push(data.config ? JSON.stringify(data.config) : null);
  }
  if (data.checksum !== undefined) {
    fields.push('checksum = ?');
    values.push(data.checksum);
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.lastError !== undefined) {
    fields.push('last_error = ?');
    values.push(data.lastError);
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(name);
  db.prepare(`UPDATE channel_packages SET ${fields.join(', ')} WHERE name = ?`).run(...values);
}

export function deleteChannelPackage(db: Database.Database, name: string): boolean {
  const result = db.prepare('DELETE FROM channel_packages WHERE name = ?').run(name);
  return result.changes > 0;
}

export function updateChannelPackageStatus(
  db: Database.Database,
  name: string,
  status: ChannelPackageStatus,
  lastError?: string | null
): void {
  db.prepare(
    'UPDATE channel_packages SET status = ?, last_error = ?, updated_at = ? WHERE name = ?'
  ).run(status, lastError ?? null, now(), name);
}

export function getChannelPackageConfig(
  db: Database.Database,
  name: string,
  secretKeys: string[]
): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT config FROM channel_packages WHERE name = ?')
    .get(name) as { config: string | null } | undefined;
  if (!row?.config) return null;
  const config = JSON.parse(row.config) as Record<string, unknown>;
  // Decrypt secret fields
  for (const key of secretKeys) {
    if (typeof config[key] === 'string' && config[key]) {
      config[key] = decrypt(config[key] as string);
    }
  }
  return config;
}

export function setChannelPackageConfig(
  db: Database.Database,
  name: string,
  config: Record<string, unknown>,
  secretKeys: string[]
): void {
  const encrypted = { ...config };
  // Encrypt secret fields
  for (const key of secretKeys) {
    if (typeof encrypted[key] === 'string' && encrypted[key]) {
      encrypted[key] = encrypt(encrypted[key] as string);
    }
  }
  db.prepare(
    'UPDATE channel_packages SET config = ?, updated_at = ? WHERE name = ?'
  ).run(JSON.stringify(encrypted), now(), name);
}
