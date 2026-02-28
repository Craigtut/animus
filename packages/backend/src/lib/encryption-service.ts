/**
 * Encryption Service — AES-256-GCM encryption for secrets.
 *
 * Key derived from ANIMUS_ENCRYPTION_KEY via PBKDF2.
 * The key is resolved by secrets-manager at startup (auto-generated if needed).
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import type Database from 'better-sqlite3';
import { env } from '../utils/env.js';
import { createLogger } from './logger.js';

const log = createLogger('Encryption', 'server');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'animus-encryption-salt'; // Static salt — key uniqueness from env var
const ITERATIONS = 100_000;
const SENTINEL = 'animus-key-ok';

let derivedKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (derivedKey) return derivedKey;
  if (!env.ANIMUS_ENCRYPTION_KEY) {
    throw new Error(
      'Encryption key not available. Ensure resolveSecrets() was called before using encryption.'
    );
  }
  derivedKey = pbkdf2Sync(env.ANIMUS_ENCRYPTION_KEY, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
  return derivedKey;
}

/**
 * Whether encryption is configured (key is set).
 */
export function isConfigured(): boolean {
  return !!env.ANIMUS_ENCRYPTION_KEY;
}

/**
 * Encrypt plaintext.
 * Returns `{iv}:{ciphertext}:{authTag}` in base64.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error('Cannot encrypt: ANIMUS_ENCRYPTION_KEY is not configured');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypt ciphertext (AES-256-GCM format: `{iv}:{ciphertext}:{authTag}`).
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error('Cannot decrypt: no encryption key configured');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }

  const [ivStr, encryptedStr, authTagStr] = parts as [string, string, string];
  const iv = Buffer.from(ivStr, 'base64');
  const encrypted = Buffer.from(encryptedStr, 'base64');
  const authTag = Buffer.from(authTagStr, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Verify the encryption key matches what was used to encrypt existing data.
 *
 * On first run (no sentinel stored), encrypts and stores a sentinel value.
 * On subsequent runs, decrypts the sentinel to verify the key hasn't changed.
 *
 * Throws if the key has changed — all encrypted data would be unreadable.
 */
export function verifyEncryptionKey(db: Database.Database): void {
  const row = db.prepare(
    'SELECT encryption_key_check FROM system_settings WHERE id = 1'
  ).get() as { encryption_key_check: string | null } | undefined;

  const stored = row?.encryption_key_check ?? null;

  // Key is always set (enforced by env validation), so only two cases remain.

  // First time using this key — store sentinel
  if (!stored) {
    const sentinel = encrypt(SENTINEL);
    db.prepare(
      'UPDATE system_settings SET encryption_key_check = ? WHERE id = 1'
    ).run(sentinel);
    log.info('Encryption key verified and sentinel stored');
    return;
  }

  // Sentinel exists — verify the key matches
  try {
    const decrypted = decrypt(stored!);
    if (decrypted !== SENTINEL) {
      throw new Error('Sentinel mismatch');
    }
  } catch {
    throw new Error(
      'ANIMUS_ENCRYPTION_KEY does not match the key used to encrypt existing data. ' +
      'Restore the original encryption key to start the server. ' +
      'All stored secrets (API keys, channel configs) are encrypted with the original key.'
    );
  }
}
