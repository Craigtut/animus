/**
 * Sign Command — Sign an .anpk archive with Ed25519.
 *
 * Reads the archive, computes SHA-256, creates an Ed25519 signature,
 * and adds a SIGNATURE file to the archive.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  SUPPORTED_FORMAT_VERSION,
  DEFAULT_SIGNER_IDENTITY,
} from '@animus-labs/shared';
import type { SignatureFile } from '@animus-labs/shared';
import * as logger from '../utils/logger.js';
import { hashBuffer } from '../pipeline/checksum.js';
import { createArchive } from '../pipeline/archive.js';

/**
 * Sign an .anpk package file.
 *
 * The signing process:
 * 1. Read the archive contents (without SIGNATURE)
 * 2. Compute SHA-256 of the archive
 * 3. Sign the hash with Ed25519 private key
 * 4. Create SIGNATURE JSON
 * 5. Rebuild archive with SIGNATURE as last entry
 */
export async function signPackage(
  archivePath: string,
  keyPathOrEnvValue: string,
  signerIdentity?: string,
): Promise<void> {
  // Read the private key
  let privateKeyPem: string;
  if (keyPathOrEnvValue.startsWith('base64:')) {
    privateKeyPem = Buffer.from(keyPathOrEnvValue.slice(7), 'base64').toString('utf-8');
  } else {
    privateKeyPem = await fs.readFile(keyPathOrEnvValue, 'utf-8');
  }

  const privateKey = crypto.createPrivateKey(privateKeyPem);

  // Compute SHA-256 of the archive (without SIGNATURE)
  const archiveData = await fs.readFile(archivePath);
  const archiveHash = hashBuffer(archiveData);

  // Sign the payload
  const payload = `sha256:${archiveHash}`;
  const signature = crypto.sign(null, Buffer.from(payload), privateKey);

  // Derive public key from private key
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

  // Extract base64 content from PEM (strip headers and newlines)
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

  const signatureJson = JSON.stringify(signatureFile, null, 2);

  // We need to rebuild the archive to include the SIGNATURE.
  // Extract to temp, add SIGNATURE, re-archive.
  const { createReadStream } = await import('node:fs');
  const { default: unzipper } = await import('archiver');

  // Simpler approach: extract archive to temp dir, add SIGNATURE, re-archive
  const tmpDir = archivePath + '.sign-tmp';
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    // Extract existing archive
    await extractZip(archivePath, tmpDir);

    // Write SIGNATURE file
    await fs.writeFile(path.join(tmpDir, 'SIGNATURE'), signatureJson, 'utf-8');

    // Re-create archive
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

  await signPackage(absolutePath, keyPath, signerIdentity);

  logger.info(`Signed by: ${signerIdentity}`);
  logger.blank();
  logger.success('Package signed.');
}

/**
 * Extract a ZIP archive to a directory using Node.js built-in APIs.
 * Uses the `zlib` and streaming approach.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Use a simple approach: read the zip, parse entries, extract.
  // Since we're in Node.js 24, we can use the built-in approach.
  // For simplicity, we'll use a lightweight extraction.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
  } catch {
    // Fallback: try using the `tar` approach or throw
    throw new Error(
      'Failed to extract archive. Ensure "unzip" is available on your system.',
    );
  }
}
