/**
 * Secure Temp File — materializes encrypted file_secret credentials to
 * temporary files with restrictive permissions for the duration of a
 * command execution.
 *
 * Designed so vault-based file storage can reuse the same
 * writeSecureTempFile() and cleanup pattern without rework.
 */

import { randomBytes } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SecureTempFile', 'system');

const CRED_DIR = join(tmpdir(), 'animus-credentials');

export interface SecureTempFileHandle {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Decode base64 data and write to a temp file with 0o600 permissions.
 * Returns a handle with the file path and an idempotent cleanup function.
 */
export async function writeSecureTempFile(opts: {
  data: string;
  filename: string;
}): Promise<SecureTempFileHandle> {
  await mkdir(CRED_DIR, { recursive: true });

  const ext = extname(opts.filename) || '.tmp';
  const randomSuffix = randomBytes(8).toString('hex');
  const filePath = join(CRED_DIR, `cred-${randomSuffix}${ext}`);

  const buffer = Buffer.from(opts.data, 'base64');
  await writeFile(filePath, buffer, { mode: 0o600 });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await unlink(filePath);
    } catch (err) {
      // File may already be gone (e.g., OS cleanup)
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`Failed to clean up temp credential file: ${filePath}`, err);
      }
    }
  };

  return { path: filePath, cleanup };
}

/** Shape of a file_secret value stored in config. */
export interface FileSecretValue {
  __file_secret: true;
  filename: string;
  mimeType?: string;
  data: string;
}

/** Type guard: checks whether a value is a stored file_secret object (has data). */
export function isFileSecretValue(value: unknown): value is FileSecretValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['__file_secret'] === true &&
    typeof (value as Record<string, unknown>)['data'] === 'string'
  );
}

/** Mask a file_secret for frontend display (strips data and mimeType). */
export function maskFileSecret(value: FileSecretValue): Record<string, unknown> {
  return {
    __file_secret: true,
    filename: value.filename,
    configured: true,
  };
}
