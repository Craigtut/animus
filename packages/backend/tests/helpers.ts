/**
 * Shared test helpers — create in-memory DBs with migrations applied.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function applySql(db: Database.Database, sqlPath: string): void {
  const sql = readFileSync(sqlPath, 'utf-8');
  db.exec(sql);
}

export function createTestSystemDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '001_initial.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '002_persona_expansion.sql'));
  return db;
}

export function createTestHeartbeatDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'heartbeat', '001_initial.sql'));
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
  return db;
}

export function createTestAgentLogsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'agent-logs', '001_initial.sql'));
  return db;
}
