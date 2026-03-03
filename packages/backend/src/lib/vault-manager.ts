/**
 * Vault Manager -- password-derived encryption key lifecycle.
 *
 * Owns the sealed/unsealed server state and the Data Encryption Key (DEK).
 * The DEK exists only in process memory after unsealing; no key material
 * is stored on the filesystem. See docs/architecture/encryption-architecture.md.
 *
 * vault.json format:
 * {
 *   version: 2,
 *   kdf: "argon2id",
 *   kdfParams: { memoryCost, timeCost, parallelism, salt (base64) },
 *   wrappedDek: "iv:ciphertext:authTag",
 *   sentinel: "iv:ciphertext:authTag"
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import * as argon2 from 'argon2';
import { DATA_DIR } from '../utils/env.js';
import { createLogger } from './logger.js';

const log = createLogger('Vault', 'server');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_FILENAME = 'vault.json';
const SENTINEL_PLAINTEXT = 'animus-key-ok';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32; // 256-bit

// Argon2id defaults (matching OWASP recommendations for key derivation)
const DEFAULT_KDF_PARAMS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KdfParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  salt: string; // base64
}

export interface VaultFile {
  version: number;
  kdf: 'argon2id';
  kdfParams: KdfParams;
  wrappedDek: string; // iv:ct:tag
  sentinel: string;   // iv:ct:tag
}

export type SealState = 'sealed' | 'unsealed' | 'no-vault' | 'needs-migration';

// ---------------------------------------------------------------------------
// Module state (never exported directly)
// ---------------------------------------------------------------------------

let dek: Buffer | null = null;
let sealState: SealState = 'no-vault';

// ---------------------------------------------------------------------------
// Internal helpers: AES-256-GCM wrap/unwrap with explicit key
// ---------------------------------------------------------------------------

function wrapWithKey(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

function unwrapWithKey(key: Buffer, wrapped: string): Buffer {
  const parts = wrapped.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid wrapped data format');
  }
  const [ivStr, ctStr, tagStr] = parts as [string, string, string];
  const iv = Buffer.from(ivStr, 'base64');
  const ct = Buffer.from(ctStr, 'base64');
  const tag = Buffer.from(tagStr, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Derive a 32-byte password key from a password + salt via Argon2id.
 */
async function derivePasswordKey(password: string, salt: Buffer, params: Omit<KdfParams, 'salt'>): Promise<Buffer> {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    raw: true,
    hashLength: DEK_LENGTH,
    salt,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
  // argon2.hash with raw: true returns a Buffer
  return Buffer.from(hash);
}

