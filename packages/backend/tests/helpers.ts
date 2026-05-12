/**
 * Shared test helpers — create in-memory DBs with migrations applied.
 */

import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function applySql(db: Database.Database, sqlPath: string): void {
  const sql = readFileSync(sqlPath, 'utf-8');
  db.exec(sql);
}

function applyMigrations(db: Database.Database, group: string): void {
  const dir = path.join(MIGRATIONS_DIR, group);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    applySql(db, path.join(dir, file));
  }
}

export function createTestSystemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, 'system');
  return db;
}

export function createTestHeartbeatDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, 'heartbeat');
  return db;
}

export function createTestMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'memory', '001_initial.sql'));
  return db;
}

export function createTestMessagesDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'messages', '001_initial.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'messages', '002_delivery_tracking.sql'));
  return db;
}

export function createTestPersonaDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'persona', '001_initial.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'persona', '002_voice.sql'));
  return db;
}

export function createTestAgentLogsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, 'agent-logs');
  return db;
}

export function createTestContactsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'contacts', '001_initial.sql'));
  return db;
}

export function createTestSessionsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, 'sessions');
  return db;
}
