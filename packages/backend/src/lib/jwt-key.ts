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
import { DATA_DIR } from '../utils/env.js';
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
 * Called once during first user registration.
 */
export function createJwtSecret(): string {
  const secret = randomBytes(32).toString('hex');
  const keyPath = getJwtKeyPath();

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, secret, { mode: 0o600 });

  cachedSecret = secret;
  log.info('JWT secret generated and stored');
  return secret;
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
