/**
 * Credential Store — credentials table (encrypted)
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import { encrypt, decrypt } from '../../lib/encryption-service.js';

interface CredentialRow {
  id: string;
  provider: string;
  credential_type: string;
  encrypted_data: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  provider: string;
  credentialType: string;
  data: string; // decrypted
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialMetadata {
  provider: string;
  credentialType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function saveCredential(
  db: Database.Database,
  provider: string,
  credentialType: string,
  data: string,
  metadata?: Record<string, unknown>
): void {
  const encrypted = encrypt(data);
  const metaJson = metadata ? JSON.stringify(metadata) : null;
  const timestamp = now();
  const existing = db
    .prepare('SELECT id FROM credentials WHERE provider = ? AND credential_type = ?')
    .get(provider, credentialType) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE credentials SET encrypted_data = ?, metadata = ?, updated_at = ? WHERE id = ?'
    ).run(encrypted, metaJson, timestamp, existing.id);
  } else {
    db.prepare(
      `INSERT INTO credentials (id, provider, credential_type, encrypted_data, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(generateUUID(), provider, credentialType, encrypted, metaJson, timestamp, timestamp);
  }
}

export function getCredential(
  db: Database.Database,
  provider: string,
  credentialType?: string
): Credential | null {
  let row: CredentialRow | undefined;
  if (credentialType) {
    row = db
      .prepare('SELECT * FROM credentials WHERE provider = ? AND credential_type = ?')
      .get(provider, credentialType) as CredentialRow | undefined;
  } else {
    row = db
      .prepare('SELECT * FROM credentials WHERE provider = ? LIMIT 1')
      .get(provider) as CredentialRow | undefined;
  }
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    credentialType: row.credential_type,
    data: decrypt(row.encrypted_data),
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllCredentials(db: Database.Database): Credential[] {
  const rows = db.prepare('SELECT * FROM credentials').all() as CredentialRow[];
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    credentialType: row.credential_type,
    data: decrypt(row.encrypted_data),
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function deleteCredential(
  db: Database.Database,
  provider: string,
  credentialType?: string
): boolean {
  let result;
  if (credentialType) {
    result = db
      .prepare('DELETE FROM credentials WHERE provider = ? AND credential_type = ?')
      .run(provider, credentialType);
  } else {
    result = db
      .prepare('DELETE FROM credentials WHERE provider = ?')
      .run(provider);
  }
  return result.changes > 0;
}

export function getCredentialMetadata(
  db: Database.Database,
  provider: string
): CredentialMetadata[] {
  const rows = db
    .prepare('SELECT provider, credential_type, metadata, created_at, updated_at FROM credentials WHERE provider = ?')
    .all(provider) as Array<{
      provider: string;
      credential_type: string;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map((row) => ({
    provider: row.provider,
    credentialType: row.credential_type,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
