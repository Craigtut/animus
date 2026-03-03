/**
 * Encryption Service -- AES-256-GCM encryption for secrets.
 *
 * The DEK (Data Encryption Key) is provided by vault-manager after unsealing.
 * No key material is derived from environment variables or stored on disk.
 * See docs/architecture/encryption-architecture.md.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { createLogger } from './logger.js';

const log = createLogger('Encryption', 'server');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SENTINEL = 'animus-key-ok';

// DEK pushed in by vault-manager after unseal
let activeDek: Buffer | null = null;

/**
 * Set the active Data Encryption Key. Called by vault-manager after unseal.
 */
export function setDek(newDek: Buffer): void {
  activeDek = newDek;
}

/**
 * Wipe the DEK from memory. Called on shutdown or re-seal.
 */
export function clearDek(): void {
  if (activeDek) {
    activeDek.fill(0);
    activeDek = null;
  }
}

function getKey(): Buffer {
  if (!activeDek) {
    throw new Error('Vault is sealed. Cannot encrypt/decrypt.');
  }
  return activeDek;
}

/**
 * Whether encryption is configured (vault is unsealed and DEK is available).
 */
export function isConfigured(): boolean {
  return activeDek !== null;
}

/**
 * Encrypt plaintext.
 * Returns `{iv}:{ciphertext}:{authTag}` in base64.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();

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
 * Throws if the key has changed (all encrypted data would be unreadable).
 */
export function verifyEncryptionKey(db: Database.Database): void {
  const row = db.prepare(
    'SELECT encryption_key_check FROM system_settings WHERE id = 1'
  ).get() as { encryption_key_check: string | null } | undefined;

  const stored = row?.encryption_key_check ?? null;

  // First time using this key: store sentinel
  if (!stored) {
    const sentinel = encrypt(SENTINEL);
    db.prepare(
      'UPDATE system_settings SET encryption_key_check = ? WHERE id = 1'
    ).run(sentinel);
    log.info('Encryption key verified and sentinel stored');
    return;
  }

  // Sentinel exists: verify the key matches
  try {
    const decrypted = decrypt(stored!);
    if (decrypted !== SENTINEL) {
      throw new Error('Sentinel mismatch');
    }
  } catch {
    throw new Error(
      'Encryption key does not match the key used to encrypt existing data. ' +
      'The vault password may have changed without re-encrypting credentials. ' +
      'All stored secrets (API keys, channel configs) are encrypted with the original key.'
    );
  }
}
