/**
 * Package Settings Store — encrypted ongoing settings for plugins and channels.
 */

import type Database from 'better-sqlite3';
import { now, type PackageType } from '@animus-labs/shared';
import { encrypt, decrypt } from '../../lib/encryption-service.js';

export function getPackageSettings(
  db: Database.Database,
  packageType: PackageType,
  packageName: string,
): Record<string, unknown> {
  const rows = db.prepare(
    `SELECT setting_key, value_encrypted
     FROM package_settings
     WHERE package_type = ? AND package_name = ?
     ORDER BY setting_key`
  ).all(packageType, packageName) as Array<{
    setting_key: string;
    value_encrypted: string;
  }>;

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.setting_key] = JSON.parse(decrypt(row.value_encrypted));
    } catch {
      settings[row.setting_key] = null;
    }
  }
  return settings;
}

export function getPackageSetting(
  db: Database.Database,
  packageType: PackageType,
  packageName: string,
  key: string,
): unknown | null {
  const row = db.prepare(
    `SELECT value_encrypted
     FROM package_settings
     WHERE package_type = ? AND package_name = ? AND setting_key = ?`
  ).get(packageType, packageName, key) as { value_encrypted: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(decrypt(row.value_encrypted));
  } catch {
    return null;
  }
}

export function setPackageSetting(
  db: Database.Database,
  packageType: PackageType,
  packageName: string,
  key: string,
  value: unknown,
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO package_settings
      (package_type, package_name, setting_key, value_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(package_type, package_name, setting_key)
     DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = excluded.updated_at`
  ).run(
    packageType,
    packageName,
    key,
    encrypt(JSON.stringify(value)),
    timestamp,
    timestamp,
  );
}

export function setPackageSettings(
  db: Database.Database,
  packageType: PackageType,
  packageName: string,
  settings: Record<string, unknown>,
): void {
  const tx = db.transaction((entries: Array<[string, unknown]>) => {
    for (const [key, value] of entries) {
      setPackageSetting(db, packageType, packageName, key, value);
    }
  });
  tx(Object.entries(settings));
}

export function deletePackageSettings(
  db: Database.Database,
  packageType: PackageType,
  packageName: string,
): void {
  db.prepare(
    'DELETE FROM package_settings WHERE package_type = ? AND package_name = ?'
  ).run(packageType, packageName);
}
