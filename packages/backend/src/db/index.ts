/**
 * Database Module
 *
 * Manages four SQLite databases:
 * - system.db: Users, auth, settings, personality (rarely reset)
 * - heartbeat.db: Thoughts, experiences, emotions, tasks (the "life state")
 * - messages.db: Conversations, messages, channels (long-term history)
 * - agent_logs.db: SDK logs, tool calls, token usage (frequent cleanup)
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import path from 'path';

import { env } from '../utils/env.js';

// Database instances
let systemDb: Database.Database;
let heartbeatDb: Database.Database;
let messagesDb: Database.Database;
let agentLogsDb: Database.Database;

/**
 * Get the system database instance
 */
export function getSystemDb(): Database.Database {
  if (!systemDb) {
    throw new Error('System database not initialized');
  }
  return systemDb;
}

/**
 * Get the heartbeat database instance
 */
export function getHeartbeatDb(): Database.Database {
  if (!heartbeatDb) {
    throw new Error('Heartbeat database not initialized');
  }
  return heartbeatDb;
}

/**
 * Get the messages database instance
 */
export function getMessagesDb(): Database.Database {
  if (!messagesDb) {
    throw new Error('Messages database not initialized');
  }
  return messagesDb;
}

/**
 * Get the agent logs database instance
 */
export function getAgentLogsDb(): Database.Database {
  if (!agentLogsDb) {
    throw new Error('Agent logs database not initialized');
  }
  return agentLogsDb;
}

/**
 * Initialize all databases with their schemas
 */
export async function initializeDatabases(): Promise<void> {
  // Ensure data directory exists
  const dataDir = path.dirname(env.DB_SYSTEM_PATH);
  await mkdir(dataDir, { recursive: true });

  // Initialize system database
  systemDb = new Database(env.DB_SYSTEM_PATH);
  systemDb.pragma('journal_mode = WAL');
  systemDb.pragma('foreign_keys = ON');
  initializeSystemSchema(systemDb);

  // Initialize heartbeat database
  heartbeatDb = new Database(env.DB_HEARTBEAT_PATH);
  heartbeatDb.pragma('journal_mode = WAL');
  heartbeatDb.pragma('foreign_keys = ON');
  initializeHeartbeatSchema(heartbeatDb);

  // Initialize messages database
  messagesDb = new Database(env.DB_MESSAGES_PATH);
  messagesDb.pragma('journal_mode = WAL');
  messagesDb.pragma('foreign_keys = ON');
  initializeMessagesSchema(messagesDb);

  // Initialize agent logs database
  agentLogsDb = new Database(env.DB_AGENT_LOGS_PATH);
  agentLogsDb.pragma('journal_mode = WAL');
  agentLogsDb.pragma('foreign_keys = ON');
  initializeAgentLogsSchema(agentLogsDb);

  console.log('All databases initialized');
}

/**
 * Close all database connections
 */
export function closeDatabases(): void {
  systemDb?.close();
  heartbeatDb?.close();
  messagesDb?.close();
  agentLogsDb?.close();
}

// ============================================================================
// Schema Definitions
// ============================================================================

