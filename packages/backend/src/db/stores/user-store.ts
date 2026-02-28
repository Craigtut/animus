/**
 * User Store — users table
 */

import type Database from 'better-sqlite3';
import { generateUUID, now } from '@animus-labs/shared';
import type { User } from '@animus-labs/shared';
import { snakeToCamel } from '../utils.js';

export function createUser(
  db: Database.Database,
  data: { email: string; passwordHash: string }
): User {
  const id = generateUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.email, data.passwordHash, timestamp, timestamp);
  return { id, email: data.email, contactId: null, createdAt: timestamp, updatedAt: timestamp };
}

export function getUserByEmail(db: Database.Database, email: string): User | null {
  const row = db
    .prepare('SELECT id, email, contact_id, created_at, updated_at FROM users WHERE email = ?')
    .get(email) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<User>(row) : null;
}

export function getUserById(db: Database.Database, id: string): User | null {
  const row = db
    .prepare('SELECT id, email, contact_id, created_at, updated_at FROM users WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? snakeToCamel<User>(row) : null;
}

export function getUserCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}

export function getPasswordHash(db: Database.Database, email: string): string | null {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE email = ?')
    .get(email) as { password_hash: string } | undefined;
  return row?.password_hash ?? null;
}

export function updateUserContactId(
  db: Database.Database,
  userId: string,
  contactId: string
): void {
  db.prepare('UPDATE users SET contact_id = ?, updated_at = ? WHERE id = ?').run(
    contactId,
    now(),
    userId
  );
}
