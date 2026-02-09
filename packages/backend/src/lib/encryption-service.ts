/**
 * Encryption Service — AES-256-GCM encryption for API keys.
 *
 * Key derived from ANIMUS_ENCRYPTION_KEY env var via PBKDF2.
 * Falls back to plaintext storage with warning if key not set.
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { env } from '../utils/env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'animus-encryption-salt'; // Static salt — key uniqueness from env var
const ITERATIONS = 100_000;

let derivedKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (derivedKey) return derivedKey;
  if (!env.ANIMUS_ENCRYPTION_KEY) return null;
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
 * Falls back to `plain:{base64}` if no encryption key.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) {
    console.warn('[Encryption] No encryption key set — storing value as plaintext');
    return `plain:${Buffer.from(plaintext).toString('base64')}`;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypt ciphertext.
 * Accepts both encrypted format and plaintext fallback.
 */
export function decrypt(ciphertext: string): string {
  // Handle plaintext fallback
  if (ciphertext.startsWith('plain:')) {
    return Buffer.from(ciphertext.slice(6), 'base64').toString('utf8');
  }

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
