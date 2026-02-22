/**
 * Database Module
 *
 * Manages six SQLite databases:
 * - system.db: Users, contacts, settings, API keys (rarely reset)
 * - persona.db: Personality settings (separate lifecycle from system.db)
 * - heartbeat.db: Thoughts, experiences, emotions, goals, tasks (the "life state")
 * - memory.db: Working memory, core self, long-term memories (knowledge)
 * - messages.db: Conversations, messages, media (long-term history)
 * - agent_logs.db: SDK logs, events, token usage (frequent cleanup)
 *
 * All DDL is managed via versioned .sql migration files.
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from '../utils/env.js';
import { createLogger } from '../lib/logger.js';
import { runMigrations } from './migrate.js';

const log = createLogger('Database', 'database');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Database instances
let systemDb: Database.Database;
let personaDb: Database.Database;
let heartbeatDb: Database.Database;
let memoryDb: Database.Database;
let messagesDb: Database.Database;
let agentLogsDb: Database.Database;
export const DATABASE_COUNT = 6;

export function getSystemDb(): Database.Database {
  if (!systemDb) throw new Error('System database not initialized');
  return systemDb;
}

export function getPersonaDb(): Database.Database {
  if (!personaDb) throw new Error('Persona database not initialized');
  return personaDb;
}

export function getHeartbeatDb(): Database.Database {
  if (!heartbeatDb) throw new Error('Heartbeat database not initialized');
  return heartbeatDb;
}

export function getMemoryDb(): Database.Database {
  if (!memoryDb) throw new Error('Memory database not initialized');
  return memoryDb;
}

export function getMessagesDb(): Database.Database {
  if (!messagesDb) throw new Error('Messages database not initialized');
  return messagesDb;
}

export function getAgentLogsDb(): Database.Database {
  if (!agentLogsDb) throw new Error('Agent logs database not initialized');
  return agentLogsDb;
}

/**
 * Open a database, set WAL mode and enable foreign keys.
 */
function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Initialize all databases: open connections, run migrations.
 */
export async function initializeDatabases(): Promise<void> {
  // Ensure data directories exist
  const paths = [
    env.DB_SYSTEM_PATH,
    env.DB_PERSONA_PATH,
    env.DB_HEARTBEAT_PATH,
    env.DB_MEMORY_PATH,
    env.DB_MESSAGES_PATH,
    env.DB_AGENT_LOGS_PATH,
  ];
  for (const p of paths) {
    await mkdir(path.dirname(p), { recursive: true });
  }

  // Open all databases
  systemDb = openDb(env.DB_SYSTEM_PATH);
  personaDb = openDb(env.DB_PERSONA_PATH);
  heartbeatDb = openDb(env.DB_HEARTBEAT_PATH);
  memoryDb = openDb(env.DB_MEMORY_PATH);
  messagesDb = openDb(env.DB_MESSAGES_PATH);
  agentLogsDb = openDb(env.DB_AGENT_LOGS_PATH);

  // Run migrations
  runMigrations(systemDb, path.join(MIGRATIONS_DIR, 'system'), 'system.db');
  runMigrations(personaDb, path.join(MIGRATIONS_DIR, 'persona'), 'persona.db');
  runMigrations(heartbeatDb, path.join(MIGRATIONS_DIR, 'heartbeat'), 'heartbeat.db');
  runMigrations(memoryDb, path.join(MIGRATIONS_DIR, 'memory'), 'memory.db');
  runMigrations(messagesDb, path.join(MIGRATIONS_DIR, 'messages'), 'messages.db');
  runMigrations(agentLogsDb, path.join(MIGRATIONS_DIR, 'agent-logs'), 'agent_logs.db');

  // One-time migration: copy finalized persona from system.db → persona.db
  migratePersonaFromSystem(systemDb, personaDb);

  // Check for orphaned rollback backup from a previous failed restore
  const { checkForOrphanedRollback } = await import('../services/restore-service.js');
  await checkForOrphanedRollback();

  log.info('All databases initialized');
}

/**
 * One-time migration: copy persona data from system.db to persona.db.
 *
 * Runs when system.db has a finalized persona but persona.db does not,
 * indicating this is an upgrade from before persona.db existed.
 */
function migratePersonaFromSystem(
  sysDb: Database.Database,
  persDb: Database.Database
): void {
  // Check if system.db has personality_settings table with is_finalized column
  const sysTableInfo = sysDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='personality_settings'")
    .get() as Record<string, unknown> | undefined;
  if (!sysTableInfo) return;

  const sysRow = sysDb
    .prepare('SELECT * FROM personality_settings WHERE id = 1')
    .get() as Record<string, unknown> | undefined;
  if (!sysRow) return;
  if ((sysRow['is_finalized'] as number) !== 1) return;

  const persRow = persDb
    .prepare('SELECT is_finalized, name FROM personality_settings WHERE id = 1')
    .get() as Record<string, unknown> | undefined;
  if (!persRow) return;
  // Already migrated
  if ((persRow['is_finalized'] as number) === 1) return;

  // Copy all columns from system.db → persona.db
  persDb.prepare(`
    UPDATE personality_settings SET
      name = ?,
      traits = ?,
      communication_style = ?,
      "values" = ?,
      existence_paradigm = ?,
      location = ?,
      world_description = ?,
      gender = ?,
      age = ?,
      physical_description = ?,
      personality_dimensions = ?,
      background = ?,
      personality_notes = ?,
      archetype = ?,
      is_finalized = ?,
      updated_at = ?
    WHERE id = 1
  `).run(
    sysRow['name'],
    sysRow['traits'],
    sysRow['communication_style'],
    sysRow['values'],
    sysRow['existence_paradigm'],
    sysRow['location'],
    sysRow['world_description'],
    sysRow['gender'],
    sysRow['age'],
    sysRow['physical_description'],
    sysRow['personality_dimensions'],
    sysRow['background'],
    sysRow['personality_notes'],
    sysRow['archetype'],
    sysRow['is_finalized'],
    sysRow['updated_at']
  );

  log.info('Migrated persona data from system.db to persona.db');
}

/**
 * Close all database connections.
 */
export function closeDatabases(): void {
  systemDb?.close();
  personaDb?.close();
  heartbeatDb?.close();
  memoryDb?.close();
  messagesDb?.close();
  agentLogsDb?.close();
}
