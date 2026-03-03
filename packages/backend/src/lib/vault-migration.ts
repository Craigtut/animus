/**
 * Vault Migration -- upgrades from legacy .secrets file to vault.json.
 *
 * The legacy system stored a random encryption key in data/.secrets.
 * This module re-encrypts all existing credentials with a new password-derived
 * DEK and creates a vault.json file.
 *
 * Migration flow:
 * 1. Read legacy .secrets file to get old encryption key
 * 2. User provides a password on the migration page
 * 3. Decrypt all credentials with old key
 * 4. Generate new random DEK, create vault.json (wraps DEK with password)
 * 5. Re-encrypt all credentials with new DEK
 * 6. Rename .secrets to .secrets.migrated
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/env.js';
import { createVault, setDekDirect } from './vault-manager.js';
import { setDek } from './encryption-service.js';
import { createJwtSecret, hasJwtSecret } from './jwt-key.js';
import { createLogger } from './logger.js';

const log = createLogger('VaultMigration', 'server');

// Legacy encryption constants (must match old encryption-service.ts)
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const LEGACY_SALT = 'animus-encryption-salt';
const LEGACY_ITERATIONS = 100_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LegacySecretsFile {
  encryptionKey: string;
  jwtSecret: string;
  _generated?: string;
  _version?: number;
}

export interface MigrationResult {
  success: boolean;
  migratedCredentials: number;
  migratedPluginConfigs: number;
  migratedChannelConfigs: number;
}

// ---------------------------------------------------------------------------
// Legacy helpers
// ---------------------------------------------------------------------------

function readLegacySecrets(): LegacySecretsFile | null {
  const secretsPath = path.join(DATA_DIR, '.secrets');
  try {
    const raw = fs.readFileSync(secretsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.encryptionKey) {
      return parsed as LegacySecretsFile;
    }
    return null;
  } catch {
    return null;
  }
}

function deriveLegacyKey(encryptionKey: string): Buffer {
  return pbkdf2Sync(encryptionKey, LEGACY_SALT, LEGACY_ITERATIONS, KEY_LENGTH, 'sha256');
}

function decryptWithKey(key: Buffer, ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }
  const [ivStr, ctStr, tagStr] = parts as [string, string, string];
  const iv = Buffer.from(ivStr, 'base64');
  const ct = Buffer.from(ctStr, 'base64');
  const tag = Buffer.from(tagStr, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Check if a string looks like an AES-256-GCM encrypted value (iv:ct:tag format).
 * Each part should be valid base64.
 */
