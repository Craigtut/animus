/**
 * Vault Store — vault_entries table (encrypted passwords)
 *
 * User-managed credential storage for agent use. Passwords are
 * encrypted at rest with AES-256-GCM. The store provides both
 * full reads (for run_with_credentials) and metadata-only reads
 * (for list_vault_entries tool and frontend display).
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import { encrypt, decrypt } from '../../lib/encryption-service.js';

interface VaultEntryRow {
  id: string;
  label: string;
  service: string;
  url: string | null;
  identity: string | null;
  encrypted_password: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultEntry {
  id: string;
  label: string;
  service: string;
  url: string | null;
  identity: string | null;
  password: string; // decrypted
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultEntryMetadata {
  id: string;
  label: string;
  service: string;
  url: string | null;
  identity: string | null;
  hint: string; // last 4 chars of password
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToEntry(row: VaultEntryRow): VaultEntry {
  return {
    id: row.id,
    label: row.label,
    service: row.service,
    url: row.url,
    identity: row.identity,
    password: decrypt(row.encrypted_password),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMetadata(row: VaultEntryRow): VaultEntryMetadata {
  const decrypted = decrypt(row.encrypted_password);
  const hint = decrypted.length >= 4
    ? `****${decrypted.slice(-4)}`
    : '****';

  return {
    id: row.id,
    label: row.label,
    service: row.service,
    url: row.url,
    identity: row.identity,
    hint,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createVaultEntry(
  db: Database.Database,
  data: {
    label: string;
    service: string;
    url?: string | null | undefined;
    identity?: string | null | undefined;
    password: string;
    notes?: string | null | undefined;
  }
): VaultEntryMetadata {
  const id = generateUUID();
  const timestamp = now();
  const encryptedPassword = encrypt(data.password);

  db.prepare(
    `INSERT INTO vault_entries (id, label, service, url, identity, encrypted_password, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.label,
    data.service,
    data.url ?? null,
    data.identity ?? null,
    encryptedPassword,
    data.notes ?? null,
    timestamp,
    timestamp
  );

  return getVaultEntryMetadata(db, id)!;
}

export function updateVaultEntry(
  db: Database.Database,
  id: string,
  data: {
    label?: string | undefined;
    service?: string | undefined;
    url?: string | null | undefined;
    identity?: string | null | undefined;
    password?: string | undefined;
    notes?: string | null | undefined;
  }
): VaultEntryMetadata | null {
  const existing = db
    .prepare('SELECT id FROM vault_entries WHERE id = ?')
    .get(id) as { id: string } | undefined;
  if (!existing) return null;

  const timestamp = now();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.label !== undefined) {
    updates.push('label = ?');
    values.push(data.label);
  }
  if (data.service !== undefined) {
    updates.push('service = ?');
    values.push(data.service);
  }
  if (data.url !== undefined) {
    updates.push('url = ?');
    values.push(data.url);
  }
  if (data.identity !== undefined) {
    updates.push('identity = ?');
    values.push(data.identity);
  }
  if (data.password !== undefined) {
    updates.push('encrypted_password = ?');
    values.push(encrypt(data.password));
  }
  if (data.notes !== undefined) {
    updates.push('notes = ?');
    values.push(data.notes);
  }

  if (updates.length === 0) return getVaultEntryMetadata(db, id);

  updates.push('updated_at = ?');
  values.push(timestamp);
  values.push(id);

  db.prepare(
    `UPDATE vault_entries SET ${updates.join(', ')} WHERE id = ?`
  ).run(...values);

  return getVaultEntryMetadata(db, id);
}

export function deleteVaultEntry(db: Database.Database, id: string): boolean {
  const result = db
    .prepare('DELETE FROM vault_entries WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

/**
 * Get a vault entry with decrypted password. Used by run_with_credentials.
 */
export function getVaultEntry(db: Database.Database, id: string): VaultEntry | null {
  const row = db
    .prepare('SELECT * FROM vault_entries WHERE id = ?')
    .get(id) as VaultEntryRow | undefined;
  if (!row) return null;
  return rowToEntry(row);
}

/**
 * Get vault entry metadata (no password, just hint). Used by list_vault_entries tool.
 */
export function getVaultEntryMetadata(
  db: Database.Database,
  id: string
): VaultEntryMetadata | null {
  const row = db
    .prepare('SELECT * FROM vault_entries WHERE id = ?')
    .get(id) as VaultEntryRow | undefined;
  if (!row) return null;
  return rowToMetadata(row);
}

/**
 * List all vault entries as metadata (no passwords). Used by list_vault_entries tool.
 */
export function listVaultEntries(db: Database.Database): VaultEntryMetadata[] {
  const rows = db
    .prepare('SELECT * FROM vault_entries ORDER BY service, label')
    .all() as VaultEntryRow[];
  return rows.map(rowToMetadata);
}

/**
 * Get the count of vault entries. Used for context summary.
 */
export function getVaultEntryCount(db: Database.Database): number {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM vault_entries')
    .get() as { count: number };
  return row.count;
}
