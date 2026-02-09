/**
 * Database Module
 *
 * Manages five SQLite databases:
 * - system.db: Users, contacts, settings, personality, API keys (rarely reset)
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
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Database instances
let systemDb: Database.Database;
let heartbeatDb: Database.Database;
let memoryDb: Database.Database;
let messagesDb: Database.Database;
let agentLogsDb: Database.Database;

export function getSystemDb(): Database.Database {
  if (!systemDb) throw new Error('System database not initialized');
  return systemDb;
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
  heartbeatDb = openDb(env.DB_HEARTBEAT_PATH);
  memoryDb = openDb(env.DB_MEMORY_PATH);
  messagesDb = openDb(env.DB_MESSAGES_PATH);
  agentLogsDb = openDb(env.DB_AGENT_LOGS_PATH);

  // Run migrations
  runMigrations(systemDb, path.join(MIGRATIONS_DIR, 'system'), 'system.db');
  runMigrations(heartbeatDb, path.join(MIGRATIONS_DIR, 'heartbeat'), 'heartbeat.db');
  runMigrations(memoryDb, path.join(MIGRATIONS_DIR, 'memory'), 'memory.db');
  runMigrations(messagesDb, path.join(MIGRATIONS_DIR, 'messages'), 'messages.db');
  runMigrations(agentLogsDb, path.join(MIGRATIONS_DIR, 'agent-logs'), 'agent_logs.db');

  console.log('All databases initialized');
}

/**
 * Close all database connections.
 */
export function closeDatabases(): void {
  systemDb?.close();
  heartbeatDb?.close();
  memoryDb?.close();
  messagesDb?.close();
  agentLogsDb?.close();
}
