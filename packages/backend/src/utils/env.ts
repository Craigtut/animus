/**
 * Environment configuration
 *
 * Validates and exports environment variables with sensible defaults.
 * All data paths are derived from a single DATA_DIR.
 */

import fs from 'node:fs';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

// Monorepo root: utils/ -> src/ -> backend/ -> packages/ -> root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Data directory — single source of truth for all persistent data paths
// ---------------------------------------------------------------------------

/**
 * Resolved data directory. Precedence:
 * 1. ANIMUS_DATA_DIR env var (Docker, Tauri, explicit override)
 * 2. ./data/ relative to project root (dev default)
 */
export const DATA_DIR: string = process.env['ANIMUS_DATA_DIR']
  ? path.resolve(process.env['ANIMUS_DATA_DIR'])
  : path.join(PROJECT_ROOT, 'data');

// ---------------------------------------------------------------------------
// Derived paths — all relative to DATA_DIR
// ---------------------------------------------------------------------------

const DB_DIR = path.join(DATA_DIR, 'databases');

export const DB_SYSTEM_PATH = path.join(DB_DIR, 'system.db');
export const DB_PERSONA_PATH = path.join(DB_DIR, 'persona.db');
export const DB_HEARTBEAT_PATH = path.join(DB_DIR, 'heartbeat.db');
export const DB_MEMORY_PATH = path.join(DB_DIR, 'memory.db');
export const DB_MESSAGES_PATH = path.join(DB_DIR, 'messages.db');
export const DB_AGENT_LOGS_PATH = path.join(DB_DIR, 'agent_logs.db');
export const DB_CONTACTS_PATH = path.join(DB_DIR, 'contacts.db');
export const LANCEDB_PATH = path.join(DB_DIR, 'lancedb');

// ---------------------------------------------------------------------------
// Environment schema (non-path configuration)
// ---------------------------------------------------------------------------

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Auth — JWT secret loaded from data/jwt.key
  JWT_SECRET: z.string().optional(), // Legacy: kept for migration
  SESSION_EXPIRY_DAYS: z.coerce.number().default(7),

  // Encryption — DEK derived from user password via vault-manager
  ANIMUS_ENCRYPTION_KEY: z.string().optional(), // Legacy: kept for migration
  ANIMUS_UNLOCK_PASSWORD: z.string().optional(), // Auto-unseal (Docker, dev .env)

  // Agent API keys (optional, users can configure these)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// App version — read once at startup from the nearest package.json
// ---------------------------------------------------------------------------

function readVersion(): string {
  // In dev: monorepo root package.json has the canonical version.
  // In production: the build script writes dist/version.json next to the entry point.
  const candidates = [
    path.join(PROJECT_ROOT, 'package.json'),
    path.resolve(__dirname, '..', 'version.json'),
  ];
  for (const p of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data.version) return data.version;
    } catch { /* try next */ }
  }
  return '0.0.0';
}

export const APP_VERSION = readVersion();
