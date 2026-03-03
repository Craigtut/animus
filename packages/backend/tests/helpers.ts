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
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '003_credentials.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '004_log_categories.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '005_energy_settings.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '006_plugins.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '010_tool_permissions.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '018_vault_entries.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '019_telemetry.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'system', '020_plugin_status.sql'));
  return db;
}

export function createTestHeartbeatDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'heartbeat', '001_initial.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'heartbeat', '003_tool_approvals.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'heartbeat', '004_goal_planning_prompts.sql'));
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
  applySql(db, path.join(MIGRATIONS_DIR, 'agent-logs', '001_initial.sql'));
  applySql(db, path.join(MIGRATIONS_DIR, 'agent-logs', '002_credential_audit.sql'));
  return db;
}

export function createTestContactsDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySql(db, path.join(MIGRATIONS_DIR, 'contacts', '001_initial.sql'));
  return db;
}