function getVaultPath(): string {
  return path.join(DATA_DIR, VAULT_FILENAME);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read vault.json from DATA_DIR. Returns parsed object or null if not found.
 */
export function loadVault(): VaultFile | null {
  const vaultPath = getVaultPath();
  try {
    const raw = fs.readFileSync(vaultPath, 'utf-8');
    const parsed = JSON.parse(raw) as VaultFile;
    if (parsed.version && parsed.wrappedDek && parsed.sentinel && parsed.kdfParams) {
      return parsed;
    }
    log.warn('vault.json exists but has invalid format');
    return null;
  } catch {
    return null;
  }
}

/**
 * Check Docker secret file, then ANIMUS_UNLOCK_PASSWORD env var.
 * Returns the password string or null.
 */
export function resolveUnlockPassword(): string | null {
  // Docker secrets are mounted as files at /run/secrets/
  try {
    const secretPath = '/run/secrets/animus_unlock_password';
    if (fs.existsSync(secretPath)) {
      const password = fs.readFileSync(secretPath, 'utf-8').trim();
      if (password) return password;
    }
  } catch {
    // Not in Docker or secret not mounted
  }

  // Environment variable
  const envPassword = process.env['ANIMUS_UNLOCK_PASSWORD'];
  if (envPassword) return envPassword;

  return null;
}

/**
 * Derive password key, unwrap DEK, verify sentinel.
 * On success: sets module-scoped dek, sets sealState = 'unsealed'.
 * Throws if password is wrong (sentinel mismatch).
 */
export async function unseal(password: string, vault: VaultFile): Promise<void> {
  const salt = Buffer.from(vault.kdfParams.salt, 'base64');
  const passwordKey = await derivePasswordKey(password, salt, vault.kdfParams);

  // Unwrap DEK
  let unwrappedDek: Buffer;
  try {
    unwrappedDek = unwrapWithKey(passwordKey, vault.wrappedDek);
  } catch {
    throw new Error('Wrong password: failed to unwrap encryption key');
  }

  // Verify sentinel
  try {
    const sentinelBuffer = unwrapWithKey(unwrappedDek, vault.sentinel);
    const sentinelText = sentinelBuffer.toString('utf-8');
    if (sentinelText !== SENTINEL_PLAINTEXT) {
      throw new Error('Sentinel mismatch');
    }
  } catch {
    throw new Error('Wrong password: sentinel verification failed');
  }

  dek = unwrappedDek;
  sealState = 'unsealed';
  log.info('Vault unsealed successfully');
}

/**
 * Generate random DEK + salt, derive password key, wrap DEK, write vault.json.
 * Called during registration (first-time setup).
 * Returns the DEK buffer for immediate use.
 */
export async function createVault(password: string): Promise<Buffer> {
  const newDek = randomBytes(DEK_LENGTH);
  const salt = randomBytes(32);

  const passwordKey = await derivePasswordKey(password, salt, DEFAULT_KDF_PARAMS);

  // Wrap DEK with password-derived key
  const wrappedDek = wrapWithKey(passwordKey, newDek);

  // Create sentinel: encrypt known plaintext with the DEK
  const sentinel = wrapWithKey(newDek, Buffer.from(SENTINEL_PLAINTEXT, 'utf-8'));

  const vaultData: VaultFile = {
    version: 2,
    kdf: 'argon2id',
    kdfParams: {
      ...DEFAULT_KDF_PARAMS,
      salt: salt.toString('base64'),
    },
    wrappedDek,
    sentinel,
  };

  const vaultPath = getVaultPath();
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  fs.writeFileSync(vaultPath, JSON.stringify(vaultData, null, 2), { mode: 0o600 });

  dek = newDek;
  sealState = 'unsealed';
  log.info('Vault created and unsealed');

  return newDek;
}

/**
 * Re-wrap DEK with a new password-derived key, update vault.json.
 * Called during password change.
 */
export async function rewrapVault(currentPassword: string, newPassword: string): Promise<void> {
  if (!dek) {
    throw new Error('Cannot rewrap: vault is sealed');
  }

  // Verify current password by attempting to unseal
  const vault = loadVault();
  if (!vault) {
    throw new Error('Cannot rewrap: vault.json not found');
  }

  const currentSalt = Buffer.from(vault.kdfParams.salt, 'base64');
  const currentKey = await derivePasswordKey(currentPassword, currentSalt, vault.kdfParams);

  try {
    unwrapWithKey(currentKey, vault.wrappedDek);
  } catch {
    throw new Error('Current password is incorrect');
  }

  // Generate new salt and wrap with new password
  const newSalt = randomBytes(32);
  const newPasswordKey = await derivePasswordKey(newPassword, newSalt, DEFAULT_KDF_PARAMS);
  const wrappedDek = wrapWithKey(newPasswordKey, dek);

  // Re-create sentinel with existing DEK
  const sentinel = wrapWithKey(dek, Buffer.from(SENTINEL_PLAINTEXT, 'utf-8'));

  const vaultData: VaultFile = {
    version: 2,
    kdf: 'argon2id',
    kdfParams: {
      ...DEFAULT_KDF_PARAMS,
      salt: newSalt.toString('base64'),
    },
    wrappedDek,
    sentinel,
  };

  const vaultPath = getVaultPath();
  fs.writeFileSync(vaultPath, JSON.stringify(vaultData, null, 2), { mode: 0o600 });
  log.info('Vault re-wrapped with new password');
}

/**
 * Return the unwrapped DEK. Throws if sealed.
 */
export function getDek(): Buffer {
  if (!dek) {
    throw new Error('Vault is sealed. Cannot access encryption key.');
  }
  return dek;
}

/**
 * Set the DEK directly (used during migration).
 */
export function setDekDirect(newDek: Buffer): void {
  dek = newDek;
  sealState = 'unsealed';
}

/**
 * Check current seal state.
 */
export function isUnsealed(): boolean {
  return sealState === 'unsealed';
}

export function getSealState(): SealState {
  return sealState;
}

export function setSealState(state: SealState): void {
  sealState = state;
}

/**
 * Scrub ANIMUS_UNLOCK_PASSWORD from process.env after use.
 */
export function scrubPasswordSources(): void {
  if (process.env['ANIMUS_UNLOCK_PASSWORD']) {
    delete process.env['ANIMUS_UNLOCK_PASSWORD'];
    log.debug('Scrubbed ANIMUS_UNLOCK_PASSWORD from process.env');
  }
}

/**
 * Wipe DEK from memory (called on shutdown).
 */
export function clearDek(): void {
  if (dek) {
    dek.fill(0);
    dek = null;
  }
  sealState = 'sealed';
}

/**
 * Check if legacy .secrets file exists (for migration detection).
 */
export function hasLegacySecrets(): boolean {
  return fs.existsSync(path.join(DATA_DIR, '.secrets'));
}
