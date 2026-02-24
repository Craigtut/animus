/**
 * Secrets Manager — auto-generates, loads, and persists encryption key + JWT secret.
 *
 * Lifecycle:
 *   1. resolveSecrets()          — called at top of main(), before DB init
 *   2. persistSecretsIfNeeded()  — called after verifyEncryptionKey() succeeds
 *
 * Resolution order for each secret:
 *   a) Environment variable (explicit override)
 *   b) .secrets file in DATA_DIR
 *   c) Legacy Tauri files (.encryption_key, .jwt_secret) in DATA_DIR — migrated
 *   d) Generated via crypto.randomBytes
 *
 * After resolution, process.env values are scrubbed to prevent agent bash access.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, env } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SecretsFile {
  encryptionKey: string;
  jwtSecret: string;
  _generated: string;
  _version: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const SECRETS_PATH = path.join(DATA_DIR, '.secrets');
const LEGACY_ENCRYPTION_KEY_FILE = path.join(DATA_DIR, '.encryption_key');
const LEGACY_JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

let migratedFromLegacy = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

function readSecretsFile(): SecretsFile | null {
  try {
    const raw = fs.readFileSync(SECRETS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.encryptionKey && parsed.jwtSecret) {
      return parsed as SecretsFile;
    }
    return null;
  } catch {
    return null;
  }
}

function readLegacyFile(filePath: string): string | null {
  try {
    const value = fs.readFileSync(filePath, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve encryption key and JWT secret. Must be called at top of main(),
 * before database initialization.
 *
 * Resolution order:
 *   1. Env var already set → use it
 *   2. .secrets file in DATA_DIR → load from it
 *   3. Legacy Tauri files (.encryption_key, .jwt_secret) → migrate
 *   4. Generate new secrets
 *
 * After resolution, mutates `env` so downstream code works, then scrubs
 * process.env to prevent agent bash tools from reading secrets.
 */
export function resolveSecrets(): void {
  // Ensure DATA_DIR exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let encryptionKey = env.ANIMUS_ENCRYPTION_KEY || undefined;
  let jwtSecret = env.JWT_SECRET || undefined;

  // Try .secrets file if either value is missing
  if (!encryptionKey || !jwtSecret) {
    const stored = readSecretsFile();
    if (stored) {
      encryptionKey = encryptionKey || stored.encryptionKey;
      jwtSecret = jwtSecret || stored.jwtSecret;
    }
  }

  // Try legacy Tauri files if still missing
  if (!encryptionKey) {
    const legacy = readLegacyFile(LEGACY_ENCRYPTION_KEY_FILE);
    if (legacy) {
      encryptionKey = legacy;
      migratedFromLegacy = true;
    }
  }
  if (!jwtSecret) {
    const legacy = readLegacyFile(LEGACY_JWT_SECRET_FILE);
    if (legacy) {
      jwtSecret = legacy;
      migratedFromLegacy = true;
    }
  }

  // Generate if still missing
  if (!encryptionKey) {
    encryptionKey = generateSecret();
  }
  if (!jwtSecret) {
    jwtSecret = generateSecret();
  }

  // Mutate env object so downstream code sees the resolved values
  (env as Record<string, unknown>).ANIMUS_ENCRYPTION_KEY = encryptionKey;
  (env as Record<string, unknown>).JWT_SECRET = jwtSecret;

  // Scrub process.env to prevent agent bash access via `env`/`printenv`
  delete process.env.ANIMUS_ENCRYPTION_KEY;
  delete process.env.JWT_SECRET;
}

/**
 * Persist secrets to .secrets file if it doesn't already exist.
 * Call after verifyEncryptionKey() succeeds to ensure the key is valid.
 *
 * If secrets were migrated from legacy Tauri files, removes the old files.
 */
export function persistSecretsIfNeeded(): void {
  if (fs.existsSync(SECRETS_PATH)) return;

  const data: SecretsFile = {
    encryptionKey: env.ANIMUS_ENCRYPTION_KEY!,
    jwtSecret: env.JWT_SECRET!,
    _generated: new Date().toISOString(),
    _version: 1,
  };

  fs.writeFileSync(SECRETS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });

  // Clean up legacy Tauri files if we migrated from them
  if (migratedFromLegacy) {
    try { fs.unlinkSync(LEGACY_ENCRYPTION_KEY_FILE); } catch { /* ok */ }
    try { fs.unlinkSync(LEGACY_JWT_SECRET_FILE); } catch { /* ok */ }
    migratedFromLegacy = false;
  }
}