function isEncryptedValue(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  // IV should be 16 bytes (24 base64 chars), auth tag 16 bytes (24 base64 chars)
  // Ciphertext can be any length but must be non-empty
  const BASE64_REGEX = /^[A-Za-z0-9+/]+=*$/;
  return parts.every(p => p.length > 0 && BASE64_REGEX.test(p));
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Execute the full migration from .secrets to vault.json.
 *
 * @param password - The user's chosen password for the new vault
 * @param systemDb - The system database (for credentials and settings)
 */
export async function migrateToVault(
  password: string,
  systemDb: Database.Database,
): Promise<MigrationResult> {
  const legacySecrets = readLegacySecrets();
  if (!legacySecrets) {
    throw new Error('No legacy .secrets file found');
  }

  const oldKey = deriveLegacyKey(legacySecrets.encryptionKey);

  // Step 1: Decrypt all existing credentials with old key
  let migratedCredentials = 0;
  let migratedPluginConfigs = 0;
  let migratedChannelConfigs = 0;

  // Collect plaintext credentials
  const credentialPlaintexts: Array<{ id: string; data: string }> = [];
  try {
    const rows = systemDb.prepare(
      'SELECT id, encrypted_data FROM credentials'
    ).all() as Array<{ id: string; encrypted_data: string }>;

    for (const row of rows) {
      try {
        const plaintext = decryptWithKey(oldKey, row.encrypted_data);
        credentialPlaintexts.push({ id: row.id, data: plaintext });
      } catch (err) {
        log.warn(`Failed to decrypt credential ${row.id}, skipping:`, err);
      }
    }
  } catch {
    // credentials table may not exist
  }

  // Collect plaintext plugin configs
  const pluginPlaintexts: Array<{ id: string; config: string }> = [];
  try {
    const rows = systemDb.prepare(
      'SELECT id, config_encrypted FROM plugins WHERE config_encrypted IS NOT NULL'
    ).all() as Array<{ id: string; config_encrypted: string }>;

    for (const row of rows) {
      try {
        const plaintext = decryptWithKey(oldKey, row.config_encrypted);
        pluginPlaintexts.push({ id: row.id, config: plaintext });
      } catch (err) {
        log.warn(`Failed to decrypt plugin config ${row.id}, skipping:`, err);
      }
    }
  } catch {
    // plugins table may not exist
  }

  // Collect channel configs with encrypted fields
  // Channel configs are JSON blobs where secret fields are individually encrypted
  // in iv:ct:tag format. We detect them by format rather than needing config schemas.
  const channelConfigDecrypted: Array<{
    name: string;
    config: Record<string, unknown>;
    secretKeys: string[];  // track which keys were encrypted
  }> = [];
  try {
    const rows = systemDb.prepare(
      'SELECT name, config FROM channel_packages WHERE config IS NOT NULL'
    ).all() as Array<{ name: string; config: string }>;

    for (const row of rows) {
      try {
        const config = JSON.parse(row.config) as Record<string, unknown>;
        const secretKeys: string[] = [];

        // Detect and decrypt fields that look like iv:ct:tag encrypted values
        for (const [key, value] of Object.entries(config)) {
          if (typeof value === 'string' && isEncryptedValue(value)) {
            try {
              config[key] = decryptWithKey(oldKey, value);
              secretKeys.push(key);
            } catch {
              // Not actually encrypted or different key, leave as-is
            }
          }
        }

        if (secretKeys.length > 0) {
          channelConfigDecrypted.push({ name: row.name, config, secretKeys });
        }
      } catch {
        log.warn(`Failed to parse channel config for ${row.name}, skipping`);
      }
    }
  } catch {
    // channel_packages table may not exist
  }

  // Step 2: Create new vault (generates new DEK, wraps with password)
  const newDek = await createVault(password);
  setDek(newDek);

  // Step 3: Re-encrypt everything with new DEK
  const reEncrypt = (plaintext: string) => encryptWithKey(newDek, plaintext);

  // Re-encrypt credentials
  for (const cred of credentialPlaintexts) {
    const newCiphertext = reEncrypt(cred.data);
    systemDb.prepare(
      'UPDATE credentials SET encrypted_data = ? WHERE id = ?'
    ).run(newCiphertext, cred.id);
    migratedCredentials++;
  }

  // Re-encrypt plugin configs
  for (const plugin of pluginPlaintexts) {
    const newCiphertext = reEncrypt(plugin.config);
    systemDb.prepare(
      'UPDATE plugins SET config_encrypted = ? WHERE id = ?'
    ).run(newCiphertext, plugin.id);
    migratedPluginConfigs++;
  }

  // Re-encrypt channel config secret fields with new DEK
  for (const ch of channelConfigDecrypted) {
    const config = { ...ch.config };
    for (const key of ch.secretKeys) {
      if (typeof config[key] === 'string') {
        config[key] = reEncrypt(config[key] as string);
      }
    }
    systemDb.prepare(
      'UPDATE channel_packages SET config = ? WHERE name = ?'
    ).run(JSON.stringify(config), ch.name);
    migratedChannelConfigs++;
  }

  // Step 4: Update encryption sentinel
  const sentinel = reEncrypt('animus-key-ok');
  systemDb.prepare(
    'UPDATE system_settings SET encryption_key_check = ? WHERE id = 1'
  ).run(sentinel);

  // Step 5: Generate JWT key file if it doesn't exist
  if (!hasJwtSecret()) {
    createJwtSecret();
  }

  // Step 6: Rename legacy file
  const secretsPath = path.join(DATA_DIR, '.secrets');
  const migratedPath = path.join(DATA_DIR, '.secrets.migrated');
  try {
    fs.renameSync(secretsPath, migratedPath);
  } catch (err) {
    log.warn('Failed to rename .secrets to .secrets.migrated:', err);
  }

  log.info(
    `Migration complete: ${migratedCredentials} credentials, ` +
    `${migratedPluginConfigs} plugin configs, ` +
    `${migratedChannelConfigs} channel configs`
  );

  return {
    success: true,
    migratedCredentials,
    migratedPluginConfigs,
    migratedChannelConfigs,
  };
}