function initializeSystemSchema(db: Database.Database): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    -- System settings (singleton table)
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      heartbeat_interval_ms INTEGER NOT NULL DEFAULT 300000,
      thought_retention_days INTEGER NOT NULL DEFAULT 30,
      experience_retention_days INTEGER NOT NULL DEFAULT 30,
      emotion_history_retention_days INTEGER NOT NULL DEFAULT 30,
      agent_log_retention_days INTEGER NOT NULL DEFAULT 14,
      default_agent_provider TEXT NOT NULL DEFAULT 'claude',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Initialize system settings if not exists
    INSERT OR IGNORE INTO system_settings (id) VALUES (1);

    -- Personality settings (singleton table)
    CREATE TABLE IF NOT EXISTS personality_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'Animus',
      traits TEXT NOT NULL DEFAULT '[]',
      communication_style TEXT NOT NULL DEFAULT 'helpful and thoughtful',
      values TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Initialize personality settings if not exists
    INSERT OR IGNORE INTO personality_settings (id) VALUES (1);

    -- API keys (encrypted storage)
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
  `);
}

function initializeHeartbeatSchema(db: Database.Database): void {
  db.exec(`
    -- Heartbeat state (singleton table)
    CREATE TABLE IF NOT EXISTS heartbeat_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tick_number INTEGER NOT NULL DEFAULT 0,
      current_phase TEXT NOT NULL DEFAULT 'idle',
      pipeline_progress TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_tick_at TEXT,
      is_running INTEGER NOT NULL DEFAULT 0
    );

    -- Initialize heartbeat state if not exists
    INSERT OR IGNORE INTO heartbeat_state (id) VALUES (1);

    -- Thoughts table
    CREATE TABLE IF NOT EXISTS thoughts (
      id TEXT PRIMARY KEY,
      tick_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_thoughts_tick ON thoughts(tick_number);
    CREATE INDEX IF NOT EXISTS idx_thoughts_expires ON thoughts(expires_at);
    CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts(importance);

    -- Experiences table
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      tick_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_experiences_tick ON experiences(tick_number);
    CREATE INDEX IF NOT EXISTS idx_experiences_expires ON experiences(expires_at);
    CREATE INDEX IF NOT EXISTS idx_experiences_importance ON experiences(importance);

    -- Emotion state table (12 fixed rows, updated in place)
    CREATE TABLE IF NOT EXISTS emotion_state (
      emotion TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      intensity REAL NOT NULL DEFAULT 0,
      baseline REAL NOT NULL DEFAULT 0,
      last_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Seed emotion state if empty
    INSERT OR IGNORE INTO emotion_state (emotion, category) VALUES
      ('joy', 'positive'),
      ('contentment', 'positive'),
      ('excitement', 'positive'),
      ('gratitude', 'positive'),
      ('confidence', 'positive'),
      ('stress', 'negative'),
      ('anxiety', 'negative'),
      ('frustration', 'negative'),
      ('sadness', 'negative'),
      ('boredom', 'negative'),
      ('curiosity', 'drive'),
      ('loneliness', 'drive');

    -- Emotion history table (append-only log of changes)
    CREATE TABLE IF NOT EXISTS emotion_history (
      id TEXT PRIMARY KEY,
      tick_number INTEGER NOT NULL,
      emotion TEXT NOT NULL,
      delta REAL NOT NULL,
      reasoning TEXT NOT NULL,
      intensity_before REAL NOT NULL,
      intensity_after REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_emotion_history_tick ON emotion_history(tick_number);
    CREATE INDEX IF NOT EXISTS idx_emotion_history_emotion ON emotion_history(emotion);
    CREATE INDEX IF NOT EXISTS idx_emotion_history_created ON emotion_history(created_at);

    -- Tasks table
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      due_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);

    -- Actions table (things Animus has done)
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      tick_number INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_actions_tick ON actions(tick_number);
    CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(type);
  `);
}

function initializeMessagesSchema(db: Database.Database): void {
  db.exec(`
    -- Channels (communication endpoints)
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);

    -- Initialize default web channel if not exists
    INSERT OR IGNORE INTO channels (id, type, name) VALUES ('web-default', 'web', 'Web UI');

    -- Conversations (message threads)
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at);

    -- Messages (individual messages in both directions)
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      tick_number INTEGER,
      agent_task_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
  `);
}

function initializeAgentLogsSchema(db: Database.Database): void {
  db.exec(`
    -- Agent sessions
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider ON agent_sessions(provider);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_started ON agent_sessions(started_at);

    -- Agent events
    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at);

    -- Agent usage (token counts, costs)
    CREATE TABLE IF NOT EXISTS agent_usage (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_session ON agent_usage(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_created ON agent_usage(created_at);

    -- Tool calls
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_started ON tool_calls(started_at);
  `);
}
