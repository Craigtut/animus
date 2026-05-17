/**
 * JWT Key Manager -- device-stored JWT secret, separate from the vault.
 *
 * The JWT secret is a random 256-bit value stored in data/jwt.key with 0600
 * permissions. It is NOT password-protected because JWT compromise only affects
 * session authentication, not credential encryption (which uses the vault DEK).
 *
 * Generated on first registration, read at startup for fastify-jwt config.
 * Added to the file deny list so the AI agent cannot read it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, env } from '../utils/env.js';
import { createLogger } from './logger.js';

const log = createLogger('JwtKey', 'server');

const JWT_KEY_FILENAME = 'jwt.key';

let cachedSecret: string | null = null;

function getJwtKeyPath(): string {
  return path.join(DATA_DIR, JWT_KEY_FILENAME);
}

/**
 * Read the JWT secret from data/jwt.key.
 * Returns null if the file doesn't exist (first run, before registration).
 */
export function loadJwtSecret(): string | null {
  if (cachedSecret) return cachedSecret;

  const keyPath = getJwtKeyPath();
  try {
    const secret = fs.readFileSync(keyPath, 'utf-8').trim();
    if (secret) {
      cachedSecret = secret;
      return secret;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate and persist a new JWT secret.
 *
 * Idempotent: if a key already exists (on disk or cached), reuse it instead
 * of generating a new one. Multiple callers (startup resolver, first-run
 * registration, vault migration) may reach this; rotating the secret here
 * would invalidate every live session, so we only ever create it once.
 */
export function createJwtSecret(): string {
  const existing = loadJwtSecret();
  if (existing) return existing;

  const secret = randomBytes(32).toString('hex');
  const keyPath = getJwtKeyPath();

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, secret, { mode: 0o600 });

  cachedSecret = secret;
  log.info('JWT secret generated and stored');
  return secret;
}

/**
 * Resolve the JWT secret for BOTH signing (fastify-jwt registration) and
 * WebSocket verification (api/trpc.ts), guaranteeing a single shared value.
 *
 * Precedence:
 *   1. Persisted data/jwt.key — the normal case after first run
 *   2. JWT_SECRET env var — legacy installs; used as-is, not persisted
 *   3. First run: generate and persist now
 *
 * Called at server startup (auth plugin registration) so the key exists
 * before the first register/login/unlock signs a cookie. This is what keeps
 * the HTTP and WebSocket auth paths from diverging onto different secrets
 * (the cause of dead WS subscriptions on a fresh first run).
 */
export function resolveJwtSecret(): string {
  const fromFile = loadJwtSecret();
  if (fromFile) return fromFile;
  if (env.JWT_SECRET) return env.JWT_SECRET;
  return createJwtSecret();
}

/**
 * Get the JWT secret, throwing if not available.
 * Use this in places that require the secret to exist (after registration).
 */
export function getJwtSecret(): string {
  const secret = loadJwtSecret();
  if (!secret) {
    throw new Error('JWT secret not available. Registration has not been completed.');
  }
  return secret;
}

/**
 * Check if a JWT secret exists (registration has been completed at some point).
 */
export function hasJwtSecret(): boolean {
  return loadJwtSecret() !== null;
}
