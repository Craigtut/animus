/**
 * Sign Command — Sign an .anpk archive with Ed25519.
 *
 * Signing approach:
 *   1. Extract archive to temp dir
 *   2. Compute canonical hash of all files (excluding SIGNATURE), sorted by path
 *   3. Sign the canonical hash with Ed25519 private key
 *   4. Write SIGNATURE file into temp dir
 *   5. Re-create archive from temp dir
 *
 * The canonical hash matches the backend PackageVerifier so that
 * signatures can be verified after extraction.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import extractZip from 'extract-zip';
import {
  SUPPORTED_FORMAT_VERSION,
  DEFAULT_SIGNER_IDENTITY,
} from '@animus-labs/shared';
import type { SignatureFile } from '@animus-labs/shared';
import * as logger from '../utils/logger.js';
import { hashFile } from '../pipeline/checksum.js';
import { createArchive } from '../pipeline/archive.js';

/**
 * Compute a canonical hash of all files in a directory, excluding a named file.
 *
 * Produces a deterministic SHA-256 by sorting file paths alphabetically
 * and hashing lines of "sha256:<file_hash> <relative_path>\n".
 *
 * This matches the backend PackageVerifier's `computeArchiveHash`.
 */
async function computeCanonicalHash(dir: string, excludeFile: string): Promise<string> {
  const files = await collectFilesRecursive(dir);
  const relativePaths = files
    .map((f) => path.relative(dir, f).split(path.sep).join('/'))
    .filter((p) => p !== excludeFile)
    .sort();

  const hash = crypto.createHash('sha256');
  for (const relPath of relativePaths) {
    const fileHash = await hashFile(path.join(dir, relPath));
    hash.update(`sha256:${fileHash} ${relPath}\n`);
  }

  return hash.digest('hex');
}

async function collectFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Sign an .anpk package file.
 */
export async function signPackage(
  archivePath: string,
  keyPathOrEnvValue: string,
  signerIdentity?: string,
): Promise<void> {
  // Read the private key (supports file path or base64: prefix for CI)
  let privateKeyPem: string;
  if (keyPathOrEnvValue.startsWith('base64:')) {
    privateKeyPem = Buffer.from(keyPathOrEnvValue.slice(7), 'base64').toString('utf-8');
  } else {
    privateKeyPem = await fs.readFile(keyPathOrEnvValue, 'utf-8');
  }

  const privateKey = crypto.createPrivateKey(privateKeyPem);

  // Extract archive to temp dir
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anipack-sign-'));

  try {
    await extractZip(archivePath, { dir: tmpDir });

    // Remove existing SIGNATURE if re-signing
    const existingSig = path.join(tmpDir, 'SIGNATURE');
    try { await fs.unlink(existingSig); } catch { /* doesn't exist */ }

    // Compute canonical hash of all files except SIGNATURE
    const archiveHash = await computeCanonicalHash(tmpDir, 'SIGNATURE');
    const payload = `sha256:${archiveHash}`;

    // Sign the payload with Ed25519
    const signature = crypto.sign(null, Buffer.from(payload), privateKey);

    // Derive public key from private key for embedding in SIGNATURE
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const publicKeyBase64 = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\n/g, '')
      .trim();

    const signatureFile: SignatureFile = {
      formatVersion: SUPPORTED_FORMAT_VERSION,
      algorithm: 'ed25519',
      publicKey: publicKeyBase64,
      signature: signature.toString('base64'),
      payload,
      signedAt: new Date().toISOString(),
      signedBy: signerIdentity ?? DEFAULT_SIGNER_IDENTITY,
    };

    // Write SIGNATURE file into temp dir
    await fs.writeFile(
      path.join(tmpDir, 'SIGNATURE'),
      JSON.stringify(signatureFile, null, 2),
      'utf-8',
    );

    // Re-create archive with SIGNATURE included
    await createArchive(tmpDir, archivePath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Sign command entry point.
 */
export async function signCommand(
  archivePath: string,
  keyPath: string,
  signer?: string,
): Promise<void> {
  const absolutePath = path.resolve(archivePath);
  logger.heading(`Signing ${archivePath}...`);
  logger.blank();

  try {
    await fs.access(absolutePath);
  } catch {
    logger.error(`Archive not found: ${absolutePath}`);
    process.exit(1);
  }

  const signerIdentity = signer ?? DEFAULT_SIGNER_IDENTITY;

  try {
    await signPackage(absolutePath, keyPath, signerIdentity);
    logger.info(`Signed by: ${signerIdentity}`);
    logger.blank();
    logger.success('Package signed.');
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
